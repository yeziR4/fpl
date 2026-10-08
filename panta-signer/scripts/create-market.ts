/**
 * Create one Panta market, end to end.
 *
 *   quote -> build -> sign (operator key) -> broadcast via Solami -> register
 *
 * Deliberately a CLI rather than only an HTTP handler. The first $20 of market
 * creation should be spent on purpose, watched, and logged -- not discovered
 * through a web request. The identical flow is exposed by api/market-create.ts
 * and api/market-register.ts for the generator to drive later.
 *
 *   node dist/scripts/create-market.js spec.json --dry-run
 *   node dist/scripts/create-market.js spec.json --live
 *
 * There is no default. You must say which one, because one of them spends
 * non-refundable USDC and the other does not.
 *
 * --dry-run stops after build. Quote and build touch nothing on chain and cost
 * nothing, so this proves Panta accepts our request shape for free. Run it
 * first, every time. It has already paid for itself once: it caught that the
 * quote route is /markets/create/quote/, not /markets/quote/, which returns
 * 405 because it collides with /markets/{marketId}/.
 *
 * The spec file takes ISO 8601 timestamps for readability and converts them to
 * the unix seconds the API actually wants. Raw unix integers are accepted too.
 */

import fs from "node:fs";
import path from "node:path";
import {
  PantaError,
  buildMarket,
  isTransientPantaFailure,
  quoteMarket,
  registerMarket,
  type MarketSpec,
} from "../lib/panta.js";
import { SolamiError, confirmSignature, sendTransaction } from "../lib/solami.js";
import {
  OperatorWalletError,
  loadOperatorKeypair,
  signVersionedTransaction,
} from "../lib/operator-wallet.js";

const MIN_START_DELAY_SECONDS = 3600;
const HOURS_72_SECONDS = 72 * 3600;

function usage(): never {
  console.error(`
Create one Panta market.

    node dist/scripts/create-market.js <spec.json> --dry-run
    node dist/scripts/create-market.js <spec.json> --live

    --dry-run    quote and build only. Touches nothing on chain, costs nothing.
                 Run this first; it validates the request shape for free.
    --live       sign, broadcast via Solami, and register. Spends USDC.

    --registry=<path>   where the settlement mapping is recorded on success.
                        Default: ../data/markets.json, beside this repo.

Environment:
    PANTA_API_KEY        pk_live_ key with canCreateMarkets
    SOLAMI_RPC_URL       defaults to https://rpc.solami.dev
    SOLAMI_API_KEY       if Solami requires one for RPC
    SOLANA_KEYPAIR_PATH  operator keypair (solana-keygen id.json or base58),
                         one of _PATH / _JSON / _B58. Required either way: its
                         public key is the creator wallet Panta quotes against.

Spec file: see examples/market-spec.example.json

The spec's "_settlement" block ({playerId, threshold, playerName, position}) is
METADATA and is never sent to Panta -- marketSpec below is built field by field.
It is what gets written to the registry, and without it a market can be created
but never scored: resolution settles on (player, threshold) and Panta has no
field for either.
`);
  process.exit(2);
}

function requiredString(spec: Record<string, unknown>, key: string): string {
  const value = spec[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`spec.${key} is required and must be a non-empty string`);
  }
  return value;
}

/** Accept ISO 8601 or raw unix seconds; the API wants unix seconds. */
function toUnixSeconds(value: unknown, field: string): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === "string") {
    const ms = Date.parse(value);
    if (!Number.isNaN(ms)) return Math.floor(ms / 1000);
  }
  throw new Error(`spec.${field} must be ISO 8601 ("2026-10-11T14:00:00Z") or unix seconds`);
}

/** Warn, do not block: Panta is the authority. This just stops obvious waste. */
function timeWarnings(startUnix: number, marketType: string): void {
  const aheadSeconds = startUnix - Date.now() / 1000;
  if (aheadSeconds < MIN_START_DELAY_SECONDS) {
    console.warn(
      `  WARN  startTime is ${Math.round(aheadSeconds)}s away. Panta's on-chain ` +
        `minimumStartDelay is typically ${MIN_START_DELAY_SECONDS}s, so this may be rejected.`,
    );
  }
  if (marketType === "breaking" && aheadSeconds > HOURS_72_SECONDS) {
    console.warn(
      `  WARN  startTime is ${(aheadSeconds / 3600).toFixed(1)}h away but this is a ` +
        `breaking market, which requires the event within 72h. Standard costs more.`,
    );
  }
  if (marketType === "standard" && aheadSeconds < HOURS_72_SECONDS) {
    console.warn(
      `  WARN  startTime is ${(aheadSeconds / 3600).toFixed(1)}h away but this is a ` +
        `standard market, which requires the event at least 72h out. Breaking costs less.`,
    );
  }
}

