/**
 * Buy primary shares in a Panta market.
 *
 *   node --env-file=..\.env.local dist/scripts/buy.js <marketId> <yes|no> <usdc> [--dry-run]
 *
 * The buy flow is NOT the create flow, and the difference is the thing most
 * likely to be got wrong: market creation returns an assembled
 * VersionedTransaction, while a primary buy returns bare *instructions* that
 * the client has to compile into a versioned transaction itself. So this file
 * exists mainly for `toInstruction` below.
 *
 * Steps, and why each one matters:
 *
 *   1. quote    -- locks a price. Lives ~90 seconds.
 *   2. build    -- returns instructions + recentBlockhash. Lives ~120 seconds.
 *   3. compile + sign (operator key)
 *   4. broadcast via Solami -- Panta's model ends with "you broadcast on your RPC"
 *   5. confirm on chain -- Panta only counts a trade it can see
 *   6. submit the signature -- idempotent on orderId + signature
 *   7. verify -- fail-closed, so a clean result is evidence not a receipt
 *
 * --dry-run stops after build. Quote and build cost nothing, so this proves the
 * whole request shape for free.
 */

import {
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  PantaError,
  buildOrder,
  isTransientPantaFailure,
  quoteOrder,
  submitOrder,
  verifyOrder,
} from "../lib/panta.js";
import { SolamiError, confirmSignature, sendTransaction } from "../lib/solami.js";
import {
  OperatorWalletError,
  loadOperatorKeypair,
} from "../lib/operator-wallet.js";

/** Panta returns instructions in the shape below; @solana/web3.js wants its own. */
interface RawInstruction {
  programId: string;
  data: string;
  accounts?: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
}

function toInstruction(raw: unknown): TransactionInstruction {
  const ix = raw as RawInstruction;
  if (!ix?.programId || typeof ix.data !== "string") {
    throw new Error(`unrecognised instruction: ${JSON.stringify(raw).slice(0, 200)}`);
  }
  return new TransactionInstruction({
    programId: new PublicKey(ix.programId),
    keys: (ix.accounts ?? []).map((a) => ({
      pubkey: new PublicKey(a.pubkey),
      isSigner: Boolean(a.isSigner),
      isWritable: Boolean(a.isWritable),
    })),
    data: Buffer.from(ix.data, "base64"),
  });
}

