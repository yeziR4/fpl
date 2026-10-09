/**
 * The study data: every forecast, by every participant, in one shape.
 *
 * This is a RESEARCH page, not a product. Nothing here places a bet -- betting
 * happens on Panta, and every position below is a link to a real transaction
 * anyone can check. What this file does is turn four separate records into one
 * table so a reader can compare what a model SAID against what it DID and what
 * it PAID.
 *
 * The four sources, and why they are kept apart rather than merged at source:
 *
 *   data/markets.json        what each market settles against (player, line)
 *   data/agent_picks/*.json  what each model FORECAST, with its reasoning
 *   data/agent_fills/*.json  what each model actually GOT on chain
 *   data/human_picks.json    what people said publicly
 *
 * Keeping them separate matters because they disagree in interesting ways. A
 * forecast with no side is a model that looked and passed. A forecast with a
 * side but no fill is one that wanted to trade and could not afford to -- which
 * happened, to Gemini, because a ~2% fee pushed its allocation past its
 * bankroll. Collapsing those cases together would erase the finding.
 *
 * Copied into src/data/study by scripts/sync-data.mjs at build time; see that
 * file for why the copies are not committed.
 */

import agentModels from "@/data/study/agent_models.json";
import humanPicks from "@/data/study/human_picks.json";
import markets from "@/data/study/markets.json";
import gw6Fills from "@/data/study/agent_fills/gw6.json";
import gw6Picks from "@/data/study/agent_picks/gw6.json";

export type ParticipantKind = "agent" | "human";

/** How a forecast ended up. These are genuinely different outcomes. */
export type ForecastStatus =
  | "placed" // forecast made, order filled
  | "unfilled" // forecast made, order attempted, no fill
  | "no-trade" // forecast made, no +EV side at the price, so nothing was tried
  | "passed"; // the participant looked and declined to forecast

export interface MarketRef {
  marketId: string;
  player: string;
  line: number;
  position: string;
  title: string;
  /** Where to actually trade it. This page does not take bets. */
  pantaUrl: string;
}

export interface Participant {
  kind: ParticipantKind;
  id: string;
  name: string;
  /** Agents: the lab. Humans: the X handle without the @. */
  subtitle: string;
  avatarUrl: string | null;
  address: string | null;
  url: string | null;
}

export interface Forecast {
  key: string;
  participant: Participant;
  market: MarketRef;
  side: "yes" | "no" | null;
  /** The model's stated probability the market resolves YES. */
  probability: number | null;
  /** The price of the side it took, at the moment it decided. */
  priceAtDecision: number | null;
  edge: number | null;
  stakeUsdc: number | null;
  reasoning: string;
  status: ForecastStatus;
  shares: string | null;
  fillPrice: string | null;
  signature: string | null;
  gw: number;
}

export interface GameweekStudy {
  gw: number;
  forecasts: Forecast[];
  markets: MarketRef[];
  participants: Participant[];
}

// ------------------------------------------------------------- lab metadata

interface LabMeta {
  lab: string;
  /** Drawn as a monogram badge rather than the vendor's real logo. */
  mark: string;
  /** Brand colour, for the badge and the participant chip. */
  color: string;
}

/**
 * A deliberate choice worth stating: these are monogram badges in each lab's
 * brand colour, NOT the vendors' actual logo files. Using the real marks on a
 * public page implies an association that does not exist, and a research page
 * loses credibility faster by overclaiming than by looking plain. Swap in the
 * official assets only if the labs are asked first.
 */
const LAB_META: Record<string, LabMeta> = {
  "~openai/gpt-latest": { lab: "OpenAI", mark: "OA", color: "#10a37f" },
  "~anthropic/claude-opus-latest": { lab: "Anthropic", mark: "AN", color: "#d97757" },
  "~google/gemini-pro-latest": { lab: "Google DeepMind", mark: "GD", color: "#4285f4" },
  "x-ai/grok-4.20": { lab: "xAI", mark: "xA", color: "#8b5cf6" },
  "deepseek/deepseek-v4-pro": { lab: "DeepSeek", mark: "DS", color: "#4d6bfe" },
};

export function labMeta(slug: string): LabMeta {
  return LAB_META[slug] ?? { lab: slug, mark: slug.slice(0, 2).toUpperCase(), color: "#6b7280" };
}

const PANTA_BASE = "https://panta.market/markets/";

// ------------------------------------------------------------------ records

interface RawMarket {
  market_id: string;
  player_name: string;
  threshold: number;
  position: string;
  title: string;
}

interface RawPick {
  market_id: string;
  probability: number;
  stake_usdc: number;
  reasoning: string;
  side: string | null;
  edge: number | null;
  yes_price_at_decision: number | null;
  no_price_at_decision: number | null;
}

interface RawModel {
  slug: string;
  name: string;
  solana_address: string;
  error: string | null;
  picks: RawPick[];
}

interface RawFill {
  marketId: string;
  side: string;
  shares: string | null;
  avgPrice: string | null;
  signature: string;
}

interface RawFilledModel {
  slug: string;
  name: string;
  fills: RawFill[];
}

interface RawHuman {
  handle: string;
  displayName?: string;
  avatarUrl?: string | null;
  url?: string | null;
  status?: string;
  wallet?: string | null;
  predictions?: {
    market_id: string;
    side?: string;
    reasoning?: string;
    probability?: number | null;
    confidence?: string | null;
  }[];
  fill?: { signature?: string; shares?: string; avgPrice?: string } | null;
}

function toMarketRef(m: RawMarket): MarketRef {
  return {
    marketId: m.market_id,
    player: m.player_name,
    line: m.threshold,
    position: m.position,
    title: m.title,
    pantaUrl: PANTA_BASE + m.market_id,
  };
}

