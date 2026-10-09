/**
 * Turn saved model forecasts into real orders.
 *
 *   node dist/scripts/run-agents.js --check      balances and picks. Sends nothing.
 *   node dist/scripts/run-agents.js --dry-run    quote+build+compile every order, place none
 *   node dist/scripts/run-agents.js --live       place real orders
 *
 * There is no default. One of those spends real USDC across five wallets.
 *
 * This is the point the whole project has been walking toward: the models stop
 * being a scoreboard and start being counterparties. Each one signs with its
 * own key, so the P&L that results is a fact about the chain rather than a
 * number we computed, which is what makes the benchmark worth anything.
 *
 * Design rules, all of them learned the hard way elsewhere in this repo:
 *
 *   - One model's failure never stops another's. Five independent wallets means
 *     five independent failure modes, and a partial result is still a result.
 *   - Every fill is recorded with its signature and the price actually paid.
 *     The price a model THOUGHT it was getting lives in the picks file; what it
 *     got lives here, and confusing the two would flatter the leaderboard.
 *   - A model that overspends its bankroll is refused, not truncated silently.
 *     Truncation would change its stake after the fact and quietly corrupt the
 *     only comparison that matters.
 *   - Nothing is retried after a broadcast. A retried order pays twice.
 */

import fs from "node:fs";
import path from "node:path";
import { loadAgentKeypair } from "../lib/agent-wallets.js";
import { OrderFill, placePrimaryOrder } from "../lib/order.js";
import { solamiRpc } from "../lib/solami.js";

const PICKS_PATH = path.join("..", "data", "agent_picks");
const FILLS_PATH = path.join("..", "data", "agent_fills");
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
/** Rent plus a few transactions. Below this an agent cannot reliably trade. */
const MIN_SOL = 0.0015;

function usage(): never {
  console.error(`
Turn saved model forecasts into real orders.

    node dist/scripts/run-agents.js --gw=6 --check
    node dist/scripts/run-agents.js --gw=6 --dry-run
    node dist/scripts/run-agents.js --gw=6 --live

    --gw=<n>   which gameweek's picks to execute. Required.

Environment:
    AGENT_KEYPAIRS_DIR   where the agent keypairs live
    PANTA_API_KEY        pk_live_ key
    SOLAMI_RPC_URL / SOLAMI_API_KEY / SOLANA_RPC_FALLBACK_URL  as elsewhere
`);
  process.exit(2);
}

interface SavedPick {
  market_id: string;
  player_id: number | null;
  threshold: number | null;
  probability: number;
  stake_usdc: number;
  reasoning: string;
  yes_price_at_decision: number | null;
  no_price_at_decision: number | null;
  side: string | null;
  edge: number | null;
}

interface SavedModel {
  slug: string;
  name: string;
  solana_address: string;
  error: string | null;
  picks: SavedPick[];
}

