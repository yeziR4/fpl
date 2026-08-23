"""Settlement-ready facts, derived from cached event-live snapshots.

Everything here answers a question a market needs an objective, later
answer to:

  * "How many points did player X score across gameweeks [a, a+w)?"
    -> the primary (5-GW window) and secondary (10-GW window) points
       markets both reduce to this, just with a different `window`.

  * "Did player X play the full 90 minutes in gameweek g?"
    -> the full-90 yes/no market for gameweek g.

Nothing here decides how a market prices or pays out -- that's the
staking/settlement layer, on top of these facts. Keeping this
boundary means the same facts can back a parimutuel pool today and a
different mechanism later without re-deriving anything.

A window is "incomplete" if we don't have a cached snapshot for one
of its gameweeks yet (either it hasn't been played, or we haven't
fetched it). Callers must check `is_complete` before treating a tally
as final -- an in-progress gameweek's live snapshot is provisional
until FPL marks it finished.
"""

from __future__ import annotations

from dataclasses import dataclass

from . import cache


@dataclass(frozen=True)
class PointsTally:
    player_id: int
    start_gw: int
    window: int
    per_gw_points: dict[int, int]  # only the gameweeks we actually had data for
    is_complete: bool  # True iff every gw in the window was available

    @property
    def total(self) -> int:
        return sum(self.per_gw_points.values())


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


def points_tally(player_id: int, start_gw: int, window: int, *, cache_dir=None) -> PointsTally:
    per_gw_points: dict[int, int] = {}
    for gw in range(start_gw, start_gw + window):
        stats = _player_stats_for_gw(gw, player_id, cache_dir=cache_dir)
        if stats is not None:
            per_gw_points[gw] = stats["total_points"]

    return PointsTally(
        player_id=player_id,
        start_gw=start_gw,
        window=window,
        per_gw_points=per_gw_points,
        is_complete=len(per_gw_points) == window,
    )


def full90_results(
    player_id: int, start_gw: int, window: int, *, cache_dir=None
) -> list[Full90Result]:
    """Per-gameweek full-90 facts for every gameweek we have data for.

    Gameweeks with no cached snapshot yet are simply absent from the
    result -- callers deciding whether a window is "settleable" should
    compare `len(result)` to `window`.
    """
    results = []
    for gw in range(start_gw, start_gw + window):
        stats = _player_stats_for_gw(gw, player_id, cache_dir=cache_dir)
        if stats is not None:
            results.append(Full90Result(player_id=player_id, gw=gw, minutes=stats["minutes"]))
    return results
