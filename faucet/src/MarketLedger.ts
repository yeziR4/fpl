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
 *
 * SETTLEMENT (added once a real gameweek had real stakes to pay out):
 * once `resolve_points_threshold` (data_pipeline/resolution.py, called
 * from the "Agent picks & leaderboard" GitHub Actions workflow -- see
 * cli.py's `settle-gameweek`/`auto-settle`) says a market's outcome is
 * final, it POSTs `{outcome}` to this DO's /settle route. This is a
 * parimutuel split, computed entirely from stake records this DO
 * already has -- every winning stake gets amountPlanck * totalPool /
 * winningSideTotal, i.e. its own stake back plus its pro-rata share of
 * the losing side's pool; losing stakes get nothing. If nobody picked
 * the winning side (winningSideTotal is 0), there's nothing to
 * distribute FROM, so everyone gets their own stake refunded instead
 * of the pool vanishing into nothing.
 *
 * The actual transfers are signed from the same wallet the faucet
 * pays out from (MARKET_POOL_ADDRESS *is* the faucet wallet -- see
 * docs/architecture.md), so they're routed through FaucetLedger's
 * single global instance via the FAUCET_LEDGER binding rather than
 * called directly here: that's the one place in this codebase that's
 * already safe to fire a signed transfer from without racing another
 * in-flight transfer's on-chain nonce (a faucet claim, or another
 * market's payout happening at the same moment). Settlement itself is
 * idempotent -- re-POSTing the same outcome to an already-settled
 * market returns the recorded result instead of paying twice, so the
 * scheduled workflow can safely call this on every finished gameweek
 * on every run, not just the first time.
 */

import type { Env } from "./env";
import { planckToVara } from "./units";

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

interface PayoutResult {
  address: string;
  amountPlanck: string;
  stakeTxHash: string;
  ok: boolean;
  txHash?: string;
  error?: string;
}

interface Settlement {
  outcome: Side;
  settledAt: number;
  totalPoolPlanck: string;
  winningPlanck: string;
  payouts: PayoutResult[];
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
      const totals = await this.getTotals();
      const settlement = await this.getSettlement();
      // `settlement` is omitted (not just null) while unsettled, so an
      // older cached frontend response shape and "still open" both
      // read the same way -- only a genuinely settled market ever
      // carries this key. Payouts include addresses/amounts, which is
      // fine to expose publicly: they're derived entirely from the
      // yes/no totals this endpoint already returns.
      return jsonResponse(settlement ? { ...totals, settlement } : totals);
    }
    if (request.method === "POST" && url.pathname === "/stake") {
      return this.handleStake(request);
    }
    if (request.method === "POST" && url.pathname === "/settle") {
      return this.handleSettle(request);
    }
    return jsonResponse({ error: "not_found" }, 404);
  }

  private async getTotals(): Promise<MarketTotals> {
    return (await this.ctx.storage.get<MarketTotals>("totals")) ?? EMPTY_TOTALS;
  }

  private async getSettlement(): Promise<Settlement | null> {
    return (await this.ctx.storage.get<Settlement>("settlement")) ?? null;
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

  /**
   * Resolves this market once and for all: computes each stake's
   * payout (see the class docstring for the parimutuel formula) and
   * pays every winner out, one transfer at a time, via FaucetLedger.
   * Idempotent -- called again with the same outcome (the scheduled
   * workflow re-checks every finished gameweek on every run) just
   * returns the already-recorded result; called with a *different*
   * outcome than what's already settled is a conflict, surfaced
   * rather than silently accepted, since that would mean either this
   * call or the original settlement was wrong about the real result.
   */
  private async handleSettle(request: Request): Promise<Response> {
    const { outcome } = (await request.json().catch(() => ({}))) as { outcome?: unknown };
    if (outcome !== "yes" && outcome !== "no") {
      return jsonResponse({ error: "invalid_outcome" }, 400);
    }

    const existing = await this.getSettlement();
    if (existing) {
      if (existing.outcome !== outcome) {
        return jsonResponse({ error: "outcome_mismatch", settled: existing }, 409);
      }
      return jsonResponse({ status: "already_settled", ...existing });
    }

    const totals = await this.getTotals();
    const totalPoolPlanck = BigInt(totals.yesPlanck) + BigInt(totals.noPlanck);
    const winningPlanck = BigInt(outcome === "yes" ? totals.yesPlanck : totals.noPlanck);
    // Every entry this DO has ever stored under "stake:..." -- fine to
    // pull all of them into memory at once, a market's real stake
    // count here is tiny (this is a demo pool, not an exchange).
    const stakeEntries = await this.ctx.storage.list<StakeRecord>({ prefix: "stake:" });

    const payoutPlan: Array<{ address: string; amountPlanck: bigint; stakeTxHash: string }> = [];
    for (const record of stakeEntries.values()) {
      let amount: bigint;
      if (winningPlanck === BigInt(0)) {
        // Nobody staked the winning side -- there's no winning pool to
        // redistribute FROM, so refund every stake rather than letting
        // the pool simply vanish.
        amount = BigInt(record.amountPlanck);
      } else if (record.side === outcome) {
        // Parimutuel: a winner's share of the *entire* pool (both
        // sides) is proportional to their share of the winning side.
        // Integer division -- any planck-level remainder from rounding
        // is left in the pool rather than distributed, never invented.
        amount = (BigInt(record.amountPlanck) * totalPoolPlanck) / winningPlanck;
      } else {
        continue; // losing stake -- no payout
      }
      if (amount <= BigInt(0)) continue;
      payoutPlan.push({ address: record.address, amountPlanck: amount, stakeTxHash: record.txHash });
    }

    // One at a time, not Promise.all: each payout is itself a signed
    // transfer from the shared faucet/pool wallet (see the class
    // docstring), and FaucetLedger's single-instance serialization
    // only protects against nonce races *between* separate calls into
    // it, not against this DO firing several at once and racing itself
    // before the first one's response (and therefore its dedup write)
    // has landed.
    const results: PayoutResult[] = [];
    for (const payout of payoutPlan) {
      results.push(await this.requestPayout(payout));
    }

    const settlement: Settlement = {
      outcome,
      settledAt: Date.now(),
      totalPoolPlanck: totalPoolPlanck.toString(),
      winningPlanck: winningPlanck.toString(),
      payouts: results,
    };
    await this.ctx.storage.put("settlement", settlement);
    return jsonResponse({ status: "settled", ...settlement });
  }

  private async requestPayout(payout: {
    address: string;
    amountPlanck: bigint;
    stakeTxHash: string;
  }): Promise<PayoutResult> {
    // this.ctx.id is stable and unique to this one market (derived via
    // idFromName from player:gw:threshold in index.ts) -- reused here
    // as the payout idempotency key's namespace so FaucetLedger can
    // tell "already paid this stake's settlement payout" apart from
    // every other market's and every faucet claim's dedup keys,
    // without this DO needing to know its own player/gw/threshold.
    const idempotencyKey = `${this.ctx.id.toString()}:${payout.stakeTxHash}`;
    const amountVara = planckToVara(payout.amountPlanck);
    try {
      const id = this.env.FAUCET_LEDGER.idFromName("faucet");
      const stub = this.env.FAUCET_LEDGER.get(id);
      const response = await stub.fetch("https://faucet-ledger.internal/payout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: payout.address, amountVara, idempotencyKey }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        status?: string;
        txHash?: string;
        error?: string;
      };
      if (response.ok && (body.status === "sent" || body.status === "already_paid") && body.txHash) {
        return {
          address: payout.address,
          amountPlanck: payout.amountPlanck.toString(),
          stakeTxHash: payout.stakeTxHash,
          ok: true,
          txHash: body.txHash,
        };
      }
      return {
        address: payout.address,
        amountPlanck: payout.amountPlanck.toString(),
        stakeTxHash: payout.stakeTxHash,
        ok: false,
        error: typeof body.error === "string" ? body.error : "send_failed",
      };
    } catch (error) {
      console.error("Settlement payout request to FaucetLedger failed", error);
      return {
        address: payout.address,
        amountPlanck: payout.amountPlanck.toString(),
        stakeTxHash: payout.stakeTxHash,
        ok: false,
        error: "send_failed",
      };
    }
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
