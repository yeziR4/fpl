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
  photo: string; // e.g. "223094.jpg" -- see playerPhotoUrl
}

export interface BootstrapTeam {
  id: number; // season-relative, 1-20 -- what `team` above refers to
  code: number; // stable across seasons -- what the badge CDN expects
  name: string;
  short_name: string;
}

export interface BootstrapStatic {
  elements: BootstrapElement[];
  teams: BootstrapTeam[];
}

export interface Player {
  id: number;
  webName: string;
  team: number;
  elementType: number;
  nowCost: number;
  photo: string;
  priceMillions: number;
  photoUrl: string;
}

/** Fetches the full current-state snapshot: players, teams, prices. */
export async function fetchBootstrapStatic(): Promise<BootstrapStatic> {
  const res = await fetch(`${API_BASE_URL}/bootstrap-static/`, {
    // Revalidate periodically rather than on every request -- prices
    // and points change at most a few times a day.
    next: { revalidate: 300 },
  });
  if (!res.ok) {
    throw new Error(`FPL bootstrap-static request failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
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
    photo: element.photo,
    priceMillions: element.now_cost / 10,
    photoUrl: playerPhotoUrl(element.photo),
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
 * A player's photo, from bootstrap-static's `photo` field (e.g. "223094.jpg").
 *
 * That field carries a .jpg extension, but the CDN serves .png at a
 * different path -- a known quirk of the source data, not a typo
 * here. See data_pipeline/media.py for the Python equivalent and the
 * "not verified against a live response" caveat, which applies here
 * too until someone checks a real URL loads.
 */
export function playerPhotoUrl(photo: string, size: "40x40" | "110x140" = "110x140"): string {
  const code = photo.replace(/\.[a-zA-Z0-9]+$/, "");
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
