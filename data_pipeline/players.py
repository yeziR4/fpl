"""Player pool selection.

v0 of the market only covers the most expensive players -- the ones
with the most public attention, the most price volatility, and (not
coincidentally) the ones a betting audience will actually have an
opinion on. This module just answers "who are they, right now".
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Player:
    id: int
    web_name: str
    team: int
    element_type: int  # 1=GKP, 2=DEF, 3=MID, 4=FWD
    now_cost: int  # tenths of a million, e.g. 150 == £15.0m

    @property
    def price_millions(self) -> float:
        return self.now_cost / 10


def _to_player(element: dict) -> Player:
    return Player(
        id=element["id"],
        web_name=element["web_name"],
        team=element["team"],
        element_type=element["element_type"],
        now_cost=element["now_cost"],
    )


def top_expensive_players(bootstrap_static: dict, n: int = 20) -> list[Player]:
    """The `n` most expensive players by current price.

    Ties are broken by total_points (season-to-date) so the ordering
    is stable and favours the player more likely to be relevant to a
    market, then by id as a final deterministic tiebreak.
    """
    elements = bootstrap_static["elements"]
    ranked = sorted(
        elements,
        key=lambda e: (-e["now_cost"], -e.get("total_points", 0), e["id"]),
    )
    return [_to_player(e) for e in ranked[:n]]
