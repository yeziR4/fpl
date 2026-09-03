/**
 * Reads a gameweek's AI-agent picks (data_pipeline/agents.py's
 * output, committed to the repo at data/agent_picks/gw<N>.json) at
 * build time -- the same static-export pattern as lib/leaderboard.ts.
 *
 * Two different things this file backs, deliberately kept separate:
 *   - agentPickCounts(): "how many of the 5 models picked yes/no" for
 *     one market, folded into that market's percentage display
 *     alongside real human stakes (see StakeMarket.tsx). Participant
 *     counts, not staked amounts.
 *   - loadAgentPicksForGw() / latestAgentPicksGw(): a whole model's
 *     pick list for a gameweek -- what the leaderboard page's "Model
 *     picks" section renders. Deliberately picks-and-confidence only,
 *     no VARA figure: these wallets hold nothing and have never
 *     staked (see docs/architecture.md) -- inventing a monetary-
 *     looking number nothing backs would be exactly the kind of
 *     "looks real, isn't" this project has gone out of its way to
 *     avoid everywhere else (the faucet/staking verification work).
 */

import { promises as fs } from "fs";
import path from "path";

interface AgentPickRecord {
  player_id: number;
  threshold: number;
  pick: "yes" | "no";
  confidence: number | null;
}

interface AgentPicksModel {
  slug: string;
  name: string;
  error: string | null;
  picks: AgentPickRecord[];
}

interface AgentPicksFile {
  gw: number;
  generated_at: string;
  models: AgentPicksModel[];
}

export interface AgentPickCounts {
  yes: number;
  no: number;
}

// One file read per gameweek per build, not per player/threshold --
// every player on the homepage typically shares the same upcoming
// gameweek, so without this a build would reread the same small file
// dozens of times.
const fileCache = new Map<number, Promise<AgentPicksFile | null>>();

function loadAgentPicksFile(gw: number): Promise<AgentPicksFile | null> {
  let cached = fileCache.get(gw);
  if (!cached) {
    cached = fs
      .readFile(path.join(process.cwd(), "..", "data", "agent_picks", `gw${gw}.json`), "utf-8")
      .then((raw) => JSON.parse(raw) as AgentPicksFile)
      .catch(() => null);
    fileCache.set(gw, cached);
  }
  return cached;
}

/**
 * How many of the 5 models picked yes vs no for one (player, threshold)
 * market in a gameweek. Null if there's no picks file for that gameweek
 * at all (not generated yet, or the workflow hasn't run) -- kept
 * distinct from {yes: 0, no: 0}, which would misleadingly look like
 * the agents picked and it came out even.
 */
export async function agentPickCounts(
  gw: number,
  playerId: number,
  threshold: number,
): Promise<AgentPickCounts | null> {
  const file = await loadAgentPicksFile(gw);
  if (!file) return null;

  let yes = 0;
  let no = 0;
  for (const model of file.models) {
    for (const pick of model.picks) {
      if (pick.player_id === playerId && pick.threshold === threshold) {
        if (pick.pick === "yes") yes++;
        else no++;
      }
    }
  }
  return { yes, no };
}

export interface AgentPickDetail {
  playerId: number;
  threshold: number;
  side: "yes" | "no";
  /** 0-1, as the model reported it -- null if the model didn't give one
   * (parse_picks in data_pipeline/agents.py doesn't require it). This
   * is the model's own stated conviction, nothing more: no VARA is
   * attached to it (see ModelPicksSection.tsx's own framing) -- these
   * wallets hold nothing and have never staked, on purpose (see
   * docs/architecture.md's "AI agent picks & leaderboard" section). */
  confidence: number | null;
}

export interface ModelPicks {
  slug: string;
  name: string;
  error: string | null;
  picks: AgentPickDetail[];
}

/** Every model's full pick list for one gameweek, in the shape the
 * frontend renders directly -- unlike agentPickCounts (one market's
 * yes/no tally), this is a whole model's activity. Null under the same
 * conditions agentPickCounts is. */
export async function loadAgentPicksForGw(gw: number): Promise<ModelPicks[] | null> {
  const file = await loadAgentPicksFile(gw);
  if (!file) return null;
  return file.models.map((model) => ({
    slug: model.slug,
    name: model.name,
    error: model.error,
    picks: model.picks.map((pick) => ({
      playerId: pick.player_id,
      threshold: pick.threshold,
      side: pick.pick,
      confidence: pick.confidence,
    })),
  }));
}

/** The highest gameweek number with a saved picks file -- "the most
 * current thing the agents have said" for a picks/activity view,
 * distinct from `gw` on any one player card (which is that player's
 * own next fixture, not necessarily the newest picks file). Null if
 * data/agent_picks/ doesn't exist or is empty. */
export async function latestAgentPicksGw(): Promise<number | null> {
  try {
    const dir = path.join(process.cwd(), "..", "data", "agent_picks");
    const entries = await fs.readdir(dir);
    const gws = entries
      .map((name) => /^gw(\d+)\.json$/.exec(name))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => Number.parseInt(match[1], 10));
    if (gws.length === 0) return null;
    return Math.max(...gws);
  } catch {
    return null;
  }
}