const MARKET_REFS = new Map((markets as unknown as RawMarket[]).map((m) => [m.market_id, toMarketRef(m)]));

/** Markets in a stable order: kickoff order is what a reader expects. */
export const ALL_MARKETS: MarketRef[] = (markets as unknown as RawMarket[])
  .map(toMarketRef)
  .sort((a, b) => a.line - b.line || a.player.localeCompare(b.player));

function agentParticipant(model: { slug: string; name: string; solana_address: string }): Participant {
  const meta = labMeta(model.slug);
  return {
    kind: "agent",
    id: model.slug,
    name: model.name,
    subtitle: meta.lab,
    avatarUrl: null,
    address: model.solana_address,
    url: null,
  };
}

function humanParticipant(h: RawHuman): Participant {
  return {
    kind: "human",
    id: h.handle,
    name: h.displayName?.trim() || h.handle,
    subtitle: h.handle,
    avatarUrl: h.avatarUrl?.trim() || null,
    address: h.wallet?.trim() || null,
    url: h.url?.trim() || null,
  };
}

// ------------------------------------------------------------------- build

const picksBySlug = new Map(
  (gw6Picks as unknown as { gw: number; models: RawModel[] }).models.map((m) => [m.slug, m]),
);
const fillsBySlug = new Map(
  (gw6Fills as unknown as { gw: number; models: RawFilledModel[] }).models.map((m) => [m.slug, m]),
);

function buildAgentForecasts(gw: number): Forecast[] {
  const out: Forecast[] = [];

  for (const model of agentModels as unknown as { slug: string; name: string; solana_address: string }[]) {
    const participant = agentParticipant(model);
    const picked = picksBySlug.get(model.slug);
    const filled = fillsBySlug.get(model.slug);
    const fills = filled?.fills ?? [];

    // A model that errored this gameweek still gets rows, so its absence is
    // visible rather than silent. An empty table cell reads as "did nothing";
    // it should read as "could not be asked".
    for (const market of ALL_MARKETS) {
      const pick = picked?.picks.find((p) => p.market_id === market.marketId);
      const fill = fills.find((f) => f.marketId === market.marketId);

      let status: ForecastStatus;
      if (!pick) status = "passed";
      else if (fill) status = "placed";
      else if (pick.side === "yes" || pick.side === "no") status = "unfilled";
      else status = "no-trade";

      const priceAtDecision =
        pick?.side === "yes"
          ? pick.yes_price_at_decision
          : pick?.side === "no"
            ? pick.no_price_at_decision
            : null;

      out.push({
        key: `${model.slug}|${market.marketId}`,
        participant,
        market,
        side: pick?.side === "yes" || pick?.side === "no" ? pick.side : null,
        probability: pick?.probability ?? null,
        priceAtDecision,
        edge: pick?.edge ?? null,
        stakeUsdc: pick?.stake_usdc ?? null,
        reasoning: pick?.reasoning ?? "",
        status,
        shares: fill?.shares ?? null,
        fillPrice: fill?.avgPrice ?? null,
        signature: fill?.signature && !fill.signature.startsWith("(") ? fill.signature : null,
        gw,
      });
    }
  }
  return out;
}

function buildHumanForecasts(gw: number): Forecast[] {
  const out: Forecast[] = [];
  for (const h of (humanPicks as unknown as { participants: RawHuman[] }).participants ?? []) {
    const participant = humanParticipant(h);
    for (const prediction of h.predictions ?? []) {
      const market = MARKET_REFS.get(prediction.market_id);
      if (!market) continue; // a market we do not know about is skipped, never guessed
      const side = prediction.side === "yes" || prediction.side === "no" ? prediction.side : null;
      out.push({
        key: `${h.handle}|${prediction.market_id}`,
        participant,
        market,
        side,
        probability: prediction.probability ?? null,
        // Humans state a view, not a price; there is nothing to compare against
        // unless we record the pool price at the time they said it, which we do not.
        priceAtDecision: null,
        edge: null,
        stakeUsdc: null,
        reasoning: prediction.reasoning ?? "",
        status: h.fill?.signature ? "placed" : side ? "no-trade" : "passed",
        shares: h.fill?.shares ?? null,
        fillPrice: h.fill?.avgPrice ?? null,
        signature: h.fill?.signature ?? null,
        gw,
      });
    }
  }
  return out;
}

export const STUDY: GameweekStudy = {
  gw: (gw6Picks as unknown as { gw: number }).gw,
  forecasts: [...buildAgentForecasts((gw6Picks as unknown as { gw: number }).gw), ...buildHumanForecasts((gw6Picks as unknown as { gw: number }).gw)],
  markets: ALL_MARKETS,
  participants: [
    ...(agentModels as unknown as { slug: string; name: string; solana_address: string }[]).map(agentParticipant),
    ...((humanPicks as unknown as { participants: RawHuman[] }).participants ?? []).map(humanParticipant),
  ],
};

export const HUMAN_COUNT = ((humanPicks as unknown as { participants: RawHuman[] }).participants ?? []).length;

export function forecastsForForecasters(kind: ParticipantKind): Forecast[] {
  return STUDY.forecasts.filter((f) => f.participant.kind === kind);
}

/** Status counts, for the summary strip. */
export function statusCounts(forecasts: Forecast[]): Record<ForecastStatus, number> {
  const counts: Record<ForecastStatus, number> = { placed: 0, unfilled: 0, "no-trade": 0, passed: 0 };
  for (const f of forecasts) counts[f.status] += 1;
  return counts;
}
