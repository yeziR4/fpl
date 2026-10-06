/**
 * Solami is where every signed transaction lands.
 *
 * Panta's custody model ends with "...you broadcast on your RPC" (see
 * docs.panta.market/guides/how-it-works). This module is that RPC. It is the
 * reason Solami is load-bearing in this submission rather than decorative:
 * without it there is no path at all from a signed Panta transaction to the
 * chain, so the integration is structural, not a bolt-on.
 *
 * Implemented as raw JSON-RPC over fetch rather than through
 * @solana/web3.js, for two reasons:
 *
 *   - it keeps this service dependency-free, matching chain-signer/'s taste
 *   - the only thing we need is sendTransaction with a base64 blob. The client
 *     already compiled and signed the transaction, because only the user's own
 *     wallet can sign it. We are a relay, not a signer.
 *
 * Beam: Solami's docs say "For http, use the rpc endpoint with a tip", so
 * priority landing is a tip instruction that the *client* adds before signing,
 * not something this service can append afterwards. The QUIC endpoint is a
 * separate transport and deliberately out of scope here.
 *
 * Auth: the header name is configurable (see lib/env.ts) because Solami has
 * not published the scheme. Confirm it in their Discord before the demo.
 */

import {
  solamiApiKey,
  solamiApiKeyHeader,
  solamiRequestTimeoutMs,
  solamiRpcUrl,
  rpcFallbackUrl,
  hasSolamiKey,
} from "./env.js";
import { withTimeout } from "./withTimeout.js";

export class SolamiError extends Error {
  readonly status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = "SolamiError";
    this.status = status;
  }
}

interface JsonRpcResponse<T> {
  jsonrpc: "2.0";
  id: number;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

let rpcId = 0;

let warnedAboutFallback = false;

/**
 * Which RPC to talk to.
 *
 * Solami when we hold a key, otherwise the public fallback -- announced loudly,
 * once. The fallback exists so the Panta flow can be proven before the Solami
 * key lands. It is not a substitute: the Solami track is judged on Solami
 * actually carrying the data, so a broadcast that went to the public RPC must
 * never be described as a Solami broadcast.
 */
function endpoint(): string {
  if (hasSolamiKey()) return solamiRpcUrl();
  if (!warnedAboutFallback) {
    warnedAboutFallback = true;
    console.warn(
      `[solami] SOLAMI_API_KEY is not set. Falling back to ${rpcFallbackUrl()}.\n` +
        "         Solami's RPC is https://rpc.solami.dev/solana and needs a key.\n" +
        "         This proves the Panta flow but does NOT satisfy the Solami track.",
    );
  }
  return rpcFallbackUrl();
}

/** One JSON-RPC round trip. Surfaces the RPC's own error message rather than a
 * generic failure, because "the RPC rejected it" and "the transaction is bad"
 * need different fixes and we have six days. */
export async function solamiRpc<T>(method: string, params: unknown[]): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const key = solamiApiKey();
  if (key) {
    headers[solamiApiKeyHeader()] = key;
  }

  const url = endpoint();
  let response: Response;
  try {
    response = await withTimeout(
      fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
      }),
      solamiRequestTimeoutMs(),
    );
  } catch (error) {
    throw new SolamiError(`Could not reach Solami RPC: ${String(error)}`, 504);
  }

  const text = await response.text();
  if (!response.ok) {
    throw new SolamiError(`Solami RPC HTTP ${response.status}: ${text.slice(0, 300)}`, response.status);
  }

  let payload: JsonRpcResponse<T>;
  try {
    payload = JSON.parse(text) as JsonRpcResponse<T>;
  } catch {
    throw new SolamiError(`Solami RPC returned non-JSON: ${text.slice(0, 300)}`);
  }

  if (payload.error) {
    throw new SolamiError(
      `Solami RPC ${method} failed (${payload.error.code}): ${payload.error.message}`,
    );
  }

  return payload.result as T;
}

export function getLatestBlockhash(): Promise<{
  context: { slot: number };
  value: { blockhash: string; lastValidBlockHeight: number };
}> {
  return solamiRpc("getLatestBlockhash", [{ commitment: "confirmed" }]);
}

/**
 * Broadcast an already-signed transaction. The client compiles and signs; we
 * only send. Returns the signature, which is what Panta needs next.
 *
 * skipPreflight defaults to false on purpose: during the build we want the
 * RPC to reject a bad transaction with a useful error rather than accepting it
 * and failing on chain, where the only feedback is a failed signature we then
 * have to go and look up.
 */
export async function sendTransaction(
  signedTransactionBase64: string,
  options: { skipPreflight?: boolean; maxRetries?: number } = {},
): Promise<string> {
  return solamiRpc<string>("sendTransaction", [
    signedTransactionBase64,
    {
      encoding: "base64",
      skipPreflight: options.skipPreflight ?? false,
      preflightCommitment: "confirmed",
      maxRetries: options.maxRetries ?? 3,
    },
  ]);
}

export interface SignatureStatus {
  slot: number;
  confirmations: number | null;
  err: unknown;
  confirmationStatus?: "processed" | "confirmed" | "finalized";
}

export function getSignatureStatuses(signatures: string[]): Promise<{
  context: { slot: number };
  value: (SignatureStatus | null)[];
}> {
  return solamiRpc("getSignatureStatuses", [signatures, { searchTransactionHistory: false }]);
}

/**
 * Poll until a signature confirms, fails, or we run out of patience.
 *
 * Worth having: Panta only counts a trade once it can see it on chain, so
 * "broadcast succeeded" and "Panta accepted it" are different states. This
 * collapses them into one answer.
 */
export async function confirmSignature(
  signature: string,
  timeoutMs = 60_000,
  pollIntervalMs = 2_000,
): Promise<{ confirmed: boolean; failed: boolean; err: unknown }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { value } = await getSignatureStatuses([signature]);
    const status = value?.[0];
    if (status) {
      if (status.err) {
        return { confirmed: false, failed: true, err: status.err };
      }
      if (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized") {
        return { confirmed: true, failed: false, err: null };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  return { confirmed: false, failed: false, err: "confirmation timeout" };
}