/** base units (6 decimals) -> a readable USDC figure. */
function baseUnitsToUsdc(base?: string): string {
  if (!base) return "?";
  const value = Number(base) / 1_000_000;
  return Number.isFinite(value) ? `${value.toFixed(2)} USDC` : `${base} base units`;
}

// ------------------------------------------------------- the market registry

/**
 * Which player and points line each Panta market settles against.
 *
 * Panta knows the question and the market id. It does not know that this market
 * is about FPL element 223340 clearing 7 points, and it has no field for it.
 * That mapping is ours, and without it a saved forecast cannot be scored at
 * all: resolution.py settles on (playerId, threshold).
 *
 * So the step that creates a market is the step that records it. Writing the
 * mapping anywhere else lets the two drift, and a drifted mapping fails
 * SILENTLY -- the board would score forecasts against the wrong player and
 * still look like it was working.
 *
 * The spec carries the mapping under `_settlement`. Like the other
 * underscore-prefixed fields it is metadata and is deliberately never sent to
 * Panta: marketSpec below is built field by field.
 */
const REGISTRY_DEFAULT = path.join("..", "data", "markets.json");

interface RegistryEntry {
  market_id: string;
  question: string;
  /** FPL element id, not the photo `code` -- what resolution.py looks players up by. */
  player_id: number | null;
  threshold: number | null;
  player_name: string;
  position: string;
  market_type: string;
  title: string;
  created_at: string;
  signature: string;
}

function recordMarket(registryPath: string, entry: RegistryEntry): void {
  let entries: RegistryEntry[] = [];
  if (fs.existsSync(registryPath)) {
    const raw = fs.readFileSync(registryPath, "utf8").replace(/^\uFEFF/, "");
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error(`${registryPath} exists but is not a JSON array`);
    }
    entries = parsed as RegistryEntry[];
  }

  // Idempotent by market_id: re-running a create that already registered
  // replaces its row rather than duplicating it, which is what makes this safe
  // to call after a retry.
  const kept = entries.filter((e) => e?.market_id !== entry.market_id);
  kept.push(entry);
  kept.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));

  fs.mkdirSync(path.dirname(registryPath), { recursive: true });
  fs.writeFileSync(registryPath, `${JSON.stringify(kept, null, 2)}\n`);
}

