"""Scores saved agent picks against real outcomes and maintains a
running leaderboard across gameweeks.

No resolution logic of its own -- reuses `resolution.py`'s
`resolve_points_threshold` / `is_gameweek_finished` directly, the same
payout-safe state machine everything else in this pipeline settles
against. This module only turns already-resolved outcomes into a
per-model scoreboard.
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
    """Score one gameweek's saved picks against resolved outcomes.

    Raises if the gameweek isn't finished yet -- scoring off a partial
    result would be exactly the premature-payout mistake resolution.py
    exists to prevent (see its module docstring). A pick whose outcome
    is somehow still PENDING even though the gameweek is finished (our
    own live snapshot not fetched yet) is counted as pending, not
    silently dropped or guessed at.
    """
    cache_kwargs = {"cache_dir": cache_dir} if cache_dir is not None else {}
    if not is_gameweek_finished(gw, **cache_kwargs):
        raise ValueError(f"GW{gw} isn't finished yet -- can't score picks against a pending result.")

    saved = agents.load_picks(gw, picks_dir=picks_dir)

    # Many models pick the same (player, threshold) pairs -- resolve
    # each one once, not once per model.
    outcome_cache: dict[tuple[int, int], MarketOutcome] = {}

    def outcome_for(player_id: int, threshold: int) -> MarketOutcome:
        key = (player_id, threshold)
        if key not in outcome_cache:
            outcome_cache[key] = resolve_points_threshold(player_id, gw, threshold, **cache_kwargs)
        return outcome_cache[key]

    model_summaries = []
    for model_entry in saved["models"]:
        correct = wrong = pending = 0
        for pick in model_entry["picks"]:
            outcome = outcome_for(pick["player_id"], pick["threshold"])
            picked_yes = pick["pick"] == "yes"
            if outcome == MarketOutcome.PENDING:
                pending += 1
            elif (outcome == MarketOutcome.YES) == picked_yes:
                correct += 1
            else:
                wrong += 1
        judged = correct + wrong
        model_summaries.append(
            {
                "slug": model_entry["slug"],
                "name": model_entry["name"],
                "correct": correct,
                "wrong": wrong,
                "pending": pending,
                "accuracy": correct / judged if judged else None,
            }
        )

    return {
        "gw": gw,
        "scored_at": datetime.now(timezone.utc).isoformat(),
        "models": model_summaries,
    }


def update_leaderboard(gw_summary: dict, *, leaderboard_path: Path = LEADERBOARD_PATH) -> Path:
    """Folds one gameweek's score summary into the running leaderboard.

    Idempotent by gameweek: re-scoring the same gameweek (e.g. after a
    late bonus-points correction) replaces that gameweek's entry and
    recomputes totals from scratch, rather than double-counting it.
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
                slug, {"slug": slug, "name": model["name"], "correct": 0, "wrong": 0, "pending": 0}
            )
            t["correct"] += model["correct"]
            t["wrong"] += model["wrong"]
            t["pending"] += model["pending"]
            t["name"] = model["name"]  # keep the most recently seen display name

    for t in totals.values():
        judged = t["correct"] + t["wrong"]
        t["accuracy"] = t["correct"] / judged if judged else None

    board["totals"] = totals
    board["updated_at"] = datetime.now(timezone.utc).isoformat()

    leaderboard_path.parent.mkdir(parents=True, exist_ok=True)
    leaderboard_path.write_text(json.dumps(board, indent=2, sort_keys=True))
    return leaderboard_path
