/**
 * Create a market, steps 1 and 2: quote, then build an unsigned transaction.
 *
 * Bearer-gated (lib/auth.ts), unlike the buy endpoints, and the reason is
 * money: market creation costs real, non-refundable USDC -- 50 for a standard
 * market, 20 for a breaking one -- and we pay it. This is the endpoint that
 * must never be open to a stranger who finds the URL.
 *
 * It is also the endpoint that makes the product's claim true. This service is
 * not called by a browser; it is called by the market generator, which turns
 * the live FPL pipeline into gameweek markets on a schedule. Panta has football
 * demand and, as of this writing, a catalog with zero primary markets in it.
 * This is the supply.
 *
 * The body is a MarketSpec, passed through after validation. Note how far the
 * real field names sit from the obvious guesses: `resolutionRule` is prose,
 * `sourcesOfTruth` is an array of URLs, the three timestamps are UNIX SECONDS,
 * and `title` is separate from `question`. All of that was read off the API
 * reference after a free dry run proved the inferred names wrong.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { isAuthorized } from "../lib/auth.js";
import { PantaError, buildMarket, quoteMarket, type MarketSpec } from "../lib/panta.js";

const REQUIRED: (keyof MarketSpec)[] = [
  "wallet",
  "question",
  "resolutionRule",
  "sourcesOfTruth",
  "category",
  "startTime",
  "endTime",
  "resolutionTime",
  "marketType",
  "title",
  "imageUrl",
];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }
  if (!isAuthorized(req)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const body = (req.body ?? {}) as Partial<MarketSpec>;

  const missing = REQUIRED.filter((key) => {
    const value = body[key];
    return value === undefined || value === null || value === "";
  });
  if (missing.length > 0) {
    res.status(400).json({
      error: "invalid_market_spec",
      missing,
      note: "timestamps are unix seconds; see examples/market-spec.example.json",
    });
    return;
  }

  if (!Array.isArray(body.sourcesOfTruth) || body.sourcesOfTruth.length === 0) {
    res.status(400).json({
      error: "invalid_sources_of_truth",
      note: "a non-empty array of URLs the resolution agent reads",
    });
    return;
  }
  if (body.marketType !== "standard" && body.marketType !== "breaking") {
    res.status(400).json({
      error: "invalid_market_type",
      note: "standard needs the event >=72h out (50 USDC); breaking needs it within 72h (20 USDC)",
    });
    return;
  }
  for (const key of ["startTime", "endTime", "resolutionTime"] as const) {
    if (typeof body[key] !== "number" || !Number.isFinite(body[key])) {
      res.status(400).json({
        error: "invalid_timestamp",
        field: key,
        note: "unix seconds, not ISO 8601",
      });
      return;
    }
  }

  const spec = body as MarketSpec;

  try {
    const quote = await quoteMarket(spec);
    if (!quote.createId) {
      res.status(502).json({ error: "no_create_id", quote });
      return;
    }

    // The build needs the same wallet that was quoted; Panta checks it.
    const built = await buildMarket(quote.createId, spec.wallet);

    // createId lives about five minutes and the embedded blockhash about sixty
    // seconds. The caller signs and hands the signed bytes straight back to
    // api/market-register.ts.
    res.status(200).json({
      createId: quote.createId,
      transaction: built.transaction,
      paymentUsdc: quote.paymentUsdc,
      expectedEventPda: quote.expectedEventPda,
      quote,
      build: built,
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