/** The registry path, from --registry=<path> or the default beside the repo. */
function registryPathFrom(argv: string[]): string {
  const flag = argv.find((a) => a.startsWith("--registry="));
  return flag ? flag.slice("--registry=".length) : REGISTRY_DEFAULT;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const live = argv.includes("--live");
  if (dryRun === live) usage(); // neither, or both

  const specPath = argv.find((a) => !a.startsWith("--"));
  if (!specPath || !fs.existsSync(specPath)) {
    console.error(`Spec file not found: ${specPath ?? "(none given)"}`);
    return 2;
  }

  // Strip a UTF-8 BOM. Windows editors add one readily and JSON.parse chokes
  // on it with an error that names the token rather than the cause.
  const raw = fs.readFileSync(specPath, "utf8").replace(/^\uFEFF/, "");
  const spec = JSON.parse(raw) as Record<string, unknown>;

  // The creator wallet is whoever signs, so it comes from the keypair unless
  // the spec overrides it. Loaded even for --dry-run, because Panta requires
  // `wallet` at quote time.
  const keypair = loadOperatorKeypair();
  const wallet = typeof spec.wallet === "string" && spec.wallet ? spec.wallet : keypair.publicKey.toBase58();

  const marketType = requiredString(spec, "marketType");
  if (marketType !== "standard" && marketType !== "breaking") {
    throw new Error('spec.marketType must be "standard" or "breaking"');
  }

  const startTime = toUnixSeconds(spec.startTime, "startTime");
  const endTime = toUnixSeconds(spec.endTime, "endTime");
  const resolutionTime = toUnixSeconds(spec.resolutionTime, "resolutionTime");

  const sourcesOfTruth = spec.sourcesOfTruth;
  if (!Array.isArray(sourcesOfTruth) || sourcesOfTruth.length === 0) {
    throw new Error("spec.sourcesOfTruth must be a non-empty array of URLs");
  }

  const marketSpec: MarketSpec = {
    wallet,
    question: requiredString(spec, "question"),
    resolutionRule: requiredString(spec, "resolutionRule"),
    sourcesOfTruth: sourcesOfTruth as string[],
    category: requiredString(spec, "category"),
    startTime,
    endTime,
    resolutionTime,
    marketType,
    title: requiredString(spec, "title"),
    imageUrl: requiredString(spec, "imageUrl"),
    ...(typeof spec.description === "string" ? { description: spec.description } : {}),
    ...(typeof spec.region === "string" ? { region: spec.region } : {}),
    ...(spec.eventInProgress === true ? { eventInProgress: true } : {}),
  };

  console.log(`\nTitle  : ${marketSpec.title}`);
  console.log(`Question: ${marketSpec.question}`);
  console.log(`Type   : ${marketType}`);
  console.log(`Creator: ${wallet}`);
  console.log(`Start  : ${new Date(startTime * 1000).toISOString()}`);
  console.log(`Ends   : ${new Date(endTime * 1000).toISOString()}`);
  console.log(`Resolve: ${new Date(resolutionTime * 1000).toISOString()}`);
  console.log(`Sources: ${(sourcesOfTruth as string[]).join(", ")}`);
  console.log(`Mode   : ${dryRun ? "DRY RUN -- nothing signed or broadcast" : "LIVE -- this spends USDC"}`);
  timeWarnings(startTime, marketType);

  // ------------------------------------------------------------ 1. quote
  console.log("\n[1/5] POST /markets/create/quote/");
  const quote = await quoteMarket(marketSpec);
  if (!quote.createId) throw new Error(`no createId in quote: ${JSON.stringify(quote)}`);
  console.log(`  createId      ${quote.createId}`);
  console.log(`  expectedEventPda ${quote.expectedEventPda ?? "?"}`);
  // Read the fee back from Panta rather than trusting a constant.
  console.log(`  payment       ${baseUnitsToUsdc(quote.paymentUsdc)}  (non-refundable)`);
  console.log(`  of which      ${baseUnitsToUsdc(quote.liquidityInjectionUsdc)} seeds liquidity, ` +
    `${baseUnitsToUsdc(quote.platformRevenueUsdc)} is platform revenue`);
  console.log(`  expiresAt     ${quote.expiresAt ?? "?"} (createId lives ~5 min)`);

  // ------------------------------------------------------------ 2. build
  console.log("\n[2/5] POST /markets/create/build/");
  const built = await buildMarket(quote.createId, wallet);
  if (!built.transaction) {
    throw new Error(`no transaction in build response: ${JSON.stringify(built).slice(0, 400)}`);
  }
  console.log(`  unsigned tx   ${Buffer.from(built.transaction, "base64").length} bytes`);
  console.log(`  blockhash     ${built.recentBlockhash ?? "?"} ` +
    `(expires in ~${built.blockhashExpiryHintSec ?? 60}s)`);

  if (dryRun) {
    console.log("\n=== DRY RUN COMPLETE ===");
    console.log(
      `Panta accepted the spec. Nothing was spent. A live run would cost ` +
        `${baseUnitsToUsdc(quote.paymentUsdc)}.`,
    );
    console.log("\nNOTE: that reserved a create session for this wallet + question.");
    console.log("Panta then rejects a second quote for the same pair with");
    console.log("DUPLICATE_MARKET. So dry-run with a THROWAWAY keypair, never the");
    console.log("operator key -- otherwise you block the very create you were testing.");
    return 0;
  }

  // ------------------------------------------------------------- 3. sign
  console.log("\n[3/5] signing with the operator keypair");
  const signed = signVersionedTransaction(built.transaction, keypair);
  console.log(`  signed tx     ${Buffer.from(signed, "base64").length} bytes`);

  // -------------------------------------------------------- 4. broadcast
  console.log("\n[4/5] broadcasting via Solami");
  const signature = await sendTransaction(signed);
  console.log(`  signature     ${signature}`);
  const confirmation = await confirmSignature(signature);
  if (confirmation.failed) {
    console.error(`  FAILED on chain: ${String(confirmation.err)}`);
    console.error("  The creation fee may still have been charged. Check the explorer before retrying.");
    return 1;
  }
  console.log(`  confirmed     ${confirmation.confirmed}`);

  // --------------------------------------------------------- 5. register
  console.log("\n[5/5] POST /markets/register/");
  let registered: Record<string, unknown>;
  try {
    registered = await registerMarket(quote.createId, signature);
    console.log(`  ${JSON.stringify(registered).slice(0, 500)}`);
  } catch (error) {
    // The market is on chain either way. Register is idempotent for the same
    // createId + signature, so retrying costs nothing -- re-broadcasting would
    // pay the fee twice.
    console.error(`  register failed: ${error instanceof Error ? error.message : String(error)}`);
    console.error("  The transaction is on chain. Retry ONLY the register step:");
    console.error(`    createId=${quote.createId}  signature=${signature}`);
    return 1;
  }

  console.log("\n=== MARKET CREATED ===");
  const marketId = String(registered.marketId ?? quote.expectedEventPda ?? "");
  console.log(`  title     : ${marketSpec.title}`);
  console.log(`  marketId  : ${marketId || "?"}`);
  console.log(`  createId  : ${quote.createId}`);
  console.log(`  signature : ${signature}`);
  console.log(`  fee       : ${baseUnitsToUsdc(quote.paymentUsdc)} (${marketType})`);
  console.log(`  wallet    : ${wallet}`);

  // Record the settlement mapping. A market that exists but isn't in the
  // registry cannot be scored, so this failing is loud rather than silent --
  // but it is not fatal, because the market is already on chain and paid for.
  const settlement = (spec._settlement ?? {}) as Record<string, unknown>;
  const registryPath = registryPathFrom(argv);
  try {
    recordMarket(registryPath, {
      market_id: marketId,
      question: marketSpec.question,
      player_id: typeof settlement.playerId === "number" ? settlement.playerId : null,
      threshold: typeof settlement.threshold === "number" ? settlement.threshold : null,
      player_name: typeof settlement.playerName === "string" ? settlement.playerName : "",
      position: typeof settlement.position === "string" ? settlement.position : "",
      market_type: marketType,
      title: marketSpec.title,
      created_at: new Date().toISOString(),
      signature,
    });
    console.log(`  registry  : ${registryPath}`);
    if (typeof settlement.playerId !== "number" || typeof settlement.threshold !== "number") {
      console.log("  WARN      : spec._settlement carried no playerId/threshold, so this");
      console.log("              market is recorded but cannot be scored. Add them and re-run");
      console.log("              the register step, or fix the registry by hand.");
    }
  } catch (error) {
    console.error(`  WARN could not write ${registryPath}: ${String(error)}`);
    console.error("       The market is on chain either way. Record the mapping by hand, or");
    console.error("       forecasts on it cannot be scored against a resolution.");
  }

  console.log("\nRecord this in the spend log -- it is the expense evidence AND the");
  console.log("prior-work disclosure for the submission.");
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    if (error instanceof PantaError) {
      console.error(`\nPanta rejected it: ${error.code} (HTTP ${error.status})`);
      console.error(`  ${error.message}`);
      if (error.field) console.error(`  field: ${error.field}`);
      if (error.fields) console.error(`  fields: ${JSON.stringify(error.fields)}`);
      if (isTransientPantaFailure(error)) {
        console.error("  That is Panta's TRANSIENT create-session failure, not your payload.");
        console.error("  It strikes quote, build and register at random; run it again.");
      }
      if (error.isStaleSession) console.error("  Session expired. Re-run from the quote step.");
      if (error.code === "DUPLICATE_MARKET") {
        console.error("  Panta already has an active create session for this wallet + question.");
        console.error("  If you dry-ran this exact market with this wallet, that is what blocks");
        console.error("  it. Dry-run with a throwaway keypair, change the question, or wait");
        console.error("  for the session to expire.");
      }
    } else if (error instanceof SolamiError) {
      console.error(`\nSolami rejected the broadcast: ${error.message}`);
    } else if (error instanceof OperatorWalletError) {
      console.error(`\nOperator wallet: ${error.message}`);
    } else {
      console.error(`\n${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    }
    process.exit(1);
  });
