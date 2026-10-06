/**
 * Create a market, steps 1 and 2: quote, then build an unsigned transaction.
 *
 * Bearer-gated (lib/auth.ts), unlike the buy endpoints, and the reason is
 * money: market creation costs $50 (Standard) or $20 (Breaking), is
 * non-refundable, and is paid by us. This is the endpoint that must never be
 * open to a stranger who finds the URL.
 *
 * It is also the endpoint that makes the product's claim true. This service is
 * not called by a browser; it is called by the market generator, which turns
 * the live FPL pipeline into gameweek markets on a schedule. Panta has football
 * demand but no consistent football supply -- this is the supply.
 *
 * Panta gives us back an assembled VersionedTransaction here, unlike a primary
 * buy which returns bare instructions. Two different assembly paths in one
 * integration; worth remembering when the client code looks asymmetric.
 *
 * Field names on MarketSpec come from the API reference, which describes the
 * concepts more confidently than it spells the keys. Confirm them against
 * https://docs.panta.market/api-reference/markets/quote on the first live
 * attempt -- the smoke test only ever exercised read paths.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { isAuthorized } from "../lib/auth.js";
import { PantaError, buildMarket, quoteMarket, type MarketSpec } from "../lib/panta.js";

interface MarketCreateBody extends Partial<MarketSpec> {
  [key: string]: unknown;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }
  if (!isAuthorized(req)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const body = (req.body ?? {}) as MarketCreateBody;
  const { question, startTime, resolveTime, marketType, imageUrl } = body;

  if (typeof question !== "string" || !question.trim()) {
    res.status(400).json({ error: "invalid_question" });
    return;
  }
  if (typeof startTime !== "string" || !startTime) {
    res.status(400).json({ error: "invalid_start_time", note: "ISO 8601; must clear on-chain minimumStartDelay (~3600s) unless eventInProgress" });
    return;
  }
  if (typeof resolveTime !== "string" || !resolveTime) {
    res.status(400).json({ error: "invalid_resolve_time", note: "ISO 8601" });
    return;
  }
  if (marketType !== "standard" && marketType !== "breaking") {
    res.status(400).json({
      error: "invalid_market_type",
      note: "standard requires the event >=72h out; breaking requires it within 72h",
    });
    return;
  }
  if (typeof imageUrl !== "string" || !imageUrl) {
    res.status(400).json({ error: "invalid_image_url", note: "public catalog image, ~1024x1024" });
    return;
  }

  const spec: MarketSpec = {
    question,
    startTime,
    resolveTime,
    marketType,
    imageUrl,
    ...(typeof body.region === "string" ? { region: body.region } : {}),
    ...(typeof body.oracle === "string" ? { oracle: body.oracle } : {}),
    ...(body.eventInProgress === true ? { eventInProgress: true } : {}),
  };

  try {
    const quote = await quoteMarket(spec);
    const createId = quote.createId;
    if (!createId) {
      res.status(502).json({ error: "no_create_id", quote });
      return;
    }

    const built = await buildMarket(createId);

    // createId lives about five minutes, and the blockhash inside the
    // transaction about sixty seconds. The caller must sign and hand the
    // signed bytes straight back to api/market-register.ts.
    res.status(200).json({
      createId,
      transaction: built.transaction,
      quote,
    });
  } catch (error) {
    if (error instanceof PantaError) {
      // CREATE_NOT_PERMITTED and TX_FEE_MISMATCH are the two that actually
      // happen here, and both need Panta's own words to be actionable.
      res.status(error.status === 0 ? 502 : error.status).json({
        error: error.code,
        message: error.message,
        ...(error.field ? { field: error.field } : {}),
      });
      return;
    }
    console.error("market-create failed", error);
    res.status(502).json({ error: "create_failed" });
  }
}
