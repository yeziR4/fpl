/**
 * Tracks one market's (player_id, gw, threshold) yes/no stake totals,
 * backed by real VARA transfers -- not a mock ledger.
 *
 * Deliberately does NOT sign anything on anyone's behalf (unlike
 * FaucetLedger, which holds the faucet wallet's own key). A stake is
 * signed client-side, by the staker's own non-custodial wallet, before
 * it ever reaches this Worker -- what arrives here is an already-
 * signed extrinsic. This Worker's job is narrow: reject anything that
 * isn't actually a signed transfer to the known pool address, then
 * relay it to the chain and record the result once it lands.
 *
 * One Durable Object instance per market (index.ts computes the id
 * from player/gw/threshold), so markets don't serialize against each
 * other the way every faucet claim deliberately does against one
 * global instance -- there's no shared mutable resource (a single
 * wallet's nonce) here that needs that.
 *
 * The extrinsic's own hash (computable from its signed bytes, before
 * ever broadcasting it) is the dedup key -- the same signed tx
 * resubmitted twice must never double-count.
 */

import { GearApi, decodeAddress } from "@gear-js/api";
import type { Env } from "./env";
import { TimeoutError, withTimeout } from "./withTimeout";

const VARA_MAINNET_ENDPOINT = "wss://rpc.vara.network";

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

    if (typeof signedExtrinsicHex !== "string" || !isPlausibleExtrinsicHex(signedExtrinsicHex)) {
      return jsonResponse({ error: "invalid_extrinsic" }, 400);
    }
    if (side !== "yes" && side !== "no") {
      return jsonResponse({ error: "invalid_side" }, 400);
    }

    let api: Awaited<ReturnType<typeof GearApi.create>> | undefined;
    try {
      // Confirmed for real, not hypothetical: before the length check
      // above existed, a garbage-short hex string (curl testing
      // "0xdeadbeef") reached api.tx() and stalled the request for
      // minutes -- SCALE-decoding truncated/garbage bytes can read a
      // bogus compact-length prefix and try to consume far more data
      // than exists. A network-facing endpoint must never hand
      // attacker-controlled bytes to that decoder without a sanity
      // check first; the length floor above is deliberately generous
      // (a real signed transferKeepAlive is comfortably larger) so it
      // only rejects things nowhere close to a real extrinsic.
      api = await withTimeout(GearApi.create({ providerAddress: VARA_MAINNET_ENDPOINT }), CONNECT_TIMEOUT_MS);

      let extrinsic;
      try {
        extrinsic = api.tx(signedExtrinsicHex);
      } catch {
        return jsonResponse({ error: "invalid_extrinsic" }, 400);
      }

      // Reject anything that isn't a signed, direct balances transfer
      // to the known pool address BEFORE ever broadcasting it -- this
      // endpoint must never become a way to relay an arbitrary signed
      // transaction through the Worker's own RPC connection.
      if (!extrinsic.isSigned) {
        return jsonResponse({ error: "not_signed" }, 400);
      }
      const { method, section, args } = extrinsic.method;
      if (section !== "balances" || !method.startsWith("transfer")) {
        return jsonResponse({ error: "not_a_transfer" }, 400);
      }

      const [dest, amount] = args;
      let destCanonical: string;
      let poolCanonical: string;
      try {
        destCanonical = decodeAddress(dest.toString());
        poolCanonical = decodeAddress(this.env.MARKET_POOL_ADDRESS);
      } catch {
        return jsonResponse({ error: "invalid_extrinsic" }, 400);
      }
      if (destCanonical !== poolCanonical) {
        return jsonResponse({ error: "wrong_destination" }, 400);
      }

      const amountPlanck = BigInt(amount.toString());
      if (amountPlanck <= BigInt(0)) {
        return jsonResponse({ error: "invalid_amount" }, 400);
      }

      // The extrinsic's hash is deterministic from its signed bytes --
      // known before ever submitting it, so dedup can happen up front.
      const txHash = extrinsic.hash.toString();
      const already = await this.ctx.storage.get<StakeRecord>(`stake:${txHash}`);
      if (already) {
        return jsonResponse({ error: "already_recorded", txHash }, 409);
      }

      const stakerAddress = decodeAddress(extrinsic.signer.toString());

      await withTimeout(
        new Promise<void>((resolve, reject) => {
          extrinsic!
            .send((result) => {
              if (result.status.isInBlock) {
                resolve();
              }
              if (result.dispatchError) {
                reject(new Error(result.dispatchError.toString()));
              }
            })
            .catch(reject);
        }),
        BROADCAST_TIMEOUT_MS,
      );

      const record: StakeRecord = {
        address: stakerAddress,
        side,
        amountPlanck: amountPlanck.toString(),
        txHash,
        stakedAt: Date.now(),
      };
      const totals = await this.getTotals();
      const updated: MarketTotals = {
        yesPlanck:
          side === "yes" ? (BigInt(totals.yesPlanck) + amountPlanck).toString() : totals.yesPlanck,
        noPlanck: side === "no" ? (BigInt(totals.noPlanck) + amountPlanck).toString() : totals.noPlanck,
        yesCount: totals.yesCount + (side === "yes" ? 1 : 0),
        noCount: totals.noCount + (side === "no" ? 1 : 0),
      };

      await this.ctx.storage.put(`stake:${txHash}`, record);
      await this.ctx.storage.put("totals", updated);

      return jsonResponse({ status: "staked", txHash, ...updated });
    } catch (error) {
      if (error instanceof TimeoutError) {
        console.error("Stake timed out", error);
        return jsonResponse({ error: "timeout" }, 504);
      }
      console.error("Stake failed", error);
      return jsonResponse({ error: "send_failed" }, 502);
    } finally {
      // Best-effort: a connection already in a bad enough state to
      // need this cleanup is also a connection that could hang on
      // disconnect() itself -- never let cleanup be the thing that
      // holds the response open.
      await withTimeout(Promise.resolve(api?.disconnect()), 3_000).catch(() => {});
    }
  }
}

const CONNECT_TIMEOUT_MS = 10_000;
const BROADCAST_TIMEOUT_MS = 30_000;

// A real signed balances.transferKeepAlive extrinsic is comfortably
// larger than this (roughly 150-200+ bytes / 300-400+ hex chars for
// an sr25519-signed call) -- this floor exists purely to keep garbage
// input (a handful of bytes) from ever reaching the SCALE decoder
// below, not to validate the extrinsic is well-formed. That decoder
// is what actually validates shape; this is a cheap gate in front of it.
const MIN_EXTRINSIC_HEX_LENGTH = 200;

function isPlausibleExtrinsicHex(value: string): boolean {
  return value.startsWith("0x") && value.length >= MIN_EXTRINSIC_HEX_LENGTH;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
