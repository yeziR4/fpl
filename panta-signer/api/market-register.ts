/**
 * Create a market, step 3: broadcast the signed transaction, then register it
 * with Panta so it appears in the catalog.
 *
 * Bearer-gated, like api/market-create.ts, because a transaction in this flow
 * is one we paid $50 or $20 for.
 *
 * The registration is what makes the market real to Panta, and Panta verifies
 * it fail-closed: the transaction must exist, must have succeeded, and must
 * contain the expected wallet, market and program, with fees matching the
 * quote. That is why we confirm on chain before registering -- handing over a
 * signature for a transaction that later fails just converts a clear error into
 * a confusing one.
 *
 * Idempotent for the same createId + signature, so retrying after a timeout is
 * safe. Do NOT change accounts or fee amounts between quote and register: Panta
 * checks the chain against the quote and rejects the mismatch.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { isAuthorized } from "../lib/auth.js";
import { PantaError, registerMarket } from "../lib/panta.js";
import { SolamiError, confirmSignature, sendTransaction } from "../lib/solami.js";

interface MarketRegisterBody {
  createId?: unknown;
  signedTransaction?: unknown;
  skipConfirm?: unknown;
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

  const body = (req.body ?? {}) as MarketRegisterBody;
  const { createId, signedTransaction } = body;

  if (typeof createId !== "string" || !createId) {
    res.status(400).json({ error: "invalid_create_id" });
    return;
  }
  if (typeof signedTransaction !== "string" || !signedTransaction) {
    res.status(400).json({ error: "invalid_transaction" });
    return;
  }

  try {
    // Panta's model ends here and ours begins: the transaction lands on Solami.
    const signature = await sendTransaction(signedTransaction);

    if (body.skipConfirm !== true) {
      const result = await confirmSignature(signature);
      if (result.failed) {
        res.status(502).json({
          error: "transaction_failed_on_chain",
          signature,
          detail: String(result.err),
        });
        return;
      }
    }

    let registered: Record<string, unknown> | null = null;
    let registerError: string | null = null;
    try {
      registered = await registerMarket(createId, signature);
    } catch (error) {
      // The market exists on chain. Report the signature so the caller can
      // retry the register (idempotent) rather than paying a creation fee
      // twice on a re-broadcast.
      registerError = error instanceof PantaError ? error.code : String(error);
    }

    res.status(200).json({
      signature,
      registered,
      ...(registerError ? { registerError } : {}),
    });
  } catch (error) {
    if (error instanceof SolamiError) {
      res.status(error.status).json({ error: "solami_error", message: error.message });
      return;
    }
    if (error instanceof PantaError) {
      res.status(error.status === 0 ? 502 : error.status).json({
        error: error.code,
        message: error.message,
      });
      return;
    }
    console.error("market-register failed", error);
    res.status(502).json({ error: "register_failed" });
  }
}
