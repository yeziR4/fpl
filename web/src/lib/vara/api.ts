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
import { planckToVara } from "./units";

export const VARA_MAINNET_ENDPOINT = "wss://rpc.vara.network";

let apiPromise: Promise<GearApi> | null = null;

/** A shared connection, opened once and reused across the app. */
export function getVaraApi(): Promise<GearApi> {
  if (!apiPromise) {
    apiPromise = GearApi.create({ providerAddress: VARA_MAINNET_ENDPOINT });
  }
  return apiPromise;
}

/**
 * Free VARA balance for an address, as a human-readable decimal string
 * (e.g. "12.5"). BigInt-based conversion (see units.ts), not float --
 * `Balance.toNumber()` silently breaks for any balance past
 * Number.MAX_SAFE_INTEGER planck (~9046 VARA), which a real account
 * can exceed. Matches the conversion approach in
 * gear-foundation/vara-wallet's own minimalToVara, confirmed against
 * source rather than assumed.
 */
export async function getBalance(address: string): Promise<string> {
  const api = await getVaraApi();
  const balance = await api.balance.findOut(address);
  return planckToVara(BigInt(balance.toString()));
}
