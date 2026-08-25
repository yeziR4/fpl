"""Media asset URLs: player photos and team badges from the FPL image CDN.

**Verified against FPL's own production code** -- via a one-off GitHub
Actions job (GitHub's runners have real internet; this sandbox doesn't)
that fetched fantasy.premierleague.com's live frontend bundle and read
the actual source. Two real findings, one good, one a dead end:

1. FPL's frontend keys photo URLs on `elements[].code` (a stable
   numeric id), not by parsing the `photo` filename field the way this
   module and the wider community tooling (vaastav/Fantasy-Premier-
   League, amosbastian/fpl -- neither of which, on inspection, actually
   builds a photo URL themselves; they only archive/relay the raw
   field) have done. As of this check the two are identical for every
   player in the current bootstrap-static snapshot (0 mismatches across
   610 elements), but `code` is what FPL's own code actually reads, so
   it's the correct source of truth going forward, not just today's
   coincidence. `player_photo_url` below takes `code` directly now.

2. FPL's frontend requests a *different, fresher* path than this
   module has ever used: `resources.premierleague.com/premierleague25/photos/players/...`
   (and `.../premierleague25/badges/{code}.svg` for badges) rather than
   the bare `/premierleague/...` path below. Confirmed the bare path
   really is stale, not just an assumption: a fetched photo came back
   with `last-modified: Fri, 16 Aug 2024` -- two-year-old data. BUT the
   `premierleague25` path returned `403 Access Denied` on every attempt
   from a plain server-side request, including with `Referer` and
   `Origin` spoofed to fantasy.premierleague.com's own -- the response
   carried `access-control-allow-credentials: true`, the signature of
   an endpoint gated behind a logged-in session's cookies, not a header
   check we could just copy. There is no known way to request it
   without a real FPL user's authenticated session, which a public,
   anonymous-visitor site cannot obtain or ethically fake. So: the
   fresher endpoint exists, we found it, and it isn't usable here.

Net effect: the bare `/premierleague/...` path below is not a mistake
to fix, it's the only one that is actually publicly reachable --
confirmed, not assumed. Photos can be genuinely stale for some players
compared to what a logged-in FPL user sees, and there is currently no
accessible fix for that from an unauthenticated backend. Revisit if
FPL ever exposes this path (or an equivalent) without requiring login.

No new fetch is needed for any of this. Both a player's `code` and a
team's stable badge `code` are already present in the bootstrap-static
snapshot the pipeline already caches -- see
`cache.load_latest_bootstrap_static`.
"""

from __future__ import annotations

MEDIA_BASE_URL = "https://resources.premierleague.com/premierleague"


def player_photo_url(code: int, *, size: str = "110x140") -> str:
    """A player's photo, from bootstrap-static elements[].code.

    Does not handle `has_temporary_code` (true for brand-new signings
    FPL doesn't have a real photo for yet) -- that's Player.photo_url's
    job in players.py, which returns None for that case rather than
    guessing at a placeholder path on this endpoint that's never been
    confirmed to exist here (FPL's own frontend requests a "placeholder"
    file, but on the gated premierleague25 path, not this one).
    """
    return f"{MEDIA_BASE_URL}/photos/players/{size}/p{code}.png"


def team_badge_url(team_code: int, *, size: int = 50) -> str:
    """A team's badge, from bootstrap-static teams[].code.

    Deliberately takes the team's stable `code`, not the season-relative
    `id` (1-20) that Player.team and fixtures carry -- bootstrap-static
    has both as separate fields on each team, and `code` is what this
    CDN path expects. Use `team_code_for_id` to go from the id you
    already have to the code this needs.

    Same staleness caveat as player_photo_url: confirmed via a live
    fetch that this path serves a badge last modified June 2023, while
    FPL's own frontend requests a fresher `.svg` badge from the gated
    premierleague25 path (see this module's docstring) that isn't
    reachable from here. Team crests change far less often than player
    photos, so this matters much less in practice, but it's the same
    root cause.
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
