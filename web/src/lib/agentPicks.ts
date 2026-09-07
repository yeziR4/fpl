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
 *     picks" section renders, including each pick's bet record
 *     (data_pipeline/oddsmaker.py: a stake sized off the model's own
 *     confidence, and the potential return from this system's own
 *     rank-based odds -- never the model's opinion). Simulated, not
 *     real money -- these wallets hold nothing and have never staked
 *     for real (see docs/architecture.md) -- but a real, computed
 *     number from a real formula, not an invented one, which is what
 *     makes it worth showing at all.
 */

import { promises as fs } from "fs";
import path from "path";

interface AgentPickRecord {
  player_id: number;
  threshold: number;
  pick: "yes" | "no";
  confidence: number | null;
  market_probability: number | null;
  stake_vara: number | null;
  potential_return_vara: number | null;
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
   * (parse_picks in data_pipeline/agents.py doesn't require it). The
   * model's own stated conviction -- drives stakeVara below, never
   * marketProbability (see oddsmaker.bet_record's docstring for why a
   * model can't "buy" better odds just by claiming more confidence). */
  confidence: number | null;
  /** This system's own priced probability for the SIDE picked (not
   * necessarily "yes") -- data_pipeline/oddsmaker.py's rank-based
   * Stage-1 formula, entirely independent of the model's own opinion.
   * Null for a pick saved before bet records existed. */
  marketProbability: number | null;
  /** Simulated VARA "wagered" -- these wallets hold nothing and never
   * stake for real (see docs/architecture.md), but this is a real
   * number from a real formula (confidence-scaled), not invented.
   * Null under the same condition marketProbability is. */
  stakeVara: number | null;
  /** Total VARA this pick would return if correct, stake included --
   * stakeVara / marketProbability. Null under the same condition. */
  potentialReturnVara: number | null;
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
      marketProbability: pick.market_probability,
      stakeVara: pick.stake_vara,
      potentialReturnVara: pick.potential_return_vara,
    })),
  }));
}

/**
 * This system's own priced probability of "Yes" for one (player,
 * threshold) market, pulled straight from whichever cached agent pick
 * happens to reference it -- data_pipeline/oddsmaker.py computes
 * market_probability once per (player, threshold, gw) from real
 * player standing, the same value regardless of which model or side
 * is asking (a pick's own `market_probability` is for the SIDE that
 * model picked, so a "no" pick's value needs flipping back to "yes"
 * terms here). Null if no agent picks exist yet for this gameweek, or
 * they predate bet records (an older picks file with no
 * market_probability field at all).
 *
 * This is what StakeMarket.tsx's potential-winnings preview actually
 * prices off of -- the real current-stakes parimutuel projection
 * degenerates to "you get exactly your stake back" whenever a market
 * has no other real stakers yet (there's nothing else in the pool to
 * redistribute from), which is mathematically correct but useless to
 * show. This real, already-computed number is the fair-value seed a
 * thin/empty market needs, same reasoning as the market-maker Stage 1
 * design -- see docs/architecture.md.
 */
export async function agentMarketProbability(
  gw: number,
  playerId: number,
  threshold: number,
): Promise<number | null> {
  const file = await loadAgentPicksFile(gw);
  if (!file) return null;
  for (const model of file.models) {
    for (const pick of model.picks) {
      if (pick.player_id === playerId && pick.threshold === threshold && pick.market_probability !== null) {
        return pick.pick === "yes" ? pick.market_probability : 1 - pick.market_probability;
      }
    }
  }
  return null;
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