async function agentBalance(address: string): Promise<{ sol: number; usdc: number }> {
  const balance = await solamiRpc<{ value: number }>("getBalance", [address]);
  const sol = (balance?.value ?? 0) / 1_000_000_000;
  try {
    const accounts = await solamiRpc<{ value: { account: { data: unknown } }[] }>(
      "getTokenAccountsByOwner",
      [address, { mint: USDC_MINT }, { encoding: "jsonParsed" }],
    );
    let usdc = 0;
    for (const entry of accounts?.value ?? []) {
      const parsed = (entry.account.data as { parsed?: { info?: { tokenAmount?: { uiAmountString?: string } } } })
        ?.parsed;
      usdc += Number(parsed?.info?.tokenAmount?.uiAmountString ?? 0);
    }
    return { sol, usdc };
  } catch {
    return { sol, usdc: 0 };
  }
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const check = argv.includes("--check");
  const dryRun = argv.includes("--dry-run");
  const live = argv.includes("--live");
  const modes = [check, dryRun, live].filter(Boolean).length;
  if (modes !== 1) usage();

  const gwFlag = argv.find((a) => a.startsWith("--gw="));
  if (!gwFlag) usage();
  const gw = Number(gwFlag.slice("--gw=".length));
  if (!Number.isInteger(gw) || gw <= 0) usage();

  const picksFile = path.join(PICKS_PATH, `gw${gw}.json`);
  if (!fs.existsSync(picksFile)) {
    console.error(`No picks at ${picksFile}. Run the generator first:`);
    console.error(`  python -m data_pipeline.cli generate-picks --gw ${gw}`);
    return 1;
  }
  const saved = JSON.parse(fs.readFileSync(picksFile, "utf8")) as { models: SavedModel[] };

  // Refuse a picks file this trader cannot actually read orders out of.
  //
  // Found for real: three stale picks files sat in data/agent_picks from before
  // the move off Vara, in a format whose picks carry `player_id` and
  // `confidence` instead of `market_id` and `stake_usdc`. Read naively they
  // produce five models with zero tradeable picks -- which is INDISTINGUISHABLE
  // from "every model passed this week", a completely legitimate outcome. A
  // silent misread that looks like a real result is the worst failure this
  // script could have, so it is loud instead.
  const strayField = saved.models
    .flatMap((m) => m.picks ?? [])
    .find((p) => !("market_id" in p) || !("stake_usdc" in p));
  if (strayField) {
    console.error(`${picksFile} is not in the format this trader places orders from.`);
    console.error(`  a pick is missing market_id or stake_usdc: ${JSON.stringify(strayField).slice(0, 160)}`);
    console.error("  This looks like a picks file written before the move off Vara.");
    console.error(`  Regenerate it:  python -m data_pipeline.cli generate-picks --gw ${gw}`);
    return 1;
  }

  const mode = check ? "CHECK" : dryRun ? "DRY RUN" : "LIVE";

  // Idempotency, and it matters more than it looks.
  //
  // A live run can partially fail: during a dry run one order exhausted all six
  // retries against Panta's transient failure while the other nine went through,
  // and the natural response to that is to run the trader again. Without this,
  // running it again would place every ALREADY-SUCCESSFUL order a second time,
  // which is real money and a corrupted benchmark.
  //
  // So anything with a real signature from a previous LIVE run is skipped. Dry
  // runs and checks are ignored on purpose -- they filled nothing, and their
  // "(dry run)" signature is not a fill.
  const fillsFile = path.join(FILLS_PATH, `gw${gw}.json`);
  const alreadyFilled = new Set<string>();
  if (fs.existsSync(fillsFile)) {
    try {
      const prior = JSON.parse(fs.readFileSync(fillsFile, "utf8")) as {
        mode?: string;
        models?: { slug: string; fills?: OrderFill[] }[];
      };
      if (prior.mode === "live") {
        for (const m of prior.models ?? []) {
          for (const f of m.fills ?? []) {
            if (f.signature && f.signature !== "(dry run)") {
              alreadyFilled.add(`${m.slug}|${f.marketId}|${f.side}`);
            }
          }
        }
      }
    } catch {
      // An unreadable fills file must not block trading; it just means we cannot
      // promise idempotency, which the summary below says out loud.
      console.warn(`  WARN could not read ${fillsFile}; cannot skip already-placed orders.`);
    }
  }

  console.log(`\nGameweek : ${gw}`);
  console.log(`Picks    : ${picksFile}`);
  console.log(`Mode     : ${mode}${live ? " -- this spends real USDC from five wallets" : ""}`);
  if (alreadyFilled.size > 0) {
    console.log(`Already  : ${alreadyFilled.size} order(s) already placed this gameweek -- those are skipped`);
  }
  console.log("");

  const fills: { gw: number; executed_at: string; mode: string; models: unknown[] } = {
    gw,
    executed_at: new Date().toISOString(),
    mode: mode.toLowerCase(),
    models: [],
  };

  let totalOrders = 0;
  let totalFailures = 0;

  for (const model of saved.models) {
    const modelFills: OrderFill[] = [];
    const failures: string[] = [];

    if (model.error) {
      console.log(`  ${model.name.padEnd(22)} skipped: ${model.error}`);
      fills.models.push({ slug: model.slug, name: model.name, address: model.solana_address, error: model.error, fills: [] });
      continue;
    }
    if (model.picks.length === 0) {
      console.log(`  ${model.name.padEnd(22)} no view -- it forecast nothing, so it trades nothing`);
      fills.models.push({ slug: model.slug, name: model.name, address: model.solana_address, error: null, fills: [] });
      continue;
    }

    let keypair;
    try {
      keypair = loadAgentKeypair(model.slug);
    } catch (error) {
      console.error(`  ${model.name.padEnd(22)} NO KEYPAIR: ${error instanceof Error ? error.message : String(error)}`);
      totalFailures += 1;
      fills.models.push({ slug: model.slug, name: model.name, address: model.solana_address, error: "no keypair", fills: [] });
      continue;
    }

    const address = keypair.publicKey.toBase58();
    const balance = await agentBalance(address);

    // Tradeable picks only: a forecast with no side has no +EV trade in it.
    // The type predicate narrows `side` to a real side for everything below,
    // rather than a cast that would hide a null if the filter ever changed.
    const tradeable = model.picks.filter(
      (p): p is SavedPick & { side: "yes" | "no" } => p.side === "yes" || p.side === "no",
    );
    const wanted = tradeable.reduce((sum, p) => sum + p.stake_usdc, 0);

    console.log(
      `  ${model.name.padEnd(22)} ${balance.usdc.toFixed(2)} USDC  ${balance.sol.toFixed(6)} SOL  ` +
        `${tradeable.length}/${model.picks.length} tradeable  wants ${wanted.toFixed(2)} USDC`,
    );

    if (check) {
      for (const p of tradeable) {
        console.log(`      ${p.side.toUpperCase().padEnd(4)} ${p.stake_usdc.toFixed(2)} USDC on ${p.market_id}`);
      }
      if (balance.usdc < wanted) console.log(`      SHORT ${(wanted - balance.usdc).toFixed(2)} USDC`);
      if (balance.sol < MIN_SOL) console.log(`      SHORT on SOL: has ${balance.sol.toFixed(6)}, needs ~${MIN_SOL}`);
      fills.models.push({ slug: model.slug, name: model.name, address, error: null, fills: [] });
      continue;
    }

    // Refuse rather than truncate. Cutting a stake down to fit would change the
    // bet after the fact and corrupt the comparison the whole thing exists for.
    if (balance.usdc < wanted) {
      const message = `needs ${wanted.toFixed(2)} USDC, holds ${balance.usdc.toFixed(2)} -- refusing to part-fund`;
      console.error(`  ${" ".repeat(22)} ${message}`);
      totalFailures += 1;
      fills.models.push({ slug: model.slug, name: model.name, address, error: message, fills: [] });
      continue;
    }
    if (balance.sol < MIN_SOL) {
      const message = `has ${balance.sol.toFixed(6)} SOL, needs ~${MIN_SOL} to pay fees`;
      console.error(`  ${" ".repeat(22)} ${message}`);
      totalFailures += 1;
      fills.models.push({ slug: model.slug, name: model.name, address, error: message, fills: [] });
      continue;
    }

    for (const pick of tradeable) {
      const side = pick.side as "yes" | "no";

      // Skip anything a previous LIVE run already placed. See the note where
      // alreadyFilled is built: re-running after a partial failure must retry
      // only what failed.
      if (alreadyFilled.has(`${model.slug}|${pick.market_id}|${side}`)) {
        console.log(`      ${side.toUpperCase().padEnd(4)} ${pick.stake_usdc.toFixed(2)} USDC  already placed -- skipped`);
        continue;
      }

      try {
        const fill = await placePrimaryOrder({
          marketId: pick.market_id,
          side,
          amountUsdc: pick.stake_usdc,
          keypair,
          dryRun,
          log: (m) => console.log(`      ${m}`),
        });
        modelFills.push(fill);
        totalOrders += 1;
        console.log(
          `      ${side.toUpperCase().padEnd(4)} ${pick.stake_usdc.toFixed(2)} USDC -> ${fill.shares ?? "?"} shares ` +
            `@ ${fill.avgPrice ?? "?"} [${fill.status}]`,
        );
        if (fill.signature !== "(dry run)") console.log(`      ${" ".repeat(4)} ${fill.signature}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${side} ${pick.stake_usdc.toFixed(2)} on ${pick.market_id}: ${message}`);
        totalFailures += 1;
        console.error(`      FAILED ${side}: ${message}`);
      }
    }

    fills.models.push({
      slug: model.slug,
      name: model.name,
      address,
      error: failures.length ? failures.join(" | ") : null,
      fills: modelFills,
    });
  }

  // Written even for --check and --dry-run, so a dry run leaves evidence of
  // what it would have done rather than vanishing. `fillsFile` was resolved
  // earlier, when the prior-live-fills check read it.
  fs.mkdirSync(FILLS_PATH, { recursive: true });
  fs.writeFileSync(fillsFile, `${JSON.stringify(fills, null, 2)}\n`);

  console.log(`\n${totalOrders} order(s) ${live ? "placed" : "previewed"}, ${totalFailures} failure(s).`);
  console.log(`Fills -> ${fillsFile}`);

  if (check) {
    console.log("\nCHECK complete. Nothing was sent. --dry-run next, then --live.");
  }
  return totalFailures === 0 ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(`\n${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    process.exit(1);
  });
