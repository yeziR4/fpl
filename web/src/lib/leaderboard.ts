/**
 * Reads the AI-agent leaderboard `data_pipeline`'s scheduled workflow
 * commits back to the repo (see .github/workflows/agent-picks.yml and
 * data_pipeline/leaderboard.py) -- a plain JSON file, not an API. Read
 * straight off disk at build time (this is a static-export site; see
 * next.config.ts) rather than fetched, since it's already sitting in
 * the same repo checkout the build runs from.
 *
 * `process.cwd()` during `next build` is the `web/` directory (the
 * deploy workflow sets `working-directory: web`), so the repo root --
 * and `data/leaderboard.json` -- is one level up from there.
 */

import { promises as fs } from "fs";
import path from "path";

export interface ModelTotal {
  slug: string;
  name: string;
  correct: number;
  wrong: number;
  pending: number;
  accuracy: number | null;
  /** Simulated VARA "wagered" (data_pipeline/oddsmaker.py) -- absent
   * (undefined) on a gameweek/total scored before bet records
   * existed, never a fabricated 0 for those. See ModelPicksSection.tsx
   * for the per-pick breakdown this rolls up from. */
  staked_vara?: number;
  /** Net simulated profit/loss across every judged pick -- negative
   * means this model would be down VARA if this were real. Same
   * absent-not-zero rule as staked_vara. */
  simulated_pnl_vara?: number;
}

/** "correct"/"wrong" mirror score_gameweek()'s own `won` check;
 * "pending" is a pick whose market hadn't resolved yet as of when this
 * gameweek was scored (shouldn't normally happen -- is_gameweek_finished()
 * already gates scoring -- but a live snapshot this pipeline hasn't
 * fetched yet is a real, if rare, case). */
export interface PickOutcome {
  player_id: number;
  threshold: number;
  outcome: "correct" | "wrong" | "pending";
}

export interface GameweekModelScore extends ModelTotal {
  /** One entry per pick this model made this specific gameweek --
   * what lets a reader see *which* bets went which way, not just the
   * folded correct/wrong counts above. Computed by
   * data_pipeline/leaderboard.py's score_gameweek() from the exact
   * same resolve_points_threshold() call the totals already use, so
   * the frontend never re-derives win/loss itself. Absent on a
   * gameweek scored before this field existed. */
  picks?: PickOutcome[];
}

export interface GameweekSummary {
  gw: number;
  scored_at: string;
  models: GameweekModelScore[];
}

export interface Leaderboard {
  gameweeks: Record<string, GameweekSummary>;
  totals: Record<string, ModelTotal>;
  updated_at: string;
}

/**
 * Returns null if no gameweek has been scored yet -- a normal, honest
 * early state (the agent-picks workflow hasn't had a finished
 * gameweek to score against), not an error.
 */
export async function loadLeaderboard(): Promise<Leaderboard | null> {
  try {
    const raw = await fs.readFile(
      path.join(process.cwd(), "..", "data", "leaderboard.json"),
      "utf-8",
    );
    return JSON.parse(raw) as Leaderboard;
  } catch {
    return null;
  }
}

/** Ranked by accuracy (nulls -- no judged picks yet -- sort last), then by total correct. */
export function rankedTotals(board: Leaderboard): ModelTotal[] {
  return Object.values(board.totals).sort((a, b) => {
    if (a.accuracy === null && b.accuracy === null) return b.correct - a.correct;
    if (a.accuracy === null) return 1;
    if (b.accuracy === null) return -1;
    if (a.accuracy !== b.accuracy) return b.accuracy - a.accuracy;
    return b.correct - a.correct;
  });
}

/** Gameweeks scored so far, most recent first. */
export function rankedGameweeks(board: Leaderboard): GameweekSummary[] {
  return Object.values(board.gameweeks).sort((a, b) => b.gw - a.gw);
}

/**
 * A model's slug (e.g. "~openai/gpt-latest") as a URL-fragment-safe
 * HTML id -- what lets LeaderboardTable's rows link straight to that
 * model's own card in ModelPicksSection on the same page ("once i
 * clicked on a model i have to see their bets", requested directly).
 * A raw slug technically works as a fragment too, but `~` and `/`
 * inside an id make it awkward to target with CSS/JS elsewhere and
 * easy to get subtly wrong in a URL, so this strips them down to a
 * plain kebab-case token instead. Both sides of the link (the href
 * LeaderboardTable builds and the id ModelPicksSection sets) call this
 * same function, so they can never drift apart.
 */
export function modelAnchorId(slug: string): string {
  return slug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
