/**
 * Live Panta market data, read through our own signer service.
 *
 * Two constraints from next.config.ts shape everything here.
 *
 * Why not call Panta directly: every Panta read requires an API key, and a key
 * cannot ship in a browser bundle. So reads go through panta-signer
 * (see panta-signer/api/positions.ts), which holds the key server-side.
 *
 * Why these are CLIENT components: this site is a static export, so a Server
 * Component's fetch runs once during `next build` and bakes the result into the
 * HTML. A baked price is a wrong price the moment the market moves. Anything
 * that has to be *current* -- prices, volume, positions -- is fetched in the
 * browser instead. Server Components are still right for things that don't
 * change per request, and the FPL/generator data is read that way.
 *
 * Set NEXT_PUBLIC_PANTA_API_BASE to the deployed service. Without it the UI
 * says so plainly rather than rendering an empty market list that looks like
 * "no markets exist".
 */

const CONFIGURED = process.env.NEXT_PUBLIC_PANTA_API_BASE ?? "";

/** localhost default, development only -- see the note on empty prod config below. */
export const PANTA_API_BASE =
  CONFIGURED || (process.env.NODE_ENV === "development" ? "http://localhost:8791" : "");

/** Real shape from GET /positions?marketId=..., which is Panta's market object. */
export interface PantaMarket {
  marketId: string;
  title?: string;
  /** Panta calls the prose question `title` and the short label... the reverse
   * of what you'd guess. Keep both and let the UI decide. */
  question?: string;
  description?: string;
  category?: string;
  region?: string;
  phase?: string;
  marketType?: string;
  status?: string;
  resolved?: boolean;
  /** unix SECONDS, not milliseconds, not ISO. */
  startTime?: number;
  endTime?: number;
  resolutionTime?: number;
  images?: string[];
  resolutionCriteria?: string;
  sourcesOfTruth?: string[];
  volumeUsdc?: string | number | null;
  yesPrice?: number | string | null;
  noPrice?: number | string | null;
  primaryYesPrice?: number | string | null;
  primaryNoPrice?: number | string | null;
  [key: string]: unknown;
}

export interface PositionsSummary {
  currentValueUsdc?: string;
  primaryContributedUsdc?: string;
  valuedPositions?: number;
}

export interface Position {
  marketId: string;
  title?: string;
  images?: string[];
  side?: string;
  shares?: string;
  availableShares?: string;
  price?: string;
  [key: string]: unknown;
}

export interface PositionsResponse {
  wallet: string;
  positions: Position[];
  summary?: PositionsSummary;
}

export interface MetricsPayload {
  summary?: {
    creates?: { total?: number; byStatus?: Record<string, number> };
    trades?: { total?: number; volumeUsdc?: string; buys?: number };
  };
  [key: string]: unknown;
}

export interface MarketsPayload {
  primaryCount: number;
  secondaryCount: number;
  primary: PantaMarket[];
  secondary: PantaMarket[];
}

export class PantaUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PantaUnavailable";
  }
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  if (!PANTA_API_BASE) {
    throw new PantaUnavailable(
      "NEXT_PUBLIC_PANTA_API_BASE is not set, so live market data is unavailable.",
    );
  }
  const res = await fetch(`${PANTA_API_BASE}${path}`, {
    signal,
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    let detail = `${res.status}`;
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      detail = body.message ?? body.error ?? detail;
    } catch {
      /* keep the status code */
    }
    throw new PantaUnavailable(`Panta read failed: ${detail}`);
  }
  return (await res.json()) as T;
}

export async function fetchMarkets(signal?: AbortSignal): Promise<MarketsPayload> {
  return get<MarketsPayload>("/positions?what=markets", signal);
}

export async function fetchMarket(marketId: string, signal?: AbortSignal): Promise<PantaMarket> {
  const body = await get<{ market: PantaMarket }>(
    `/positions?marketId=${encodeURIComponent(marketId)}`,
    signal,
  );
  return body.market;
}

export async function fetchPositions(
  wallet: string,
  signal?: AbortSignal,
): Promise<PositionsResponse> {
  return get<PositionsResponse>(
    `/positions?what=positions&wallet=${encodeURIComponent(wallet)}`,
    signal,
  );
}

export async function fetchMetrics(signal?: AbortSignal): Promise<MetricsPayload> {
  const body = await get<{ metrics: MetricsPayload }>("/positions?what=metrics", signal);
  return body.metrics;
}

// ------------------------------------------------------------------ helpers

/**
 * The YES/NO prices, in the order of preference that reflects what's actually
 * populated. A primary-phase market quotes primaryYesPrice; a secondary one
 * quotes yesPrice; and we saw both come back null right after creation while
 * the order quote was already pricing at 0.50. null means "unknown", never
 * "0.50" -- the UI should say it doesn't know rather than invent a midpoint.
 */
export function yesPrice(market: PantaMarket): number | null {
  return asPrice(market.primaryYesPrice) ?? asPrice(market.yesPrice);
}

export function noPrice(market: PantaMarket): number | null {
  return asPrice(market.primaryNoPrice) ?? asPrice(market.noPrice);
}

function asPrice(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** USDC with 2dp, from a string, number, or null. */
export function usdc(value: unknown): string | null {
  const n = asPrice(value);
  return n === null ? null : `$${n.toFixed(2)}`;
}

/** Panta timestamps are unix seconds. Returns null rather than an Invalid Date. */
export function fromUnixSeconds(seconds: unknown): Date | null {
  const n = asPrice(seconds);
  return n === null ? null : new Date(n * 1000);
}

export function isPrimary(market: PantaMarket): boolean {
  return market.phase === "primary" || market.status === "primary";
}

/** Whole-market YES probability as a percentage, or null when unpriced. */
export function yesPercent(market: PantaMarket): number | null {
  const y = yesPrice(market);
  const n = noPrice(market);
  if (y === null || n === null || y + n === 0) return y === null ? null : Math.round(y * 100);
  return Math.round((y / (y + n)) * 100);
}
