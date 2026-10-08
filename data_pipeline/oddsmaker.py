"""Stage 1 of the market-maker pricing engine, rank-based: converts a
player's CURRENT standing -- both overall and within their position --
into an opening probability for a points-threshold market.

This module used to also turn a model's pick + confidence into a simulated
"bet record" -- a VARA stake, decimal odds, a potential return. That half is
gone with the move to Solana: stakes are USDC and the price comes from
Panta's pool, so there is nothing left to simulate. What remains is the
pricer, still used to choose market lines before they are created.

Deliberately a second, independent pricing source from pricing.py's
historical-clear-rate formula, not a replacement for it: rank is
available from bootstrap-static's CURRENT totals alone, so it prices a
market on day one of a season with zero cached gameweek history --
something pricing.py's Bayesian formula genuinely cannot do (with no
history to shrink toward, it degrades all the way to a flat 50/50).
Once real gameweek history accumulates, pricing.py's empirical
clear-rate is the more precise signal for the same question; this
module covers the gap before that history exists.
"""

from __future__ import annotations

from dataclasses import dataclass

from .settlement import PRIMARY_POINTS_THRESHOLD, SECONDARY_POINTS_THRESHOLD

# Two anchor points per threshold: the probability a market opens at
# for the very best-standing player in their position (percentile 1.0)
# and the very worst (percentile 0.0), linearly interpolated between
# for everyone in between. Real, stated modelling choices, not derived
# from data.
#
# STALE, AND KNOWN TO BE. These anchors are keyed on the old (5, 10)
# threshold pair. The calibrated lines are now position-specific --
# FWD 8+ / MID 7+ / DEF 5+ -- so 7 and 8 fall through to
# _DEFAULT_ANCHORS and get priced off a generic curve rather than a
# measured one. Nothing in the current pipeline depends on that being
# right, because the pool sets the price the agents actually trade at.
# Recalibrate before using this to price a market for real.
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
