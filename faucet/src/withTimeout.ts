/**
 * Bounds a promise so a stalled chain RPC connection (or anything else
 * that can hang) can never hold a Durable Object's request -- and
 * therefore that whole market/wallet's serialized queue -- open
 * indefinitely.
 *
 * Confirmed necessary for real, twice over, not added speculatively:
 * MarketLedger's stake handling hung for minutes on a garbage
 * extrinsic before this existed (see its own additional length-check
 * fix), and FaucetLedger's real-payout path -- GearApi.create(),
 * balance.findOut(), signAndSend() -- had never actually been
 * exercised end to end in CI (the deploy smoke test deliberately never
 * reaches a real payout) until a real user's claim reproduced the same
 * class of hang.
 */

// Shared across FaucetLedger and MarketLedger so a tuning change (see
// CONNECT_TIMEOUT_MS below) doesn't have to be made in two places and
// risk drifting apart.
//
// CONNECT_TIMEOUT_MS bumped from an initial 10s to 20s after a real
// claim genuinely timed out at exactly the 10s mark -- GearApi.create()
// opens a WebSocket to wss://rpc.vara.network *and* downloads the
// chain's full metadata before it resolves, and apparently that
// doesn't reliably fit in 10s from a Cloudflare Worker. 20s is still
// comfortably inside Cloudflare's own request duration limits (the
// earlier unguarded hang ran for *minutes* before being killed by
// hand, not by the platform), so there's real headroom to give this
// more room rather than have it fail fast on a slow-but-working
// connection.
export const CONNECT_TIMEOUT_MS = 20_000;
export const BALANCE_TIMEOUT_MS = 10_000;
export const BROADCAST_TIMEOUT_MS = 30_000;

export class TimeoutError extends Error {}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(`Timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
