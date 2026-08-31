/**
 * Planck -> VARA conversion, needed here only for settlement payouts:
 * MarketLedger computes a payout amount in planck (BigInt math against
 * stored stake totals) but chain-signer's `/api/faucet-pay` endpoint
 * takes a decimal VARA string, the same shape every other caller
 * (FaucetLedger's claim payout, the frontend) already sends it in.
 *
 * Deliberately its own small copy rather than importing
 * web/src/lib/vara/units.ts or chain-signer/lib/units.ts -- this
 * project already has two independent copies of this exact conversion
 * (one per runtime), not one shared module; a third here for the
 * Worker runtime follows the same precedent rather than introducing a
 * new cross-package import path for one function.
 */

export const PLANCK_PER_VARA = BigInt(10) ** BigInt(12);

/** Human-readable decimal string (e.g. "12.5") for a planck amount. */
export function planckToVara(planck: bigint): string {
  const whole = planck / PLANCK_PER_VARA;
  const fractional = planck % PLANCK_PER_VARA;
  if (fractional === BigInt(0)) return whole.toString();
  const fractionalStr = fractional.toString().padStart(12, "0").replace(/0+$/, "");
  return `${whole}.${fractionalStr}`;
}
