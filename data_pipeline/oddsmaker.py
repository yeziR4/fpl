"""Stage 1 of the market-maker pricing engine, rank-based: converts a
player's CURRENT standing -- both overall and within their position --
into an opening probability, plus the stake/payout math that turns a
model's pick + confidence into a real "bet record" (side, VARA amount,
implied odds, potential return).

Deliberately a second, independent pricing source from pricing.py's
historical-clear-rate formula, not a replacement for it: rank is
available from bootstrap-static's CURRENT totals alone, so it prices a
market on day one of a season with zero cached gameweek history --
something pricing.py's Bayesian formula genuinely cannot do (with no
history to shrink toward, it degrades all the way to a flat 50/50).
Once real gameweek history accumulates, pricing.py's empirical
clear-rate is the more precise signal for the same question; this
module is what covers the gap before that history exists, and what
currently backs the AI agents' bet records specifically (see
agents.py) -- the models need a real price to buy into every
gameweek, including the first one of a season.
"""

from __future__ import annotations

from dataclasses import dataclass, replace

from .settlement import PRIMARY_POINTS_THRESHOLD, SECONDARY_POINTS_THRESHOLD

# Two anchor points per threshold: the probability a market opens at
# for the very best-standing player in their position (percentile 1.0)
# and the very worst (percentile 0.0), linearly interpolated between
# for everyone in between. Real, stated modeling choices -- not
# derived from data, worth revisiting once enough real settlements
# exist to calibrate against (same "tunable constant, not derived"
# discipline pricing.py's PRIOR_STRENGTH already follows). The harder
# threshold (10) gets a visibly lower ceiling than the easier one (5):
# even the best-standing player in a position shouldn't be priced as a
# near-certainty to clear a bar most players rarely reach.
_THRESHOLD_ANCHORS: dict[int, tuple[float, float]] = {
    PRIMARY_POINTS_THRESHOLD: (0.10, 0.80),  # (worst-standing, best-standing) probability
    SECONDARY_POINTS_THRESHOLD: (0.03, 0.45),
}
_DEFAULT_ANCHORS = (0.05, 0.60)  # any threshold not explicitly anchored above

# How much overall-pool standing (vs. position-relative standing)
# factors into the blended percentile below. Position standing is
# weighted higher deliberately: "will this defender clear 5" is a
# position-relative question first, general prominence a distant
# second.
_POSITION_WEIGHT = 0.75


def _percentile(rank: int, count: int) -> float:
    """1.0 = best (rank 1), 0.0 = worst (rank == count). A group of
    one (count == 1) is treated as exactly average -- there's no peer
    to be better or worse than."""
    if count <= 1:
        return 0.5
    return 1 - (rank - 1) / (count - 1)


@dataclass(frozen=True)
class PlayerStanding:
    overall_percentile: float
    position_percentile: float


def player_standing(player_id: int, bootstrap: dict) -> PlayerStanding:
    """Where a player currently sits, by total_points -- overall among
    every player in bootstrap-static, and within their own position
    (element_type). Ties broken by id for a stable, deterministic
    ranking, same tiebreak rule players.py's top_expensive_players
    already uses."""
    elements = bootstrap["elements"]
    target = next((e for e in elements if e["id"] == player_id), None)
    if target is None:
        raise ValueError(f"Player {player_id} not found in bootstrap-static data")

    overall_ranked = sorted(elements, key=lambda e: (-e["total_points"], e["id"]))
    overall_rank = next(i for i, e in enumerate(overall_ranked, start=1) if e["id"] == player_id)

    position_pool = [e for e in elements if e["element_type"] == target["element_type"]]
    position_ranked = sorted(position_pool, key=lambda e: (-e["total_points"], e["id"]))
    position_rank = next(i for i, e in enumerate(position_ranked, start=1) if e["id"] == player_id)

    return PlayerStanding(
        overall_percentile=_percentile(overall_rank, len(overall_ranked)),
        position_percentile=_percentile(position_rank, len(position_pool)),
    )


def market_probability(player_id: int, threshold: int, bootstrap: dict) -> float:
    """The opening probability a (player, threshold) market should
    price at, from nothing but the player's CURRENT standing -- see
    the module docstring for why this exists alongside pricing.py's
    historical formula rather than instead of it."""
    standing = player_standing(player_id, bootstrap)
    percentile = _POSITION_WEIGHT * standing.position_percentile + (1 - _POSITION_WEIGHT) * standing.overall_percentile
    low, high = _THRESHOLD_ANCHORS.get(threshold, _DEFAULT_ANCHORS)
    return low + percentile * (high - low)


# --- Bet sizing: turning a model's pick + confidence into a real record ---

MIN_STAKE_VARA = 1.0
MAX_STAKE_VARA = 5.0
# A model that didn't return a usable confidence value still gets a
# real bet record -- defaults to the midpoint rather than either
# extreme, since "no stated confidence" isn't the same as "very
# confident" or "not confident at all".
DEFAULT_CONFIDENCE = 0.5


@dataclass(frozen=True)
class BetRecord:
    stake_vara: float
    market_probability: float  # this system's own priced probability for the SIDE picked
    potential_return_vara: float  # total VARA back if the pick is correct (stake included)


def bet_record(
    *, pick_yes: bool, confidence: float | None, player_id: int, threshold: int, bootstrap: dict
) -> BetRecord:
    """The full bet record for one model's one pick: how much it
    "wagers" (simulated -- these five wallets hold nothing real and
    never stake for real, see docs/architecture.md) scaled by its own
    stated confidence, and what it stands to get back given this
    system's own priced odds for the side it picked.

    Confidence drives SIZE only -- the aggressiveness signal a
    leaderboard can compare across models (one consistently staking
    near MAX_STAKE_VARA reads as overconfident, not just often-right-
    or-wrong). It never touches the odds themselves, which come
    entirely from market_probability() above: a model can't "buy"
    better odds just by claiming more confidence, any more than a real
    bettor can move a real market's price by being loud about their
    own opinion.
    """
    c = confidence if confidence is not None else DEFAULT_CONFIDENCE
    stake = MIN_STAKE_VARA + (MAX_STAKE_VARA - MIN_STAKE_VARA) * c

    p_yes = market_probability(player_id, threshold, bootstrap)
    p_side = p_yes if pick_yes else (1 - p_yes)
    p_side = min(max(p_side, 0.01), 0.99)  # keep decimal odds finite even at the extremes

    decimal_odds = 1 / p_side
    return BetRecord(
        stake_vara=round(stake, 2),
        market_probability=round(p_side, 4),
        potential_return_vara=round(stake * decimal_odds, 2),
    )


def with_bet_record(pick, bootstrap: dict):
    """Enriches an already-parsed AgentPick (see agents.py) with its
    bet record. A thin adapter, not agents.py's own concern -- keeps
    parse_picks() a pure parser of the model's reply with no pricing
    logic of its own, and keeps this module ignorant of AgentPick's
    exact shape beyond the four fields every caller already has."""
    record = bet_record(
        pick_yes=pick.pick,
        confidence=pick.confidence,
        player_id=pick.player_id,
        threshold=pick.threshold,
        bootstrap=bootstrap,
    )
    return replace(
        pick,
        market_probability=record.market_probability,
        stake_vara=record.stake_vara,
        potential_return_vara=record.potential_return_vara,
    )
