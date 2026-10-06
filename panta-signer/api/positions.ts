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
import { PantaError, getMarket, listMarkets, metrics, positions } from "../lib/panta.js";
import { handlePreflight, isAllowedOrigin } from "../lib/origin.js";

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

    if (want === "all" || want === "markets") {
      result.primary = await listMarkets("primary");
      result.secondary = await listMarkets("secondary");
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
