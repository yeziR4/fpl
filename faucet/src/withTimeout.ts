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
