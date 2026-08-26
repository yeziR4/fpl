/**
 * The one thing standing between "many people click Claim at once" and
 * a corrupted nonce or a double payout: every claim, from anywhere,
 * goes through exactly one instance of this Durable Object
 * (env.FAUCET_LEDGER.idFromName("faucet") in index.ts -- always the
 * same name, always the same instance). Cloudflare guarantees a single
 * DO instance processes requests one at a time, so there is no
 * concurrent-access window here to race -- unlike a plain stateless
 * Worker function, which two simultaneous requests could both enter at
 * once.
 *
 * That serialization is also *why* this class doesn't need to track
 * its own nonce counter: because only one request is ever in flight
 * against this instance, asking the chain-signer service for the
 * account's current nonce fresh on every claim is already race-free.
 *
 * SQLite-backed (the `new_sqlite_classes` migration in wrangler.toml,
 * not the legacy KV-backed storage class) -- confirmed that's the
 * variant available on Cloudflare's free Workers plan before choosing
 * this design, not assumed.
 *
 * The actual chain interaction -- GearApi.create(), the keyring, the
 * balance check, the signed transfer -- does NOT happen in this file
 * anymore. Confirmed for real (a plain-Node control test against the
 * exact same RPC endpoint succeeded where this Worker failed) that
 * GearApi.create() cannot initialize inside a Cloudflare Workers
 * isolate: it throws "Unable to initialize the API: Invalid array
 * buffer length" while decoding the chain's runtime metadata, every
 * time, not intermittently. That work now happens in chain-signer/ (a
 * small Node.js service on Vercel), called over a plain authenticated
 * HTTPS POST -- see docs/architecture.md for the full story. This
 * Durable Object keeps exactly the part that's actually Cloudflare's
 * job: the dedup ledger, serialized so two simultaneous claims for the
 * same address can never both succeed.
 */

import { decodeAddress } from "@gear-js/api";
import type { Env } from "./env";

export class FaucetLedger implements DurableObject {
  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const { address } = (await request.json()) as { address: string };

    let canonical: string;
    try {
      // decodeAddress (from @gear-js/api) already returns a canonical
      // HexString -- no separate u8aToHex step needed. Canonicalizing
      // matters because the same underlying key has many valid SS58
      // string encodings; keying the claimed-address ledger on the raw
      // string would let one address claim multiple times just by
      // re-encoding it differently. This is a pure SS58/base58 decode
      // -- no chain connection needed, unaffected by the GearApi issue
      // above (confirmed: this path has worked reliably all session).
      canonical = decodeAddress(address);
    } catch {
      return jsonResponse({ error: "invalid_address" }, 400);
    }

    const already = await this.ctx.storage.get<{ txHash: string; claimedAt: number }>(`claim:${canonical}`);
    if (already) {
      return jsonResponse({ error: "already_claimed", txHash: already.txHash }, 409);
    }

    if (this.env.FAUCET_PAUSED === "true") {
      return jsonResponse({ error: "faucet_paused" }, 503);
    }

    if (!this.env.CHAIN_SIGNER_URL || !this.env.CHAIN_SIGNER_API_KEY) {
      console.error("CHAIN_SIGNER_URL / CHAIN_SIGNER_API_KEY not configured");
      return jsonResponse({ error: "send_failed" }, 502);
    }

    const payoutVara = this.env.PAYOUT_VARA || "10";
    const minReserveVara = this.env.MIN_RESERVE_VARA || "5";

    let signerResponse: Response;
    try {
      signerResponse = await fetch(`${this.env.CHAIN_SIGNER_URL.replace(/\/$/, "")}/api/faucet-pay`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.env.CHAIN_SIGNER_API_KEY}`,
        },
        body: JSON.stringify({ address, payoutVara, minReserveVara }),
      });
    } catch (error) {
      console.error("Couldn't reach chain-signer", error);
      return jsonResponse({ error: "send_failed" }, 502);
    }

    const signerBody = (await signerResponse.json().catch(() => ({}))) as {
      status?: string;
      txHash?: string;
      amount?: string;
      error?: string;
    };

    if (!signerResponse.ok || signerBody.status !== "sent" || !signerBody.txHash) {
      // Passes chain-signer's own error code through as-is (e.g.
      // "faucet_low", "timeout", "send_failed") -- it already uses the
      // same vocabulary this Worker's client-facing responses do, no
      // translation needed.
      const error = typeof signerBody.error === "string" ? signerBody.error : "send_failed";
      return jsonResponse({ error }, signerResponse.status || 502);
    }

    await this.ctx.storage.put(`claim:${canonical}`, { txHash: signerBody.txHash, claimedAt: Date.now() });
    return jsonResponse({ status: "sent", txHash: signerBody.txHash, amount: signerBody.amount ?? payoutVara });
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
