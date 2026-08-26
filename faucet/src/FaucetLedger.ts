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
import { BALANCE_TIMEOUT_MS, BROADCAST_TIMEOUT_MS, CONNECT_TIMEOUT_MS, TimeoutError, withTimeout } from "./withTimeout";

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
    // TEMPORARY diagnostic: a real claim timed out twice at exactly
    // the connect step, at two different timeout values (10s, then
    // 20s) -- pointing at the connection never completing at all,
    // not just being slow. A manually-constructed WsProvider (rather
    // than the one GearApi builds internally from `providerAddress`)
    // lets this attach event listeners to see what actually happens.
    // Only surfaced in the timeout error response, never in a normal
    // one -- remove once the cause is confirmed and fixed for real.
    const connectionLog: string[] = [];
    try {
      // Checked before even opening the chain connection -- a missing
      // credential is a config error, not something a retry or a
      // connection issue could ever fix.
      const faucetKeyring = await loadFaucetKeyring(this.env);
      // Confirmed necessary for real, not speculative: this real-payout
      // path is deliberately never exercised by the deploy smoke test
      // (which only checks invalid-input routing, never a real
      // credential-backed claim) -- a real user's claim was the first
      // thing to actually hit an unguarded stall here, in either
      // GearApi.create() or the calls below it. See withTimeout.ts.
      const { WsProvider } = await import("@polkadot/api");
      const provider = new WsProvider(VARA_MAINNET_ENDPOINT, false); // false: no auto-retry-connect loop
      provider.on("connected", () => connectionLog.push("provider:connected"));
      provider.on("disconnected", () => connectionLog.push("provider:disconnected"));
      provider.on("error", (err) => connectionLog.push(`provider:error ${String(err?.message ?? err)}`));
      connectionLog.push("provider:constructed");
      const connectPromise = provider.connect().then(() => connectionLog.push("provider.connect():resolved"));
      api = await withTimeout(
        connectPromise.then(() => GearApi.create({ provider })),
        CONNECT_TIMEOUT_MS,
      );

      const faucetBalance = await withTimeout(api!.balance.findOut(faucetKeyring.address), BALANCE_TIMEOUT_MS);
      const faucetPlanck = BigInt(faucetBalance.toString());
      if (faucetPlanck - payoutPlanck < minReservePlanck) {
        return jsonResponse({ error: "faucet_low" }, 503);
      }

      const txHash = await withTimeout(
        new Promise<string>((resolve, reject) => {
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
        }),
        BROADCAST_TIMEOUT_MS,
      );

      await this.ctx.storage.put(`claim:${canonical}`, { txHash, claimedAt: Date.now() });
      return jsonResponse({ status: "sent", txHash, amount: payoutVara });
    } catch (error) {
      if (error instanceof TimeoutError) {
        console.error("Faucet claim timed out", error, connectionLog);
        // debug: connectionLog included temporarily -- see comment above.
        return jsonResponse({ error: "timeout", debug: connectionLog }, 504);
      }
      // Logged server-side (Cloudflare's own log tooling) rather than
      // returned to the client -- an error message/stack trace is
      // internal detail, not something to hand back over the wire.
      console.error("Faucet claim failed", error);
      return jsonResponse({ error: "send_failed" }, 502);
    } finally {
      // Best-effort: never let cleanup itself be the thing that hangs
      // the response (see MarketLedger.ts for the same reasoning).
      await withTimeout(Promise.resolve(api?.disconnect()), 3_000).catch(() => {});
    }
  }
}

/**
 * Builds the faucet's signing keyring from whichever credential shape
 * is actually configured. Two shapes, because not every wallet gives
 * up a mnemonic: Polkadot{.js} extension in particular never displays
 * one for an account that already exists (created there or imported),
 * only an encrypted "Export Account" JSON file -- see env.ts and
 * docs/architecture.md.
 *
 * Deliberately checked and thrown here, before FaucetLedger.fetch
 * even opens the chain connection -- a missing/malformed credential
 * is a deploy-time config error, never something worth retrying.
 */
async function loadFaucetKeyring(env: Env) {
  if (env.FAUCET_MNEMONIC) {
    return GearKeyring.fromMnemonic(env.FAUCET_MNEMONIC, "faucet");
  }
  if (env.FAUCET_KEYSTORE_JSON && env.FAUCET_KEYSTORE_PASSWORD) {
    return GearKeyring.fromJson(env.FAUCET_KEYSTORE_JSON, env.FAUCET_KEYSTORE_PASSWORD);
  }
  throw new Error(
    "No faucet credential configured -- set either FAUCET_MNEMONIC, or both " +
      "FAUCET_KEYSTORE_JSON and FAUCET_KEYSTORE_PASSWORD, as Worker secrets.",
  );
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
