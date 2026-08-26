/**
 * Reads a gameweek's AI-agent picks (data_pipeline/agents.py's
 * output, committed to the repo at data/agent_picks/gw<N>.json) at
 * build time -- the same static-export pattern as lib/leaderboard.ts.
 *
 * Used to fold "how many of the 5 models picked yes/no" into each
 * market's percentage display alongside real human stakes (see
 * StakeMarket.tsx) -- this is what "percentage of people/agents who
 * picked yes or no" actually means: participant counts, not staked
 * amounts (that's a separate figure, from lib/vara/stake.ts).
 */

import { promises as fs } from "fs";
import path from "path";

interface AgentPickRecord {
  player_id: number;
  threshold: number;
  pick: "yes" | "no";
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
