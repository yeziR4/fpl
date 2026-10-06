/**
 * Step 3 of a primary buy: broadcast the signed transaction, then hand Panta
 * the signature.
 *
 * This is the endpoint where Solami stops being decoration. Panta's custody
 * model is explicit -- "Panta cooks the transaction. The user signs. You file it
 * on-chain. You broadcast on your RPC, then tell Panta the signature." Nothing
 * here or in Panta moves the trade to the chain; lib/solami.ts does.
 *
 * Order matters and each step is load-bearing:
 *
 *   1. broadcast via Solami
 *   2. confirm on chain -- Panta only counts a trade it can see, so "broadcast
 *      succeeded" and "Panta accepted it" are different states
 *   3. submit the signature to Panta
 *
 * Submitting before confirming would hand Panta a signature for a transaction
 * that may still fail, and its verification is fail-closed (TX_FAILED), so we
 * would just get an error instead of a clear one.
 *
 * Public by design: this spends the user's own USDC under the user's own
 * signature, so it cannot move our funds.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { PantaError, submitOrder, verifyOrder } from "../lib/panta.js";
import { SolamiError, confirmSignature, sendTransaction } from "../lib/solami.js";
import { handlePreflight, isAllowedOrigin } from "../lib/origin.js";

interface OrderSubmitBody {
  orderId?: unknown;
  signedTransaction?: unknown;
  /** Optional: skip the on-chain confirmation poll. Faster, less certain. */
  skipConfirm?: unknown;
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

  const body = (req.body ?? {}) as OrderSubmitBody;
  const { orderId, signedTransaction } = body;

  if (typeof orderId !== "string" || !orderId) {
    res.status(400).json({ error: "invalid_order_id" });
    return;
  }
  if (typeof signedTransaction !== "string" || !signedTransaction) {
    res.status(400).json({ error: "invalid_transaction" });
    return;
  }

  try {
    // 1. Land it through Solami.
    const signature = await sendTransaction(signedTransaction);

    // 2. Make sure it actually succeeded before claiming anything to Panta.
    let confirmed = true;
    let confirmationError: unknown = null;
    if (body.skipConfirm !== true) {
      const result = await confirmSignature(signature);
      confirmed = result.confirmed;
      confirmationError = result.err;
      if (result.failed) {
        res.status(502).json({
          error: "transaction_failed_on_chain",
          signature,
          detail: String(result.err),
        });
        return;
      }
    }

    // 3. Tell Panta. Idempotent for the same orderId + signature, so a retry
    //    after a timeout is safe.
    let submitted: Record<string, unknown> | null = null;
    let submitError: string | null = null;
    try {
      submitted = await submitOrder(orderId, signature);
    } catch (error) {
      // The trade is on chain either way. Report the signature so the caller
      // can retry the submit (idempotent) rather than re-broadcasting and
      // spending the user's money twice.
      submitError = error instanceof PantaError ? error.code : String(error);
    }

    // Optional third-party re-check. Verification is fail-closed, so a clean
    // result here is real evidence rather than a receipt.
    let verified: Record<string, unknown> | null = null;
    if (submitted && !submitError) {
      try {
        verified = await verifyOrder(signature);
      } catch {
        // Non-fatal: Panta already accepted the submission.
      }
    }

    res.status(200).json({
      signature,
      confirmed,
      ...(confirmationError ? { confirmation: String(confirmationError) } : {}),
      submitted,
      ...(submitError ? { submitError } : {}),
      verified,
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
    console.error("order-submit failed", error);
    res.status(502).json({ error: "submit_failed" });
  }
}
