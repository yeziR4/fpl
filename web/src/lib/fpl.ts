/**
 * FPL data access for the frontend.
 *
 * This deliberately mirrors data_pipeline/players.py and
 * data_pipeline/media.py in the Python repo -- same names, same
 * logic, same caveats -- because right now the frontend talks to the
 * FPL API directly rather than through a backend built on that
 * pipeline. That's a known short-term shortcut, not the intended
 * long-term shape: once a backend API exists (wrapping
 * data_pipeline's settlement/resolution logic for market data), this
 * file's *fetching* should be replaced by calls to that backend, so
 * FPL-specific parsing lives in exactly one place instead of two. The
 * URL-building helpers (playerPhotoUrl, teamBadgeUrl) are harmless to
 * keep here either way since they're pure functions.
 *
 * Unlike the Python pipeline (blocked from fantasy.premierleague.com
 * by this dev sandbox's egress policy), a real browser or a real
 * Next.js server has no such restriction -- these fetches work in any
 * normal deployment. See docs/architecture.md in the repo root for
 * the full network-access caveat.
 */

const API_BASE_URL = "https://fantasy.premierleague.com/api";
const MEDIA_BASE_URL = "https://resources.premierleague.com/premierleague";

export interface BootstrapElement {
  id: number;
  web_name: string;
  team: number;
  element_type: number; // 1=GKP, 2=DEF, 3=MID, 4=FWD
  now_cost: number; // tenths of a million, e.g. 150 == £15.0m
  total_points: number;
  code: number; // stable id -- what the photo CDN path actually keys on, see playerPhotoUrl
  has_temporary_code: boolean; // true for brand-new signings FPL hasn't got a real photo for yet
}

export interface BootstrapTeam {
  id: number; // season-relative, 1-20 -- what `team` above refers to
  code: number; // stable across seasons -- what the badge CDN expects
  name: string;
  short_name: string;
}

export interface BootstrapEvent {
  id: number;
  is_current: boolean;
  is_next: boolean;
}

export interface BootstrapStatic {
  elements: BootstrapElement[];
  teams: BootstrapTeam[];
  events: BootstrapEvent[];
}

export interface Fixture {
  id: number;
  event: number | null; // null when postponed / not yet scheduled into a gameweek
  team_h: number;
  team_a: number;
  finished: boolean;
  kickoff_time: string | null; // ISO 8601, null if not yet scheduled
}

export interface Player {
  id: number;
  webName: string;
  team: number;
  elementType: number;
  nowCost: number;
  code: number;
  hasTemporaryCode: boolean;
  priceMillions: number;
  /** null: no real photo available yet (hasTemporaryCode) -- render your own placeholder. */
  photoUrl: string | null;
}

