/**
 * Tracks one market's (player_id, gw, threshold) yes/no stake totals,
 * backed by real VARA transfers -- not a mock ledger.
 *
 * Deliberately does NOT sign anything on anyone's behalf (unlike
 * FaucetLedger, which uses the faucet wallet's own key). A stake is
 * signed client-side, by the staker's own non-custodial wallet, before
 * it ever reaches this Worker -- what arrives here is an already-
 * signed extrinsic.
 *
 * The actual decode/verify/broadcast of that extrinsic does NOT happen
 * in this file anymore. Confirmed for real (a plain-Node control test
 * against the exact same RPC endpoint succeeded where this Worker
 * failed) that GearApi.create() cannot initialize inside a Cloudflare
 * Workers isolate -- see FaucetLedger.ts's docstring and
 * docs/architecture.md for the full story. That work now happens in
 * chain-signer/ (a small Node.js service on Vercel), called over a
 * plain authenticated HTTPS POST; this Durable Object keeps exactly
 * the part that's actually Cloudflare's job: dedup by the extrinsic's
 * own hash, and the running yes/no totals.
 *
 * One Durable Object instance per market (index.ts computes the id
 * from player/gw/threshold), so markets don't serialize against each
 * other the way every faucet claim deliberately does against one
 * global instance -- there's no shared mutable resource (a single
 * wallet's nonce) here that needs that.
 */

import type { Env } from "./env";

type Side = "yes" | "no";

interface StakeRecord {
  address: string;
  side: Side;
  amountPlanck: string;
  txHash: string;
  stakedAt: number;
}

interface MarketTotals {
  yesPlanck: string;
  noPlanck: string;
  /** Count of distinct stakes per side -- "how many people picked
   * yes/no", independent of how much each staked. The frontend uses
   * this (combined with agent picks) for a percentage-of-participants
   * display, separate from the VARA-amount totals above. */
  yesCount: number;
  noCount: number;
}

const EMPTY_TOTALS: MarketTotals = { yesPlanck: "0", noPlanck: "0", yesCount: 0, noCount: 0 };

// A real signed balances.transferKeepAlive extrinsic is comfortably
// larger than this (roughly 150-200+ bytes / 300-400+ hex chars for
// an sr25519-signed call) -- this floor exists purely to keep garbage
// input (a handful of bytes) from ever reaching chain-signer, not to
// validate the extrinsic is well-formed. chain-signer's own decoder is
// what actually validates shape; this is a cheap gate in front of it,
// kept here too even though chain-signer repeats it, so a request
// this obviously invalid never even leaves the Worker.
const MIN_EXTRINSIC_HEX_LENGTH = 200;

export class MarketLedger implements DurableObject {
  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/totals") {
      return jsonResponse(await this.getTotals());
    }
    if (request.method === "POST" && url.pathname === "/stake") {
      return this.handleStake(request);
    }
    return jsonResponse({ error: "not_found" }, 404);
  }

  private async getTotals(): Promise<MarketTotals> {
    return (await this.ctx.storage.get<MarketTotals>("totals")) ?? EMPTY_TOTALS;
  }

  private async handleStake(request: Request): Promise<Response> {
    const { signedExtrinsicHex, side } = (await request.json().catch(() => ({}))) as {
      signedExtrinsicHex?: unknown;
      side?: unknown;
    };

    if (
      typeof signedExtrinsicHex !== "string" ||
      !signedExtrinsicHex.startsWith("0x") ||
      signedExtrinsicHex.length < MIN_EXTRINSIC_HEX_LENGTH
    ) {
      return jsonResponse({ error: "invalid_extrinsic" }, 400);
    }
    if (side !== "yes" && side !== "no") {
      return jsonResponse({ error: "invalid_side" }, 400);
    }

    if (!this.env.CHAIN_SIGNER_URL || !this.env.CHAIN_SIGNER_API_KEY) {
      console.error("CHAIN_SIGNER_URL / CHAIN_SIGNER_API_KEY not configured");
      return jsonResponse({ error: "send_failed" }, 502);
    }

    let signerResponse: Response;
    try {
      signerResponse = await fetch(`${this.env.CHAIN_SIGNER_URL.replace(/\/$/, "")}/api/market-relay`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.env.CHAIN_SIGNER_API_KEY}`,
        },
        body: JSON.stringify({ signedExtrinsicHex, poolAddress: this.env.MARKET_POOL_ADDRESS }),
      });
    } catch (error) {
      console.error("Couldn't reach chain-signer", error);
      return jsonResponse({ error: "send_failed" }, 502);
    }

    const signerBody = (await signerResponse.json().catch(() => ({}))) as {
      status?: string;
      txHash?: string;
      address?: string;
      amountPlanck?: string;
      error?: string;
    };

    if (
      !signerResponse.ok ||
      signerBody.status !== "relayed" ||
      !signerBody.txHash ||
      !signerBody.address ||
      !signerBody.amountPlanck
    ) {
      // Passes chain-signer's own error code through as-is -- it
      // already uses the same vocabulary this Worker's responses do
      // (invalid_extrinsic, not_signed, wrong_destination, timeout,
      // send_failed, ...), no translation needed.
      const error = typeof signerBody.error === "string" ? signerBody.error : "send_failed";
      return jsonResponse({ error }, signerResponse.status || 502);
    }

    const { txHash, address: stakerAddress, amountPlanck: amountPlanckStr } = signerBody;
    const amountPlanck = BigInt(amountPlanckStr);

    // The extrinsic's hash is deterministic from its signed bytes, so
    // chain-signer returning the same txHash twice (e.g. a retried
    // request after a network blip on the client) must never double-
    // count here.
    const already = await this.ctx.storage.get<StakeRecord>(`stake:${txHash}`);
    if (already) {
      return jsonResponse({ error: "already_recorded", txHash }, 409);
    }

    const record: StakeRecord = {
      address: stakerAddress,
      side,
      amountPlanck: amountPlanck.toString(),
      txHash,
      stakedAt: Date.now(),
    };
    const totals = await this.getTotals();
    const updated: MarketTotals = {
      yesPlanck: side === "yes" ? (BigInt(totals.yesPlanck) + amountPlanck).toString() : totals.yesPlanck,
      noPlanck: side === "no" ? (BigInt(totals.noPlanck) + amountPlanck).toString() : totals.noPlanck,
      yesCount: totals.yesCount + (side === "yes" ? 1 : 0),
      noCount: totals.noCount + (side === "no" ? 1 : 0),
    };

    await this.ctx.storage.put(`stake:${txHash}`, record);
    await this.ctx.storage.put("totals", updated);

    return jsonResponse({ status: "staked", txHash, ...updated });
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
