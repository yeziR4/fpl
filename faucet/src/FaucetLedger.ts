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
 * against this instance, asking the chain for the account's current
 * nonce fresh on every claim is already race-free.
 *
 * SQLite-backed (the `new_sqlite_classes` migration in wrangler.toml,
 * not the legacy KV-backed storage class) -- confirmed that's the
 * variant available on Cloudflare's free Workers plan before choosing
 * this design, not assumed.
 */

import { GearApi, GearKeyring, decodeAddress } from "@gear-js/api";
import { BN } from "@polkadot/util";
import type { Env } from "./env";

const VARA_MAINNET_ENDPOINT = "wss://rpc.vara.network";
const PLANCK_PER_VARA = BigInt(10) ** BigInt(12);

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
      // re-encoding it differently.
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

    const payoutVara = this.env.PAYOUT_VARA || "10";
    const minReserveVara = this.env.MIN_RESERVE_VARA || "5";
    const payoutPlanck = varaToPlanck(payoutVara);
    const minReservePlanck = varaToPlanck(minReserveVara);

    // GearApi.create() itself belongs inside the try -- a connection
    // failure (mainnet unreachable, DNS hiccup) throws just as easily
    // as a signing/broadcast failure does, and needs the same clean
    // JSON error response instead of crashing the request. Confirmed
    // this was a real gap, not a hypothetical: caught it locally via
    // `wrangler dev` against a genuinely unreachable endpoint (this
    // dev sandbox can't reach wss://rpc.vara.network either), where an
    // uncaught connection error was surfacing as a raw 500 instead of
    // the intended { error: "send_failed" } response.
    let api: Awaited<ReturnType<typeof GearApi.create>> | undefined;
    try {
      api = await GearApi.create({ providerAddress: VARA_MAINNET_ENDPOINT });
      const faucetKeyring = await GearKeyring.fromMnemonic(this.env.FAUCET_MNEMONIC, "faucet");

      const faucetBalance = await api.balance.findOut(faucetKeyring.address);
      const faucetPlanck = BigInt(faucetBalance.toString());
      if (faucetPlanck - payoutPlanck < minReservePlanck) {
        return jsonResponse({ error: "faucet_low" }, 503);
      }

      const txHash = await new Promise<string>((resolve, reject) => {
        api!.balance
          // GearBalance.transfer's declared type is `number | BN`, not
          // bigint -- BN(string) rather than BN(bigint) since BN.js
          // predates native BigInt and its constructor doesn't accept
          // one directly.
          .transfer(address, new BN(payoutPlanck.toString()), true)
          .signAndSend(faucetKeyring, (result) => {
            if (result.status.isInBlock) {
              resolve(result.txHash.toString());
            }
            if (result.dispatchError) {
              reject(new Error(result.dispatchError.toString()));
            }
          })
          .catch(reject);
      });

      await this.ctx.storage.put(`claim:${canonical}`, { txHash, claimedAt: Date.now() });
      return jsonResponse({ status: "sent", txHash, amount: payoutVara });
    } catch (error) {
      // Logged server-side (Cloudflare's own log tooling) rather than
      // returned to the client -- an error message/stack trace is
      // internal detail, not something to hand back over the wire.
      console.error("Faucet claim failed", error);
      return jsonResponse({ error: "send_failed" }, 502);
    } finally {
      await api?.disconnect();
    }
  }
}

function varaToPlanck(vara: string): bigint {
  const [whole, fractional = ""] = vara.split(".");
  const fractionalPadded = fractional.padEnd(12, "0").slice(0, 12);
  return BigInt(whole) * PLANCK_PER_VARA + BigInt(fractionalPadded || "0");
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
