/**
 * Live VARA -> USD price, so bet sizes and balances can be shown in
 * dollars -- requested directly: "we have to use $$$ so it is easy
 * for the user to understand". The actual on-chain unit never
 * changes, this is display-only: every real transfer still moves a
 * planck-precise VARA amount (see units.ts, stake.ts) exactly as
 * before. $ is a second, derived label on top of that real number,
 * never a replacement for it.
 *
 * Source: CoinGecko's public `/simple/price` endpoint (coin id
 * `vara-network`, confirmed via CoinGecko's own site -- see
 * https://www.coingecko.com/en/coins/vara-network). No API key
 * needed for this endpoint; it's the same public, CORS-open call
 * pattern used client-side by most crypto-facing frontends. Blocked
 * from this dev sandbox's egress (same restriction that's affected
 * vara.network and others all project -- see docs/architecture.md),
 * so this hasn't been exercised live from here; verify against the
 * real deployed site before leaning on it further.
 *
 * Deliberately fails soft to null on any error (network, rate limit,
 * malformed response) -- every caller falls back to VARA-only display
 * rather than showing a stale or fabricated dollar figure, the same
 * "never show a number nothing backs" discipline balance/faucet
 * errors already follow elsewhere in this app.
 */

const COINGECKO_SIMPLE_PRICE_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=vara-network&vs_currencies=usd";

// Re-fetched at most this often, shared across every component that
// asks -- CoinGecko's free tier rate-limits by IP, and a price moving
// meaningfully inside a minute isn't something this app needs to
// track any closer than that.
const CACHE_TTL_MS = 60_000;

let cached: { priceUsd: number; fetchedAt: number } | null = null;
let inFlight: Promise<number | null> | null = null;

/** USD price of 1 VARA, or null if it couldn't be fetched. */
export async function fetchVaraUsdPrice(): Promise<number | null> {
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.priceUsd;
  }
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const res = await fetch(COINGECKO_SIMPLE_PRICE_URL);
      if (!res.ok) return null;
      const body = (await res.json()) as { "vara-network"?: { usd?: number } };
      const priceUsd = body["vara-network"]?.usd;
      if (typeof priceUsd !== "number" || !Number.isFinite(priceUsd)) return null;
      cached = { priceUsd, fetchedAt: Date.now() };
      return priceUsd;
    } catch {
      return null;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Formats a VARA amount (decimal string, same shape units.ts deals
 * in) as a dollar string, e.g. "$2.34" -- null if the amount doesn't
 * parse or no price is available yet, so callers can render nothing
 * rather than "$NaN". Amounts under a cent still show as "<$0.01"
 * rather than rounding away to "$0.00", which would misleadingly
 * read as free. */
export function formatUsd(varaAmount: string | number, priceUsd: number): string | null {
  const vara = typeof varaAmount === "number" ? varaAmount : Number(varaAmount);
  if (!Number.isFinite(vara)) return null;
  const usd = vara * priceUsd;
  if (usd > 0 && usd < 0.01) return "<$0.01";
  return `$${usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
