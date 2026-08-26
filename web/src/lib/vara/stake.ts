/**
 * Client-side: build, sign, and submit a market stake -- a real VARA
 * transfer, not a mock ledger entry.
 *
 * Signing happens entirely in the caller's browser, with a keyring
 * re-derived from the cached wallet (see WalletProvider.tsx); nothing
 * here ever hands a key or mnemonic to the Worker. What reaches the
 * Worker is the already-signed extrinsic, hex-encoded, plus which
 * market/side it's for -- faucet/src/MarketLedger.ts independently
 * verifies it's really a signed transfer to the pool address before
 * ever broadcasting it, so this client can't lie about the amount or
 * destination even if it wanted to.
 */

import type { KeyringPair } from "@polkadot/keyring/types";
import { getVaraApi } from "./api";
import { planckToVara, varaToPlanck } from "./units";

// Must match faucet/wrangler.toml's MARKET_POOL_ADDRESS -- the Worker
// rejects any stake not sent to this exact address, so a mismatch
// here fails every real stake at the verification step (a clear,
// visible error) rather than silently misdirecting funds anywhere.
export const MARKET_POOL_ADDRESS = "kGgVNfy33G9kRscEtXmsffz7HzcBEvN1K9DggnyGj1fzBAkyG";

export type Side = "yes" | "no";

export type StakeResult =
  | { ok: true; txHash: string; yes: string; no: string }
  | { ok: false; error: string };

export interface MarketTotals {
  yes: string;
  no: string;
  stakeCount: number;
}

function marketPath(playerId: number, gw: number, threshold: number): string {
  return `markets/${playerId}/${gw}/${threshold}`;
}

/** Signs and submits a stake for one (player, gw, threshold) market. */
export async function placeStake(args: {
  keyring: KeyringPair;
  faucetUrl: string;
  playerId: number;
  gw: number;
  threshold: number;
  side: Side;
  amountVara: string;
}): Promise<StakeResult> {
  let amountPlanck: bigint;
  try {
    amountPlanck = varaToPlanck(args.amountVara);
  } catch {
    return { ok: false, error: "invalid_amount" };
  }
  if (amountPlanck <= BigInt(0)) {
    return { ok: false, error: "invalid_amount" };
  }

  try {
    const api = await getVaraApi();
    const tx = api.tx.balances.transferKeepAlive(MARKET_POOL_ADDRESS, amountPlanck);
    const signed = await tx.signAsync(args.keyring);
    const signedExtrinsicHex = signed.toHex();

    const base = args.faucetUrl.replace(/\/$/, "");
    const res = await fetch(`${base}/${marketPath(args.playerId, args.gw, args.threshold)}/stake`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signedExtrinsicHex, side: args.side }),
    });
    const body = (await res.json()) as Record<string, unknown>;
    if (res.ok && body.status === "staked") {
      return {
        ok: true,
        txHash: String(body.txHash),
        yes: planckToVara(BigInt(String(body.yesPlanck))),
        no: planckToVara(BigInt(String(body.noPlanck))),
      };
    }
    return { ok: false, error: typeof body.error === "string" ? body.error : "unknown_error" };
  } catch {
    return { ok: false, error: "network_error" };
  }
}

/** Fetches a market's current yes/no totals, in human-readable VARA. Returns null on any failure -- a market simply shows no totals yet, not an error state. */
export async function fetchMarketTotals(args: {
  faucetUrl: string;
  playerId: number;
  gw: number;
  threshold: number;
}): Promise<MarketTotals | null> {
  try {
    const base = args.faucetUrl.replace(/\/$/, "");
    const res = await fetch(`${base}/${marketPath(args.playerId, args.gw, args.threshold)}/totals`);
    if (!res.ok) return null;
    const body = (await res.json()) as { yesPlanck: string; noPlanck: string; stakeCount: number };
    return {
      yes: planckToVara(BigInt(body.yesPlanck)),
      no: planckToVara(BigInt(body.noPlanck)),
      stakeCount: body.stakeCount,
    };
  } catch {
    return null;
  }
}

/** Human-readable text for each error code the Worker/network can return. */
export function stakeErrorMessage(error: string): string {
  switch (error) {
    case "invalid_amount":
      return "Enter a valid amount.";
    case "not_signed":
    case "invalid_extrinsic":
      return "Couldn't sign that transaction -- try again.";
    case "not_a_transfer":
    case "wrong_destination":
      return "Something went wrong building that transaction -- try again.";
    case "already_recorded":
      return "That transaction was already recorded.";
    case "network_error":
      return "Couldn't reach the market -- try again.";
    default:
      return "Couldn't place that stake.";
  }
}
