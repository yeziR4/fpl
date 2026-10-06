/** Bounds a promise so a stalled RPC call can't hold a serverless invocation
 * open indefinitely. Same pattern as chain-signer/lib/withTimeout.ts and
 * faucet/src/withTimeout.ts -- duplicated rather than shared as a package,
 * since these are separately deployed services on different platforms. */

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
