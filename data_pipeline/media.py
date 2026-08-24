"""Media asset URLs: player photos and team badges from the FPL image CDN.

**Not verified against a live response from this environment.** Outbound
access to resources.premierleague.com is blocked in this sandbox, same
as the main API host (see docs/architecture.md). The URL patterns below
are the ones the wider FPL tooling ecosystem uses (vaastav/Fantasy-
Premier-League, amosbastian/fpl, and others reverse-engineered them
independently and agree) but this repo has not itself confirmed one
resolves to a real image. Before wiring this into the frontend for
real: fetch bootstrap-static somewhere with open egress, build a URL
for one real player and one real team with the functions below, and
check it actually loads. Update this docstring once confirmed.

No new fetch is needed for any of this. Both a player's photo code and
a team's stable badge code are already present in the bootstrap-static
snapshot the pipeline already caches -- see
`cache.load_latest_bootstrap_static`.
"""

from __future__ import annotations

MEDIA_BASE_URL = "https://resources.premierleague.com/premierleague"


def player_photo_url(photo: str, *, size: str = "110x140") -> str:
    """A player's photo, from bootstrap-static elements[].photo (e.g. "223094.jpg").

    That field carries a .jpg extension, but the image is actually
    served as .png at a different path under the CDN -- that's a
    known quirk of the source data, consistently handled the same way
    across the community tooling this pattern is drawn from, not a
    typo here.
    """
    code = photo.rsplit(".", 1)[0]
    return f"{MEDIA_BASE_URL}/photos/players/{size}/p{code}.png"


def team_badge_url(team_code: int, *, size: int = 50) -> str:
    """A team's badge, from bootstrap-static teams[].code.

    Deliberately takes the team's stable `code`, not the season-relative
    `id` (1-20) that Player.team and fixtures carry -- bootstrap-static
    has both as separate fields on each team, and only `code` is what
    the badge CDN path is documented to expect. Use `team_code_for_id`
    to go from the id you already have to the code this needs.
    """
    return f"{MEDIA_BASE_URL}/badges/{size}/t{team_code}.png"


def team_code_for_id(bootstrap_static: dict, team_id: int) -> int:
    """Looks up a team's stable `code` from its season-relative `id`.

    Player.team and fixtures.team_h/team_a are all the season-relative
    id (1-20); the badge URL needs the separate stable `code` field
    instead. Both live on the same team entry in bootstrap-static.
    """
    for team in bootstrap_static["teams"]:
        if team["id"] == team_id:
            return team["code"]
    raise ValueError(f"Team id {team_id} not found in cached bootstrap-static data")
