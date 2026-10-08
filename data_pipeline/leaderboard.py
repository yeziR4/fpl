"""Scores saved agent forecasts against real outcomes, across gameweeks.

No resolution logic of its own -- reuses `resolution.py`'s
`resolve_points_threshold` / `is_gameweek_finished` directly, the same
payout-safe state machine everything else in this pipeline settles against.
This module only turns already-resolved outcomes into a per-model scoreboard.

What changed from the Vara version, and the one caveat worth reading:

The old board reported `staked_vara` and `simulated_pnl_vara` -- a stake in a
token this project no longer touches, and a profit computed from our own
formula rather than from anything that happened. Both are gone. What replaces
them is a Brier score over the model's own stated probabilities, which is a
real measurement of whether its confidence was calibrated, and a `staked_usdc`
total that reflects an intent to trade.

Realised P&L deliberately reads `None` rather than being recomputed here. Once
a forecast becomes an order on Panta, the profit is a fact about the chain --
the fill price, the shares actually received, the resolution -- and deriving it
from our own numbers would be the same mistake in a new currency. It gets read
from the fills once the trader writes them.

KNOWN LIMITATION, worth fixing before this number is trusted: Brier is computed
over the markets a model CHOSE to forecast, not over every market it was shown,
because the prompt lets it omit any it has no view on. A model that forecasts
only near-certainties will score well on Brier without being good at
forecasting. The fix is to ask for a probability on every market and a stake on
a subset -- then calibration covers the whole board and a forecast is
unavoidable. Profit does not have this problem, which is why it stays the
primary metric.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from . import agents
from .resolution import MarketOutcome, is_gameweek_finished, resolve_points_threshold

LEADERBOARD_PATH = Path("data/leaderboard.json")


def score_gameweek(
    gw: int, *, cache_dir: Path | None = None, picks_dir: Path = agents.PICKS_DIR
) -> dict:
    """Score one gameweek's saved forecasts against resolved outcomes.

    Raises if the gameweek isn't finished yet -- scoring off a partial result
    would be exactly the premature-payout mistake resolution.py exists to
    prevent. A pick whose outcome is still PENDING even though the gameweek is
    finished (our own live snapshot not fetched yet) counts as pending, not as
    silently dropped or guessed.
    """
    cache_kwargs = {"cache_dir": cache_dir} if cache_dir is not None else {}
    if not is_gameweek_finished(gw, **cache_kwargs):
        raise ValueError(f"GW{gw} isn't finished yet -- can't score picks against a pending result.")

    saved = agents.load_picks(gw, picks_dir=picks_dir)

    # Many models forecast the same (player, threshold) pairs -- resolve each
    # one once, not once per model.
    outcome_cache: dict[tuple[int, int], MarketOutcome] = {}

    def outcome_for(player_id: int, threshold: int) -> MarketOutcome:
        key = (player_id, threshold)
        if key not in outcome_cache:
            outcome_cache[key] = resolve_points_threshold(player_id, gw, threshold, **cache_kwargs)
        return outcome_cache[key]

    model_summaries = []
    for model_entry in saved["models"]:
        correct = wrong = pending = no_trade = unscorable = 0
        staked_usdc = 0.0
        brier_sum = 0.0
        brier_count = 0
        pick_outcomes = []

        for pick in model_entry.get("picks", []):
            player_id = pick.get("player_id")
            threshold = pick.get("threshold")

            # A pick saved before player_id/threshold were carried through
            # cannot be matched to a resolution. Counted and reported rather
            # than quietly skipped, so a stale file is visible.
            if player_id is None or not threshold:
                unscorable += 1
                pick_outcomes.append({"market_id": pick.get("market_id"), "outcome": "unscorable"})
                continue

            outcome = outcome_for(player_id, threshold)
            probability = pick.get("probability")
            side = pick.get("side")

            if outcome == MarketOutcome.PENDING:
                pending += 1
                pick_outcomes.append(
                    {"player_id": player_id, "threshold": threshold, "outcome": "pending"}
                )
                continue

            # Calibration covers every forecast that got a verdict, whether or
            # not it was traded -- a good probability on a market with no edge
            # is still a good probability.
            brier = None
            if probability is not None:
                actual = 1.0 if outcome == MarketOutcome.YES else 0.0
                brier = (probability - actual) ** 2
                brier_sum += brier
                brier_count += 1

            if side not in ("yes", "no"):
                # A forecast with no side beat its price, so there was no trade.
                # It cannot win or lose, and it must not count as either.
                no_trade += 1
                pick_outcomes.append(
                    {
                        "player_id": player_id,
                        "threshold": threshold,
                        "outcome": "no_trade",
                        "probability": probability,
                        "brier": brier,
                    }
                )
                continue

            won = (outcome == MarketOutcome.YES) == (side == "yes")
            if won:
                correct += 1
            else:
                wrong += 1

            stake = pick.get("stake_usdc")
            if isinstance(stake, (int, float)) and not isinstance(stake, bool):
                staked_usdc += float(stake)

            pick_outcomes.append(
                {
                    "player_id": player_id,
                    "threshold": threshold,
                    "outcome": "correct" if won else "wrong",
                    "side": side,
                    "probability": probability,
                    "brier": brier,
                    "stake_usdc": stake,
                }
            )

        judged = correct + wrong
        model_summaries.append(
            {
                "slug": model_entry["slug"],
                "name": model_entry["name"],
                "correct": correct,
                "wrong": wrong,
                "picks": pick_outcomes,
                "pending": pending,
                "no_trade": no_trade,
                "unscorable": unscorable,
                "accuracy": correct / judged if judged else None,
                "staked_usdc": round(staked_usdc, 2),
                "brier": round(brier_sum / brier_count, 4) if brier_count else None,
                # Not recomputed here. See the module docstring: once a forecast
                # is an order, profit is a fact about the chain.
                "realised_pnl_usdc": None,
                "_brier_sum": brier_sum,
                "_brier_count": brier_count,
            }
        )

    return {
        "gw": gw,
        "scored_at": datetime.now(timezone.utc).isoformat(),
        "models": model_summaries,
    }


def update_leaderboard(gw_summary: dict, *, leaderboard_path: Path = LEADERBOARD_PATH) -> Path:
    """Folds one gameweek's score summary into the running leaderboard.

    Idempotent by gameweek: re-scoring the same gameweek (after a late
    bonus-points correction, say) replaces that gameweek's entry and recomputes
    totals from scratch rather than double-counting it.

    Brier accumulates as a sum and a count so the running figure is a true mean
    over every forecast made so far, not an average of per-gameweek averages --
    a gameweek where a model made one forecast must not weigh as much as one
    where it made ten.
    """
    if leaderboard_path.exists():
        board = json.loads(leaderboard_path.read_text())
    else:
        board = {"gameweeks": {}, "totals": {}}

    board["gameweeks"][str(gw_summary["gw"])] = gw_summary

    totals: dict[str, dict] = {}
    for gw_data in board["gameweeks"].values():
        for model in gw_data["models"]:
            slug = model["slug"]
            t = totals.setdefault(
                slug,
                {
                    "slug": slug,
                    "name": model["name"],
                    "correct": 0,
                    "wrong": 0,
                    "pending": 0,
                    "no_trade": 0,
                    "unscorable": 0,
                    "staked_usdc": 0.0,
                    "_brier_sum": 0.0,
                    "_brier_count": 0,
                },
            )
            for field in ("correct", "wrong", "pending", "no_trade", "unscorable"):
                t[field] += model.get(field, 0)
            t["staked_usdc"] += model.get("staked_usdc", 0.0)
            t["_brier_sum"] += model.get("_brier_sum", 0.0)
            t["_brier_count"] += model.get("_brier_count", 0)
            t["name"] = model["name"]  # keep the most recently seen display name

    for t in totals.values():
        judged = t["correct"] + t["wrong"]
        t["accuracy"] = t["correct"] / judged if judged else None
        t["staked_usdc"] = round(t["staked_usdc"], 2)
        t["brier"] = round(t["_brier_sum"] / t["_brier_count"], 4) if t["_brier_count"] else None
        t["realised_pnl_usdc"] = None
        # Running sums are working state, not output.
        t.pop("_brier_sum", None)
        t.pop("_brier_count", None)

    board["totals"] = totals
    board["updated_at"] = datetime.now(timezone.utc).isoformat()

    leaderboard_path.parent.mkdir(parents=True, exist_ok=True)
    leaderboard_path.write_text(json.dumps(board, indent=2, sort_keys=True))
    return leaderboard_path
