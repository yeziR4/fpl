"""Market resolution: turns a settlement fact into a final, payout-safe outcome.

A settlement fact (`points_result` / `full90_result` in `settlement.py`)
becomes available the moment we've cached *any* live snapshot for a
gameweek -- but a snapshot can be mid-match or provisional:

  * If the fixture hasn't finished yet, `minutes` and `total_points`
    are still changing. Resolving off that would let a market pay out
    on a number that isn't final yet.
  * Even right at full time, FPL keeps recalculating bonus points for
    up to about an hour afterwards (`finished_provisional` flips to
    `finished` once that settles). `total_points` can still move in
    that window even though the match is over and `minutes` won't.

So resolution is a state machine, not a straight read of the cached
data: PENDING until the underlying fixture is confirmed FINISHED, only
then YES/NO. This module is what a market -- and eventually an
on-chain oracle call -- should actually call, not `settlement.py`
directly.

FULL-90 DEFINITION, AND THE STOPPAGE-TIME QUESTION
---------------------------------------------------
"Full 90" resolves YES iff FPL's own `minutes` stat for that player in
that gameweek is >= 90 (see PRIMARY_POINTS_THRESHOLD's sibling logic in
settlement.py). That entirely piggybacks on how FPL (via Opta) defines
minutes played -- and as far as we've been able to confirm, that stat
does NOT separately tally stoppage/added time on top of the normal
90-minute frame of a match. A player substituted at, say, 90+3' has
historically been recorded with `minutes == 90`, the same value as a
player who plays every second of stoppage time and is never subbed. If
that holds, the scenario "a player gets subbed late in stoppage time
and wrongly resolves to NO" doesn't actually happen from the raw data
-- both cases show `minutes == 90`, so both resolve YES under our `>=
90` rule.

This has **not** been verified against live data from this
environment -- network access to the FPL API is blocked in this
sandbox (see docs/architecture.md). Before this market runs with real
money, verify it directly: pick a known match where a player was
subbed in second-half stoppage time and check their actual cached
`minutes` value. If FPL *does* report minutes above 90 for players who
survive into stoppage time, the fix is a one-line threshold change
here (e.g. "minutes >= kickoff-to-final-whistle duration" instead of a
flat 90), not a redesign of anything in this module.
"""

from __future__ import annotations

from enum import Enum

from . import cache
from .settlement import full90_result, points_result


class FixtureStatus(str, Enum):
    # No single fixture found for this player's team in this gameweek.
    # Zero matches means a blank gameweek for that team; more than one
    # means a double gameweek. Neither is handled in v0 -- surfaced
    # distinctly so callers don't guess which fixture to resolve against.
    NOT_FOUND = "not_found"
    IN_PROGRESS = "in_progress"
    FINISHED = "finished"


class MarketOutcome(str, Enum):
    PENDING = "pending"
    YES = "yes"
    NO = "no"


def _player_team(player_id: int, *, cache_dir=None) -> int:
    kwargs = {"cache_dir": cache_dir} if cache_dir is not None else {}
    bootstrap = cache.load_latest_bootstrap_static(**kwargs)
    for element in bootstrap["elements"]:
        if element["id"] == player_id:
            return element["team"]
    raise ValueError(f"Player {player_id} not found in cached bootstrap-static data")


def fixture_status_for_player(player_id: int, gw: int, *, cache_dir=None) -> FixtureStatus:
    kwargs = {"cache_dir": cache_dir} if cache_dir is not None else {}
    team_id = _player_team(player_id, cache_dir=cache_dir)
    fixtures = cache.load_latest_fixtures(**kwargs)
    team_fixtures = [
        f for f in fixtures if f["event"] == gw and team_id in (f["team_h"], f["team_a"])
    ]
    if len(team_fixtures) != 1:
        return FixtureStatus.NOT_FOUND
    return FixtureStatus.FINISHED if team_fixtures[0].get("finished") else FixtureStatus.IN_PROGRESS


def resolve_full90(player_id: int, gw: int, *, cache_dir=None) -> MarketOutcome:
    if fixture_status_for_player(player_id, gw, cache_dir=cache_dir) != FixtureStatus.FINISHED:
        return MarketOutcome.PENDING
    result = full90_result(player_id, gw, cache_dir=cache_dir)
    if result is None:
        # Fixture is over, but we haven't fetched/cached the live snapshot
        # for it yet -- pending on our own pipeline, not on the match.
        return MarketOutcome.PENDING
    return MarketOutcome.YES if result.played_full_90 else MarketOutcome.NO


def resolve_points_threshold(
    player_id: int, gw: int, threshold: int, *, cache_dir=None
) -> MarketOutcome:
    if fixture_status_for_player(player_id, gw, cache_dir=cache_dir) != FixtureStatus.FINISHED:
        return MarketOutcome.PENDING
    result = points_result(player_id, gw, cache_dir=cache_dir)
    if result is None:
        return MarketOutcome.PENDING
    return MarketOutcome.YES if result.over(threshold) else MarketOutcome.NO
