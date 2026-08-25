"""Player pool selection.

v0 of the market only covers the most expensive players -- the ones
with the most public attention, the most price volatility, and (not
coincidentally) the ones a betting audience will actually have an
opinion on. This module just answers "who are they, right now".
"""

from __future__ import annotations

from dataclasses import dataclass

from .media import player_photo_url


@dataclass(frozen=True)
class Player:
    id: int
    web_name: str
    team: int
    element_type: int  # 1=GKP, 2=DEF, 3=MID, 4=FWD
    now_cost: int  # tenths of a million, e.g. 150 == £15.0m
    code: int  # stable player identifier -- what the photo CDN path actually keys on
    has_temporary_code: bool  # true for brand-new signings FPL hasn't got a real photo for yet
    total_points: int  # season-to-date -- already fetched, just not exposed before
    goals_scored: int  # season-to-date
    assists: int  # season-to-date

    @property
    def price_millions(self) -> float:
        return self.now_cost / 10

    @property
    def photo_url(self) -> str | None:
        """See media.player_photo_url. None means no real photo is
        available yet (has_temporary_code) -- render your own
        placeholder rather than guessing at an unverified FPL asset."""
        if self.has_temporary_code:
            return None
        return player_photo_url(self.code)


def _to_player(element: dict) -> Player:
    return Player(
        id=element["id"],
        web_name=element["web_name"],
        team=element["team"],
        element_type=element["element_type"],
        now_cost=element["now_cost"],
        code=element["code"],
        has_temporary_code=element.get("has_temporary_code", False),
        total_points=element.get("total_points", 0),
        goals_scored=element.get("goals_scored", 0),
        assists=element.get("assists", 0),
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
