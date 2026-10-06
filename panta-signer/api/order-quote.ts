/**
 * Steps 1 and 2 of a primary buy: quote, then build.
 *
 * Both calls happen here rather than in the browser because a quote is good for
 * only ~90 seconds. Doing the round trip twice from a static page on GitHub
 * Pages -- once to us, once to Panta -- wastes a meaningful slice of that
 * window before the user has even seen a price. One call, one hop, and the
 * client gets `instructions` + `recentBlockhash` ready to compile and sign.
 *
 * Public by design: it spends nothing, and gating it would mean shipping a
 * bearer token in the frontend bundle. See lib/origin.ts.
 *
 * Note the asymmetry with market creation -- Panta returns *instructions* for a
 * primary buy, not an assembled transaction. It is the client's job to compile
 * a versioned transaction from these before signing. See api/order-submit.ts
 * for the other end of this flow.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { PantaError, buildOrder, quoteOrder } from "../lib/panta.js";
import { handlePreflight, isAllowedOrigin } from "../lib/origin.js";

interface OrderQuoteBody {
  marketId?: unknown;
  side?: unknown;
  amountUsdc?: unknown;
  wallet?: unknown;
  userId?: unknown;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handlePreflight(req, res)) return;

  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }
  if (!isAllowedOrigin(req)) {
    res.status(403).json({ error: "origin_not_allowed" });
    return;
  }

  const body = (req.body ?? {}) as OrderQuoteBody;
  const { marketId, side, amountUsdc, wallet, userId } = body;

  if (typeof marketId !== "string" || !marketId) {
    res.status(400).json({ error: "invalid_market_id" });
    return;
  }
  if (side !== "yes" && side !== "no") {
    res.status(400).json({ error: "invalid_side" });
    return;
  }
  if (typeof wallet !== "string" || !wallet) {
    res.status(400).json({ error: "invalid_wallet" });
    return;
  }
  // Human-readable decimal string on this path ("20.00"), unlike market
  // creation which takes USDC base units. Panta rejects anything under $0.10,
  // and enforcing the floor here saves the user a failed on-chain transaction.
  if (typeof amountUsdc !== "string" || !amountUsdc) {
    res.status(400).json({ error: "invalid_amount" });
    return;
  }
  const amount = Number(amountUsdc);
  if (!Number.isFinite(amount) || amount < 0.1) {
    res.status(400).json({ error: "amount_below_minimum", minimum: "0.10" });
    return;
  }

  try {
    const quote = await quoteOrder({
      marketId,
      side,
      amountUsdc,
      wallet,
      ...(typeof userId === "string" ? { userId } : {}),
    });

    const quoteId = quote.quoteId;
    if (!quoteId) {
      res.status(502).json({ error: "no_quote_id" });
      return;
    }

    const built = await buildOrder(quoteId, typeof userId === "string" ? userId : undefined);

    res.status(200).json({
      quoteId,
      orderId: built.orderId,
      // The client compiles a VersionedTransaction from these two.
      instructions: built.instructions,
      recentBlockhash: built.recentBlockhash,
      quote,
    });
  } catch (error) {
    if (error instanceof PantaError) {
      // Pass Panta's own code through. The client needs QUOTE_STALE to know it
      // should requote rather than retry the same dead session.
      res.status(error.status === 0 ? 502 : error.status).json({
        error: error.code,
        message: error.message,
        ...(error.field ? { field: error.field } : {}),
      });
      return;
    }
    console.error("order-quote failed", error);
    res.status(502).json({ error: "quote_failed" });
  }
}
