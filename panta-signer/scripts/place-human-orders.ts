/**
 * Place the human calls on chain.
 *
 *   cd panta-signer
 *   node dist/scripts/place-human-orders.js --gw=6 --check
 *   node dist/scripts/place-human-orders.js --gw=6 --dry-run
 *   node dist/scripts/place-human-orders.js --gw=6 --live
 *
 *     --stake=<usdc>   what each call gets. Default 3.00
 *     --handle=<@x>    only this participant
 *     --market=<id>    only calls on this market
 *
 * This is run-agents' counterpart for the humans, and it differs in ways that
 * matter:
 *
 *   - It does NOT generate forecasts. A human already said what they think in
 *     public; our job is to execute it, not to interpret it. Nothing here can
 *     change a side or a reason.
 *   - It records the fill BACK into data/human_picks.json, because that file is
 *     the record of a named person's position and the transaction has to be
 *     attached to them rather than kept in a side ledger.
 *   - It refuses to place anything for a participant whose wallet has no USDC,
 *     rather than letting the chain discover it and leaving a partial batch.
 *
 * The idempotency rules are the same as run-agents and were learned the hard
 * way there: a fill is only trusted when it has a real signature, and the mode
 * is never downgraded by a --check run.
 */

import fs from "node:fs";
import path from "node:path";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { Keypair } from "@solana/web3.js";
import { placePrimaryOrder } from "../lib/order.js";
import { solamiRpc } from "../lib/solami.js";

const HERE = import.meta.dirname;

