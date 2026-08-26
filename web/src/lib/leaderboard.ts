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
}

export type GameweekModelScore = ModelTotal;

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
