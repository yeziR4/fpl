/**
 * Connection to Vara mainnet. `wss://rpc.vara.network` is the real
 * mainnet endpoint -- confirmed against gear-foundation/vara-wallet
 * (the official Vara-network-maintained wallet CLI's own default and
 * its NETWORK_MAP), not guessed. Client-side only: this file must
 * never be imported from a server component or run at build time (see
 * VaraProvider.tsx), since it touches WebSocket/browser APIs the
 * static-export prerender doesn't have.
 */

import { GearApi } from "@gear-js/api";

export const VARA_MAINNET_ENDPOINT = "wss://rpc.vara.network";

let apiPromise: Promise<GearApi> | null = null;

/** A shared connection, opened once and reused across the app. */
export function getVaraApi(): Promise<GearApi> {
  if (!apiPromise) {
    apiPromise = GearApi.create({ providerAddress: VARA_MAINNET_ENDPOINT });
  }
  return apiPromise;
}

// BigInt(...) calls, not `n`-suffixed literals -- this project's tsconfig
// targets ES2017, which doesn't support BigInt literal syntax, only the
// BigInt() constructor (a function call, unaffected by target).
const PLANCK_PER_VARA = BigInt(10) ** BigInt(12);

/**
 * Free VARA balance for an address, as a human-readable decimal string
 * (e.g. "12.5"). BigInt division, not float -- `Balance.toNumber()`
 * silently breaks for any balance past Number.MAX_SAFE_INTEGER planck
 * (~9046 VARA), which a real account can exceed. Matches the
 * conversion approach in gear-foundation/vara-wallet's own
 * minimalToVara, confirmed against source rather than assumed.
 */
export async function getBalance(address: string): Promise<string> {
  const api = await getVaraApi();
  const balance = await api.balance.findOut(address);
  const planck = BigInt(balance.toString());
  const whole = planck / PLANCK_PER_VARA;
  const fractional = planck % PLANCK_PER_VARA;
  if (fractional === BigInt(0)) return whole.toString();
  const fractionalStr = fractional.toString().padStart(12, "0").replace(/0+$/, "");
  return `${whole}.${fractionalStr}`;
}
