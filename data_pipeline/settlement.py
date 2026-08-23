"""Settlement-ready facts, derived from cached event-live snapshots.

Everything here answers a question a market needs an objective, later
answer to, for one specific gameweek (one match) at a time -- these
markets do not accumulate across gameweeks, they reset every week:

  * "Did player X score >= 5 points in gameweek g?" -> the primary
    points market for that gameweek.
  * "Did player X score >= 10 points in gameweek g?" -> the secondary
    points market for that gameweek (same underlying number, higher
    bar).
  * "Did player X play the full 90 minutes in gameweek g?" -> the
    full-90 yes/no market for that gameweek.

Nothing here decides how a market prices or pays out -- that's the
staking/settlement layer, on top of these facts. Keeping this
boundary means the same facts can back a parimutuel pool today and a
different mechanism later without re-deriving anything.
"""

from __future__ import annotations

from dataclasses import dataclass

from . import cache

# The two point lines the points markets are settled against. Both are
# evaluated against a single gameweek's return, not summed across
# multiple gameweeks.
PRIMARY_POINTS_THRESHOLD = 5
SECONDARY_POINTS_THRESHOLD = 10


@dataclass(frozen=True)
class PointsResult:
    player_id: int
    gw: int
    points: int

    def over(self, threshold: int) -> bool:
        """Whether this gameweek's points clear the given line (>=)."""
        return self.points >= threshold


@dataclass(frozen=True)
class Full90Result:
    player_id: int
    gw: int
    minutes: int

    @property
    def played_full_90(self) -> bool:
        return self.minutes >= 90


def _player_stats_for_gw(event_id: int, player_id: int, *, cache_dir=None) -> dict | None:
    kwargs = {"cache_dir": cache_dir} if cache_dir is not None else {}
    if not cache.has_event_live(event_id, **kwargs):
        return None
    live = cache.load_event_live(event_id, **kwargs)
    for element in live["elements"]:
        if element["id"] == player_id:
            return element["stats"]
    return None


def points_result(player_id: int, gw: int, *, cache_dir=None) -> PointsResult | None:
    """A player's points for a single gameweek, or None if not cached yet."""
    stats = _player_stats_for_gw(gw, player_id, cache_dir=cache_dir)
    if stats is None:
        return None
    return PointsResult(player_id=player_id, gw=gw, points=stats["total_points"])


def full90_result(player_id: int, gw: int, *, cache_dir=None) -> Full90Result | None:
    """A player's full-90 outcome for a single gameweek, or None if not cached yet."""
    stats = _player_stats_for_gw(gw, player_id, cache_dir=cache_dir)
    if stats is None:
        return None
    return Full90Result(player_id=player_id, gw=gw, minutes=stats["minutes"])