/** Fetches the full current-state snapshot: players, teams, prices. */
export async function fetchBootstrapStatic(): Promise<BootstrapStatic> {
  const res = await fetch(`${API_BASE_URL}/bootstrap-static/`, {
    // Revalidate periodically rather than on every request -- prices
    // and points change at most a few times a day. Known caveat,
    // confirmed via a real deploy log: this response is ~2MB, over
    // Next's data-cache per-item limit, so in a real (non-static-export)
    // deployment this silently never actually gets cached -- every
    // request re-fetches regardless of `revalidate`. Not incorrect,
    // just not throttled the way the option implies. Fixing that for
    // real needs an external cache layer; not worth it before there's
    // a real backend to fetch this through instead (see the frontend
    // section of docs/architecture.md).
    next: { revalidate: 300 },
  });
  if (!res.ok) {
    throw new Error(`FPL bootstrap-static request failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

/** Fetches the full fixture list, past and future, across all gameweeks. */
export async function fetchFixtures(): Promise<Fixture[]> {
  const res = await fetch(`${API_BASE_URL}/fixtures/`, {
    next: { revalidate: 300 },
  });
  if (!res.ok) {
    throw new Error(`FPL fixtures request failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export interface Opponent {
  teamId: number;
  isHome: boolean;
  gw: number | null;
}

/**
 * The next fixture a team has yet to play -- the earliest not-yet-
 * finished match, by kickoff time. Deliberately per-team rather than
 * pinned to one shared "current gameweek": a gameweek's `is_current`
 * flag in bootstrap-static stays true until every match in it is
 * finished, but individual teams within it play on different days
 * (Friday through Monday). Looking up "team X's fixture in the
 * current gameweek" meant a team whose match had already been played
 * kept showing that finished match as their upcoming opponent until
 * every OTHER team's match that gameweek had also wrapped up -- a
 * real bug, not just a stale-photo complaint. This self-corrects:
 * once a team's match finishes, their next fixture is automatically
 * whichever one (this gameweek or next) comes first chronologically.
 *
 * Returns null if the team has no unplayed fixture in the data at all
 * (end of season, or fixtures not yet scheduled that far out).
 * Fixtures without a kickoff_time (postponed, not yet scheduled) sort
 * last rather than being treated as "next".
 */
export function nextFixtureForTeam(teamId: number, fixtures: Fixture[]): Opponent | null {
  const upcoming = fixtures
    .filter((f) => !f.finished && (f.team_h === teamId || f.team_a === teamId))
    .sort((a, b) => {
      if (!a.kickoff_time && !b.kickoff_time) return 0;
      if (!a.kickoff_time) return 1;
      if (!b.kickoff_time) return -1;
      return a.kickoff_time.localeCompare(b.kickoff_time);
    });
  const fixture = upcoming[0];
  if (!fixture) return null;
  const isHome = fixture.team_h === teamId;
  return { teamId: isHome ? fixture.team_a : fixture.team_h, isHome, gw: fixture.event };
}

/**
 * The `n` most expensive players by current price.
 *
 * Ties are broken by total_points (season-to-date), then by id, for a
 * stable, deterministic ordering -- same rule as
 * data_pipeline/players.py's top_expensive_players.
 */
export function topExpensivePlayers(bootstrap: BootstrapStatic, n = 20): Player[] {
  const ranked = [...bootstrap.elements].sort((a, b) => {
    if (a.now_cost !== b.now_cost) return b.now_cost - a.now_cost;
    if (a.total_points !== b.total_points) return b.total_points - a.total_points;
    return a.id - b.id;
  });
  return ranked.slice(0, n).map(toPlayer);
}

function toPlayer(element: BootstrapElement): Player {
  return {
    id: element.id,
    webName: element.web_name,
    team: element.team,
    elementType: element.element_type,
    nowCost: element.now_cost,
    code: element.code,
    hasTemporaryCode: element.has_temporary_code,
    priceMillions: element.now_cost / 10,
    photoUrl: element.has_temporary_code ? null : playerPhotoUrl(element.code),
  };
}

const POSITION_LABELS: Record<number, string> = {
  1: "GKP",
  2: "DEF",
  3: "MID",
  4: "FWD",
};

/** Short position label for a player's element_type (1=GKP..4=FWD). */
export function positionLabel(elementType: number): string {
  return POSITION_LABELS[elementType] ?? "?";
}

/**
 * A player's photo, from bootstrap-static's `code` field.
 *
 * **Verified against FPL's own production frontend bundle** (fetched
 * live from a GitHub Actions runner, which has real internet unlike
 * the dev sandbox this was built in -- see data_pipeline/media.py for
 * the full writeup). Two things confirmed there and mirrored here:
 *
 * 1. FPL's own frontend keys this URL on `elements[].code`, not by
 *    parsing the `photo` filename field the way this function used to
 *    (and the way community tooling like vaastav/Fantasy-Premier-League
 *    and amosbastian/fpl does when relaying the raw field). The two
 *    happen to be numerically identical today, but `code` is what
 *    FPL's own code actually reads.
 * 2. FPL's frontend actually requests a fresher path,
 *    `resources.premierleague.com/premierleague25/...`, but that path
 *    403s for any request without a logged-in FPL session's cookies
 *    (confirmed via Referer/Origin spoofing -- the response carries
 *    `access-control-allow-credentials: true`, the signature of
 *    session-gated access, not a header we can copy). This legacy
 *    `/premierleague/...` path is the only one actually reachable by
 *    an anonymous visitor, confirmed still-serving but confirmed stale
 *    for some players (a fetched photo came back `last-modified: Fri,
 *    16 Aug 2024`). No public fix exists for that until FPL exposes
 *    the fresher path without requiring login.
 *
 * Callers should not call this for a player with `has_temporary_code`
 * true (see Player.photoUrl / hasTemporaryCode) -- that flag means FPL
 * doesn't have a real photo for this player yet, and the CDN has no
 * confirmed placeholder path on this endpoint to fall back to.
 */
export function playerPhotoUrl(code: number, size: "40x40" | "110x140" = "110x140"): string {
  return `${MEDIA_BASE_URL}/photos/players/${size}/p${code}.png`;
}

/**
 * A team's badge, from bootstrap-static teams[].code -- the stable
 * id, not the season-relative `id` field. Use teamCodeForId to get
 * from a Player's `team` (season-relative) to this.
 */
export function teamBadgeUrl(teamCode: number, size: 50 | 70 = 50): string {
  return `${MEDIA_BASE_URL}/badges/${size}/t${teamCode}.png`;
}

export function teamCodeForId(bootstrap: BootstrapStatic, teamId: number): number {
  const team = bootstrap.teams.find((t) => t.id === teamId);
  if (!team) {
    throw new Error(`Team id ${teamId} not found in bootstrap-static data`);
  }
  return team.code;
}
