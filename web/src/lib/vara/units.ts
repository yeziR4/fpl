/**
 * Planck <-> VARA conversion, shared by every place that reads or
 * builds an amount (balance display, staking). One BigInt-based
 * implementation rather than reimplementing the same padding/trimming
 * logic per call site -- float or Number.toString() silently breaks
 * past Number.MAX_SAFE_INTEGER planck (~9046 VARA), which a real
 * balance or stake total can exceed.
 */

// BigInt(...) calls, not `n`-suffixed literals -- this project's tsconfig
// targets ES2017, which doesn't support BigInt literal syntax, only the
// BigInt() constructor (a function call, unaffected by target).
export const PLANCK_PER_VARA = BigInt(10) ** BigInt(12);

/** Human-readable decimal string (e.g. "12.5") for a planck amount. */
export function planckToVara(planck: bigint): string {
  const whole = planck / PLANCK_PER_VARA;
  const fractional = planck % PLANCK_PER_VARA;
  if (fractional === BigInt(0)) return whole.toString();
  const fractionalStr = fractional.toString().padStart(12, "0").replace(/0+$/, "");
  return `${whole}.${fractionalStr}`;
}

/** Parses a decimal VARA string (e.g. "12.5", user input) into planck. */
export function varaToPlanck(vara: string): bigint {
  const [whole, fractional = ""] = vara.trim().split(".");
  const fractionalPadded = fractional.padEnd(12, "0").slice(0, 12);
  return BigInt(whole || "0") * PLANCK_PER_VARA + BigInt(fractionalPadded || "0");
}