function usage(): never {
  console.error(`
Buy primary shares.

    node dist/scripts/buy.js <marketId> <yes|no> <usdc> [--dry-run]

    --dry-run    quote and build only. Costs nothing.

Environment:
    PANTA_API_KEY        pk_live_ key
    SOLANA_KEYPAIR_PATH  buyer keypair
    SOLAMI_RPC_TOKEN     or SOLANA_RPC_FALLBACK_URL -- see lib/solami.ts
`);
  process.exit(2);
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const positional = argv.filter((a) => !a.startsWith("--"));

  if (positional.length < 3) usage();
  const [marketId, sideArg, amountUsdc] = positional;
  if (sideArg !== "yes" && sideArg !== "no") {
    console.error('side must be "yes" or "no"');
    return 2;
  }
  const amount = Number(amountUsdc);
  if (!Number.isFinite(amount) || amount < 0.1) {
    console.error("amount must be at least 0.10 USDC -- Panta rejects less at quote time");
    return 2;
  }

  const keypair = loadOperatorKeypair();
  const wallet = keypair.publicKey.toBase58();

  console.log(`\nMarket : ${marketId}`);
  console.log(`Side   : ${sideArg.toUpperCase()}`);
  console.log(`Amount : ${amountUsdc} USDC`);
  console.log(`Buyer  : ${wallet}`);
  console.log(`Mode   : ${dryRun ? "DRY RUN" : "LIVE -- this spends USDC"}`);

  // ------------------------------------------------------------- 1. quote
  console.log("\n[1/6] POST /primaryorderquote/");
  const quote = await quoteOrder({ marketId, side: sideArg, amountUsdc, wallet });
  if (!quote.quoteId) throw new Error(`no quoteId: ${JSON.stringify(quote)}`);
  console.log(`  quoteId      ${quote.quoteId}`);
  console.log(`  shares       ${quote.shares ?? "?"} at avg ${quote.avgPrice ?? "?"}`);
  console.log(`  fee          ${quote.feeUsdc ?? "?"} USDC`);
  console.log(`  expiresAt    ${quote.expiresAt ?? "?"} (about 90 seconds)`);

  // ------------------------------------------------------------- 2. build
  console.log("\n[2/6] POST /primaryorderbuild/");
  const built = await buildOrder({ quoteId: quote.quoteId, wallet });
  if (!built.orderId || !Array.isArray(built.instructions)) {
    throw new Error(`unusable build: ${JSON.stringify(built).slice(0, 400)}`);
  }
  console.log(`  orderId      ${built.orderId}`);
  console.log(`  instructions ${built.instructions.length}`);
  console.log(`  blockhash    ${built.recentBlockhash} (expires in ~60s)`);

  // ---------------------------------------------------------- 3. compile
  // Done BEFORE the dry-run exit on purpose. Compiling Panta's bare
  // instructions into a versioned transaction is the step most likely to be
  // wrong -- the create flow hands you an assembled transaction and this one
  // does not -- so a dry run that skipped it would not be testing the risky
  // part at all.
  console.log("\n[3/6] compiling instructions");
  const message = new TransactionMessage({
    payerKey: keypair.publicKey,
    recentBlockhash: built.recentBlockhash,
    instructions: built.instructions.map(toInstruction),
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  console.log(`  compiled     ${built.instructions.length} instruction(s)`);

  if (dryRun) {
    console.log("\n=== DRY RUN COMPLETE ===");
    console.log("Quote, build AND compile all worked. Nothing was spent.");
    return 0;
  }

  console.log("  signing");
  tx.sign([keypair]);
  console.log(`  signed tx    ${tx.serialize().length} bytes`);

  // ---------------------------------------------------------- 4. broadcast
  console.log("\n[4/6] broadcasting via Solami");
  const signature = await sendTransaction(
    Buffer.from(tx.serialize()).toString("base64"),
  );
  console.log(`  signature    ${signature}`);

  // ------------------------------------------------------------ 5. confirm
  console.log("\n[5/6] confirming");
  const confirmation = await confirmSignature(signature);
  if (confirmation.failed) {
    console.error(`  FAILED on chain: ${String(confirmation.err)}`);
    return 1;
  }
  console.log(`  confirmed    ${confirmation.confirmed}`);

  // ------------------------------------------------------------- 6. submit
  console.log("\n[6/6] POST /primaryordersubmit/");
  let submitted: Record<string, unknown> | null = null;
  let submitError: string | null = null;
  try {
    submitted = await submitOrder(built.orderId, signature);
  } catch (error) {
    submitError = error instanceof PantaError ? error.code : String(error);
  }

  let verified: Record<string, unknown> | null = null;
  if (submitted && !submitError) {
    try {
      verified = await verifyOrder(built.orderId, signature);
    } catch {
      /* non-fatal */
    }
  }

  console.log("\n=== BUY COMPLETE ===");
  console.log(`  orderId      ${built.orderId}`);
  console.log(`  signature    ${signature}`);
  console.log(`  submitted    ${JSON.stringify(submitted)?.slice(0, 200) ?? "no"}`);
  if (submitError) console.log(`  submitError  ${submitError}`);
  console.log(`  verified     ${JSON.stringify(verified)?.slice(0, 200) ?? "no"}`);
  console.log("\nNow check the position: it is the last unknown in this integration.");
  console.log(`  GET /positions/?wallet=${wallet}`);
  return submitError ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    if (error instanceof PantaError) {
      console.error(`\nPanta rejected it: ${error.code} (HTTP ${error.status})`);
      console.error(`  ${error.message}`);
      if (error.fields) console.error(`  fields: ${JSON.stringify(error.fields)}`);
      if (error.isStaleSession) console.error("  Session expired -- re-run from the quote.");
      if (isTransientPantaFailure(error)) {
        console.error("  Transient failure; it retries, so run it again.");
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
