/**
 * Read a wallet's positions, the catalog, and our attributed volume.
 *
 * Public by design (origin-allowlisted, not bearer-gated). It reads through our
 * Panta key, so a stranger could burn some quota, but it cannot move funds and
 * gating it would mean shipping a token in the frontend bundle.
 *
 * Three things worth knowing about the data:
 *
 *   - Panta returns share *counts*, never USD. To show a value you join against
 *     the market price yourself: open value ~= shares * the matching side
 *     price, and after resolution a winner is ~shares * 1 USDC, a loser ~0.
 *   - `metrics` returns volumeUsdcBase, Panta's own attribution number for what
 *     our integration drove. That is how the "Traction" judging criterion gets
 *     answered with the sponsor's figure rather than our claim.
 *   - /positions is the endpoint a Panta builder reported returning nothing
 *     after a verified, attributed buy. If that reproduces here, it breaks the
 *     core UX, so it is worth a dedicated action rather than being folded into
 *     a general read.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  PantaError,
  getMarket,
  listAllMarkets,
  metrics,
  positions,
  quoteOrder,
} from "../lib/panta.js";
import { handlePreflight, isAllowedOrigin } from "../lib/origin.js";

/**
 * Whose wallet the price probes quote against. Any valid address works -- a
 * quote reserves nothing and cannot move funds -- so this is the creator's,
 * which at least makes the probes attributable in Panta's own logs.
 */
const QUOTE_WALLET = "65YstDRZo7KXqtwFifypnFNiSKh2VGGh8bXNCSqNcyyM";
/** Panta's own minimum order size. Enough to read the price, small enough not to move it. */
const PROBE_USDC = "0.10";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handlePreflight(req, res)) return;

  if (req.method !== "GET") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }
  if (!isAllowedOrigin(req)) {
    res.status(403).json({ error: "origin_not_allowed" });
    return;
  }

  const raw = req.query ?? {};
  const first = (value: unknown): string | undefined =>
    Array.isArray(value) ? (typeof value[0] === "string" ? value[0] : undefined)
      : typeof value === "string" ? value : undefined;

  const wallet = first(raw.wallet);
  const marketId = first(raw.marketId);
  const want = first(raw.what) ?? "all";

  try {
    const result: Record<string, unknown> = {};

    if (want === "prices") {
      // Panta publishes NO price on the market object. Verified by dumping every
      // field on our own live market: yesPrice, noPrice, primaryYesPrice,
      // primaryNoPrice, secondaryYesPrice, secondaryNoPrice and volumeUsdc are
      // all null even though the market has liquidity and an order quote prices
      // it at 0.50.
      //
      // So the only way to learn the current price is to ask for one. Quoting is
      // free, reserves nothing, and the quote lives about 90 seconds.
      //
      // Both sides are probed separately rather than assuming the pair sums to
      // 1. With a real spread it does not, and telling the models otherwise
      // would hand every one of them a phantom edge.
      const ids = marketId
        ? [marketId]
        : (await listAllMarkets("primary")).map((m) => String(m.marketId)).filter(Boolean);

      const prices: Record<string, unknown> = {};
      await Promise.all(
        ids.map(async (id) => {
          try {
            const [yes, no] = await Promise.all([
              quoteOrder({ marketId: id, side: "yes", amountUsdc: PROBE_USDC, wallet: QUOTE_WALLET }),
              quoteOrder({ marketId: id, side: "no", amountUsdc: PROBE_USDC, wallet: QUOTE_WALLET }),
            ]);
            const y = Number(yes.avgPrice);
            const n = Number(no.avgPrice);
            prices[id] =
              Number.isFinite(y) && Number.isFinite(n)
                ? { yesPrice: y, noPrice: n, source: "quote" }
                : { error: "quote returned no usable avgPrice" };
          } catch (error) {
            // One unpriceable market must not sink the others.
            prices[id] = { error: error instanceof PantaError ? error.code : String(error) };
          }
        }),
      );
      result.prices = prices;
      res.status(200).json(result);
      return;
    }

    if (want === "all" || want === "markets") {
      // The catalog returns { items, nextCursor }, and today every live market
      // sits in the secondary phase: `status=primary` legitimately comes back
      // empty. Both phases are paged to the end here so a caller can tell the
      // difference between "no primary markets" and "we failed to read them".
      const [primary, secondary] = await Promise.all([
        listAllMarkets("primary"),
        listAllMarkets("secondary"),
      ]);
      result.primaryCount = primary.length;
      result.secondaryCount = secondary.length;
      result.primary = primary;
      result.secondary = secondary;
    }
    if (marketId) {
      result.market = await getMarket(marketId);
    }
    if (wallet && (want === "all" || want === "positions")) {
      result.positions = await positions(wallet);
    }
    if (want === "all" || want === "metrics") {
      result.metrics = await metrics();
    }

    res.status(200).json(result);
  } catch (error) {
    if (error instanceof PantaError) {
      res.status(error.status === 0 ? 502 : error.status).json({
        error: error.code,
        message: error.message,
      });
      return;
    }
    console.error("positions read failed", error);
    res.status(502).json({ error: "read_failed" });
  }
}