function findProjectRoot(start: string): string {
  let dir = path.resolve(start);
  for (let i = 0; i < 6; i += 1) {
    if (fs.existsSync(path.join(dir, "data", "markets.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`could not find data/markets.json above ${start}`);
}

const PROJECT_ROOT = findProjectRoot(HERE);
const HUMAN_PICKS = path.join(PROJECT_ROOT, "data", "human_picks.json");
const WALLETS_DIR =
  process.env.HUMAN_KEYPAIRS_DIR ?? path.resolve(PROJECT_ROOT, "..", ".human-wallets");

/** Below this, an order fails at broadcast with a rent error rather than a clear one. */
const MIN_SOL = 0.0015;

interface Prediction {
  market_id: string;
  side?: string;
  reasoning?: string;
  fill?: {
    signature?: string;
    shares?: string;
    avgPrice?: string;
  } | null;
  stake_usdc?: number;
}
interface Participant {
  handle: string;
  displayName?: string;
  wallet?: string | null;
  predictions?: Prediction[];
}
interface HumanFile {
  gw?: number;
  participants?: Participant[];
  [key: string]: unknown;
}

function flag(name: string, argv: string[]): string | undefined {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

function keyFilenameFor(handle: string): string {
  return `${handle.replace(/^@/, "").replace(/[^A-Za-z0-9._-]/g, "") || "unnamed"}.json`;
}

/** A real, confirmed signature -- not the placeholder recover_fills writes. */
function realSignature(sig: string | undefined): string | null {
  if (!sig) return null;
  if (sig.startsWith("(")) return null;
  return sig.length >= 80 ? sig : null;
}

function usage(): never {
  console.error(`
Place the human calls on chain.

    node dist/scripts/place-human-orders.js --gw=6 --check
    node dist/scripts/place-human-orders.js --gw=6 --dry-run
    node dist/scripts/place-human-orders.js --gw=6 --live

    --stake=<usdc>   stake per call. Default 3.00
    --handle=<@x>    only this participant
    --market=<id>    only calls on this market

Environment:
    HUMAN_KEYPAIRS_DIR   where the human keypairs live. Default: ${WALLETS_DIR}
`);
  process.exit(2);
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) usage();

  const mode = argv.includes("--check") ? "check" : argv.includes("--dry-run") ? "dry-run" : argv.includes("--live") ? "live" : null;
  if (!mode) {
    console.error("Pass exactly one of --check, --dry-run or --live.");
    return 2;
  }

  const gw = Number(flag("gw", argv));
  if (!Number.isFinite(gw)) {
    console.error("--gw=<n> is required.");
    return 2;
  }
  const stake = Number(flag("stake", argv) ?? 3.0);
  if (!Number.isFinite(stake) || stake <= 0) return 2;

  const onlyHandle = flag("handle", argv);
  const onlyMarket = flag("market", argv);

  const doc = JSON.parse(fs.readFileSync(HUMAN_PICKS, "utf8")) as HumanFile;
  const markets = JSON.parse(
    fs.readFileSync(path.join(PROJECT_ROOT, "data", "markets.json"), "utf8"),
  ) as { market_id: string; player_name: string }[];
  const nameOf = new Map(markets.map((m) => [m.market_id, m.player_name]));

  console.log(`\nGameweek : ${gw}`);
  console.log(`Stake    : ${stake.toFixed(2)} USDC per call`);
  console.log(`Wallets  : ${WALLETS_DIR}`);
  console.log(`Mode     : ${mode === "live" ? "LIVE -- real money" : mode.toUpperCase()}`);

  const participants = (doc.participants ?? []).filter(
    (p) => p.wallet && (!onlyHandle || p.handle === onlyHandle),
  );

  interface Job {
    p: Participant;
    pred: Prediction;
    keypair: Keypair;
    usdc: number;
    sol: number;
    label: string;
  }
  const jobs: Job[] = [];
  const problems: string[] = [];

  for (const p of participants) {
    const keyFile = path.join(WALLETS_DIR, keyFilenameFor(p.handle));
    if (!fs.existsSync(keyFile)) {
      problems.push(`${p.handle}: no key file at ${keyFile}`);
      continue;
    }

    let keypair: Keypair;
    try {
      const raw = fs.readFileSync(keyFile, "utf8").trim();
      keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw.replace(/^\uFEFF/, "")) as number[]));
    } catch (error) {
      problems.push(`${p.handle}: unreadable key file -- ${String(error)}`);
      continue;
    }

    // A key that does not derive the published address means the registry and
    // the keys disagree, and placing an order would put someone's money behind
    // a position nobody can prove is theirs.
    if (keypair.publicKey.toBase58() !== p.wallet) {
      problems.push(
        `${p.handle}: key derives ${keypair.publicKey.toBase58()} but the registry says ${p.wallet}`,
      );
      continue;
    }

    const balance = await solamiRpc<{ value: number }>("getBalance", [p.wallet]);
    const sol = (balance?.value ?? 0) / LAMPORTS_PER_SOL;

    for (const pred of p.predictions ?? []) {
      if (onlyMarket && pred.market_id !== onlyMarket) continue;
      if (pred.side !== "yes" && pred.side !== "no") continue;
      if (realSignature(pred.fill?.signature)) continue; // already placed
      // Stake in the prediction wins over the flag: the amount is part of the
      // record, and a later run with a different --stake must not silently
      // change what somebody's call was worth.
      const amount = pred.stake_usdc ?? stake;
      jobs.push({
        p,
        pred,
        keypair,
        usdc: amount,
        sol,
        label: `${p.handle} -> ${nameOf.get(pred.market_id) ?? "?"} ${pred.side.toUpperCase()} $${amount.toFixed(2)}`,
      });
    }
  }

  console.log("");
  if (jobs.length === 0) {
    console.log("  Nothing to place.");
    for (const problem of problems) console.log(`  NOTE ${problem}`);
    return problems.length ? 1 : 0;
  }

  for (const job of jobs) {
    const flat = job.sol < MIN_SOL ? "  LOW SOL" : "";
    console.log(`  ${job.label.padEnd(46)} ${job.sol.toFixed(6)} SOL  ${job.usdc.toFixed(2)} USDC${flat}`);
  }
  for (const problem of problems) console.log(`  NOTE ${problem}`);

  if (mode === "check") {
    console.log(`\nCHECK complete. ${jobs.length} order(s) would be placed. Nothing was sent.`);
    return 0;
  }

  console.log("");
  let placed = 0;
  let failures = 0;
  for (const job of jobs) {
    try {
      const fill = await placePrimaryOrder({
        marketId: job.pred.market_id,
        side: job.pred.side as "yes" | "no",
        amountUsdc: job.usdc,
        keypair: job.keypair,
        dryRun: mode === "dry-run",
        log: (m) => console.log(`      ${m}`),
      });

      if (mode === "live") {
        // Written back immediately, per order, so a crash halfway through leaves
        // the completed ones recorded rather than losing them.
        job.pred.fill = {
          signature: fill.signature,
          shares: fill.shares ?? undefined,
          avgPrice: fill.avgPrice ?? undefined,
        };
        fs.writeFileSync(HUMAN_PICKS, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
      }

      placed += 1;
      console.log(
        `  ${job.p.handle.padEnd(18)} ${job.pred.side!.toUpperCase().padEnd(4)} ` +
          `${job.usdc.toFixed(2)} USDC -> ${fill.shares ?? "?"} shares @ ${fill.avgPrice ?? "?"} ` +
          `[${mode === "dry-run" ? "dry run" : "submitted"}]`,
      );
    } catch (error) {
      failures += 1;
      // order.ts has no error class of its own; whatever it throws carries the
      // detail in its message, so read that rather than guessing at a type.
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`  ${job.p.handle.padEnd(18)} FAILED ${job.pred.side?.toUpperCase()} -- ${detail}`);
    }
  }

  console.log(`\n${placed} order(s) placed, ${failures} failure(s).`);
  return failures === 0 ? 0 : 1;
}

process.exit(await main());
