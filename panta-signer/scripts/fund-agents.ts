/**
 * Fund the agent wallets from the operator wallet.
 *
 *   node dist/scripts/fund-agents.js --check     report only, sends nothing
 *   node dist/scripts/fund-agents.js --send      actually move the money
 *
 * There is no default. One of those two spends real USDC, and it should be
 * typed on purpose -- the same rule create-market.ts follows.
 *
 * Why this exists rather than six manual transfers: five agents each need USDC
 * AND SOL, which is ten transfers from a wallet UI and ten chances to paste the
 * wrong address. This builds one transaction per agent containing all three
 * things it needs, atomically:
 *
 *   - a little SOL, so it can pay transaction fees later
 *   - its USDC token account, created and paid for by the operator
 *   - its bankroll, transferred into that account
 *
 * All-or-nothing per agent: if the bankroll transfer fails, the SOL does not
 * land either, so a partial funding cannot leave an agent that looks funded and
 * cannot trade.
 *
 * Deliberately NOT hidden behind the trading path. Money leaving one wallet for
 * another is worth seeing on its own, with the amounts printed before anything
 * is signed.
 */

import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  DEFAULT_MODELS_REGISTRY,
  readModelsRegistry,
  type AgentModelEntry,
} from "../lib/agent-wallets.js";
import { OperatorWalletError, loadOperatorKeypair, signVersionedTransaction } from "../lib/operator-wallet.js";
import { SolamiError, confirmSignature, getLatestBlockhash, sendTransaction, solamiRpc } from "../lib/solami.js";

/** Each model's trading bankroll, in USDC. */
const AGENT_USDC = 5.0;

/**
 * How much SOL each agent is topped up to.
 *
 * WAS 0.0021, and that was WRONG -- it covered a USDC token account and nothing
 * else. The first live trade run failed every one of ten orders with
 * "Transaction results in an account (0) with insufficient funds for rent",
 * where account 0 is the fee payer, i.e. the agent: a primary buy creates its own
 * accounts on top of the token account the agent already had, and 0.0021 does
 * not cover them.
 *
 * Sized generously now. Solana rent is refundable when an account is closed, so
 * an over-funded agent costs nothing but a temporarily larger float, whereas an
 * under-funded one fails at broadcast with real money already committed
 * elsewhere.
 *
 * Overridable with --sol=<amount> while establishing the real floor.
 */
const AGENT_SOL = 0.012;

const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const USDC_DECIMALS = 6;
const LAMPORTS_PER_SOL = 1_000_000_000;

function usage(): never {
  console.error(`
Fund the agent wallets from the operator wallet.

    node dist/scripts/fund-agents.js --check    report only. Sends nothing.
    node dist/scripts/fund-agents.js --send     actually move the money.

    --registry=<path>   agent registry. Default: ${DEFAULT_MODELS_REGISTRY}

Environment:
    SOLANA_KEYPAIR_PATH  the operator keypair. It pays.
    AGENT_KEYPAIRS_DIR   unused here; the agent addresses come from the registry.
    SOLAMI_RPC_URL / SOLAMI_API_KEY / SOLANA_RPC_FALLBACK_URL  as elsewhere.

Each agent is topped up TO $${AGENT_USDC.toFixed(2)} and ${AGENT_SOL} SOL, not BY that
much, so running this twice is harmless rather than doubling the bankroll.
`);
  process.exit(2);
}

interface AgentState {
  entry: AgentModelEntry;
  sol: number;
  usdc: number;
  ata: PublicKey;
  ataExists: boolean;
  solShort: number;
  usdcShort: number;
}

async function readAgent(
  entry: AgentModelEntry,
  solTarget: number,
  usdcTarget: number,
): Promise<AgentState> {
  const owner = new PublicKey(entry.solana_address);
  const ata = getAssociatedTokenAddressSync(USDC_MINT, owner);

  const balance = await solamiRpc<{ value: number }>("getBalance", [entry.solana_address]);
  const sol = (balance?.value ?? 0) / LAMPORTS_PER_SOL;

  let usdc = 0;
  let ataExists = false;
  try {
    const account = await solamiRpc<{ value: { data: unknown } } | null>("getAccountInfo", [
      ata.toBase58(),
      { encoding: "base64" },
    ]);
    ataExists = account !== null && account !== undefined;
    if (ataExists) {
      const token = await solamiRpc<{ value: { uiAmountString: string | null } }>(
        "getTokenAccountBalance",
        [ata.toBase58()],
      );
      usdc = Number(token?.value?.uiAmountString ?? 0);
    }
  } catch {
    // A missing token account is a normal state, not an error.
    ataExists = false;
  }

  return {
    entry,
    sol,
    usdc,
    ata,
    ataExists,
    solShort: Math.max(0, solTarget - sol),
    usdcShort: Math.max(0, usdcTarget - usdc),
  };
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const check = argv.includes("--check");
  const send = argv.includes("--send");
  if (check === send) usage();

  const registryFlag = argv.find((a) => a.startsWith("--registry="));
  const registryPath = registryFlag
    ? registryFlag.slice("--registry=".length)
    : DEFAULT_MODELS_REGISTRY;

  // Overrides, added while establishing the real SOL floor for a trade. The
  // operator can be short, and funding ONE agent is how you find the floor
  // without committing five times over to a number that turns out wrong.
  const solFlag = argv.find((a) => a.startsWith("--sol="));
  const solTarget = solFlag ? Number(solFlag.slice("--sol=".length)) : AGENT_SOL;
  if (!Number.isFinite(solTarget) || solTarget <= 0) {
    console.error(`--sol=${solFlag ?? ""} is not a positive number`);
    return 2;
  }
  // The USDC target is overridable for the same reason, and it earned its place
  // immediately: an agent that allocated its whole bankroll could not place its
  // LAST pick, because the ~2% trading fee pushed the total past what it held.
  // The fee is a cost WE impose, not a decision the model made, so topping that
  // agent back up to exactly its next stake is the right correction rather than
  // leaving a hole in the data.
  const usdcFlag = argv.find((a) => a.startsWith("--usdc="));
  const usdcTarget = usdcFlag ? Number(usdcFlag.slice("--usdc=".length)) : AGENT_USDC;
  if (!Number.isFinite(usdcTarget) || usdcTarget <= 0) {
    console.error(`--usdc=${usdcFlag ?? ""} is not a positive number`);
    return 2;
  }
  // Comma-separated, because topping up only the agents that still have orders
  // to place is the difference between fitting inside the operator's balance
  // and not. An agent with nothing left to trade should not be funded.
  const onlyFlag = argv.find((a) => a.startsWith("--only="));
  const only = onlyFlag
    ? onlyFlag
        .slice("--only=".length)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const onlyLabel = only.length ? `--only=${only.join(",")}` : null;

  const entries = readModelsRegistry(registryPath).filter(
    (e) =>
      only.length === 0 ||
      only.some((o) => e.name.toLowerCase().includes(o.toLowerCase()) || e.slug.includes(o)),
  );
  if (entries.length === 0) {
    console.error(`No agents matched in ${registryPath}${onlyLabel ? ` (${onlyLabel})` : ""}.`);
    return 1;
  }

  const keypair = loadOperatorKeypair();
  const operator = keypair.publicKey;
  const operatorAta = getAssociatedTokenAddressSync(USDC_MINT, operator);

  console.log(`\nFrom   : ${operator.toBase58()}  (operator)`);
  console.log(`Agents : ${entries.length} from ${registryPath}${onlyLabel ? ` (${onlyLabel})` : ""}`);
  console.log(`Target : ${AGENT_USDC.toFixed(2)} USDC and ${solTarget.toFixed(6)} SOL each`);
  console.log(`Mode   : ${check ? "CHECK -- nothing will be sent" : "SEND -- this moves USDC and SOL"}\n`);

  // Read every agent first, so the whole picture is on screen before anything
  // is signed. Funding agent 1 and only then discovering agent 4 is short would
  // be the wrong order to find things out in.
  const states: AgentState[] = [];
  for (const entry of entries) {
    states.push(await readAgent(entry, solTarget, usdcTarget));
  }

  console.log(
    `${"agent".padEnd(22)} ${"SOL".padStart(10)} ${"USDC".padStart(8)}  ${"needs".padEnd(22)}`,
  );
  console.log("-".repeat(78));
  for (const s of states) {
    const needs: string[] = [];
    if (s.solShort > 0) needs.push(`+${s.solShort.toFixed(6)} SOL`);
    if (s.usdcShort > 0) needs.push(`+${s.usdcShort.toFixed(2)} USDC`);
    if (!s.ataExists) needs.push("create account");
    console.log(
      `${s.entry.name.padEnd(22)} ${s.sol.toFixed(6).padStart(10)} ${s.usdc.toFixed(2).padStart(8)}  ${(needs.join(", ") || "nothing").padEnd(22)}`,
    );
  }

  const totalUsdc = states.reduce((sum, s) => sum + s.usdcShort, 0);
  const totalSol = states.reduce((sum, s) => sum + s.solShort, 0);
  console.log("-".repeat(78));
  console.log(`Total to send: ${totalUsdc.toFixed(2)} USDC and ${totalSol.toFixed(6)} SOL`);

  if (totalUsdc === 0 && totalSol === 0) {
    console.log("\nEvery agent is already funded. Nothing to do.");
    return 0;
  }

  // The operator has to cover the transfers out of its own balance. Checking
  // this before signing turns "transaction failed on chain" into a sentence.
  const operatorBalance = await solamiRpc<{ value: number }>("getBalance", [operator.toBase58()]);
  const operatorSol = (operatorBalance?.value ?? 0) / LAMPORTS_PER_SOL;
  const operatorToken = await solamiRpc<{ value: { uiAmountString: string | null } }>(
    "getTokenAccountBalance",
    [operatorAta.toBase58()],
  ).catch(() => null);
  const operatorUsdc = Number(operatorToken?.value?.uiAmountString ?? 0);

  console.log(`\nOperator holds ${operatorUsdc.toFixed(2)} USDC and ${operatorSol.toFixed(6)} SOL.`);
  const shortSol = totalSol + 0.001 - operatorSol; // a little slack for fees
  const shortUsdc = totalUsdc - operatorUsdc;
  if (shortUsdc > 0 || shortSol > 0) {
    console.error("\nThe operator cannot cover this.");
    if (shortUsdc > 0) console.error(`  short ${shortUsdc.toFixed(2)} USDC`);
    if (shortSol > 0) console.error(`  short ${shortSol.toFixed(6)} SOL`);
    console.error("\nFund the operator, then re-run.");
    return 1;
  }

  if (check) {
    console.log("\nCHECK complete. Nothing was sent. Re-run with --send to fund.");
    return 0;
  }

  console.log("");
  let failures = 0;
  for (const s of states) {
    if (s.solShort === 0 && s.usdcShort === 0 && s.ataExists) {
      console.log(`  ${s.entry.name.padEnd(22)} already funded, skipped`);
      continue;
    }

    const instructions = [];
    if (s.solShort > 0) {
      instructions.push(
        SystemProgram.transfer({
          fromPubkey: operator,
          toPubkey: new PublicKey(s.entry.solana_address),
          lamports: Math.round(s.solShort * LAMPORTS_PER_SOL),
        }),
      );
    }
    instructions.push(
      createAssociatedTokenAccountIdempotentInstruction(operator, s.ata, new PublicKey(s.entry.solana_address), USDC_MINT),
    );
    if (s.usdcShort > 0) {
      instructions.push(
        createTransferCheckedInstruction(
          operatorAta,
          USDC_MINT,
          s.ata,
          operator,
          BigInt(Math.round(s.usdcShort * 10 ** USDC_DECIMALS)),
          USDC_DECIMALS,
        ),
      );
    }

    try {
      const { value } = await getLatestBlockhash();
      const message = new TransactionMessage({
        payerKey: operator,
        recentBlockhash: value.blockhash,
        instructions,
      }).compileToV0Message();
      const tx = new VersionedTransaction(message);
      tx.sign([keypair]);

      const signature = await sendTransaction(Buffer.from(tx.serialize()).toString("base64"));
      const confirmation = await confirmSignature(signature);
      if (confirmation.failed) {
        console.error(`  ${s.entry.name.padEnd(22)} FAILED on chain: ${String(confirmation.err)}`);
        failures += 1;
        continue;
      }
      console.log(
        `  ${s.entry.name.padEnd(22)} sent ${s.usdcShort.toFixed(2)} USDC + ${s.solShort.toFixed(6)} SOL`,
      );
      console.log(`  ${" ".repeat(22)} ${signature}`);
    } catch (error) {
      console.error(
        `  ${s.entry.name.padEnd(22)} FAILED: ${error instanceof Error ? error.message : String(error)}`,
      );
      failures += 1;
    }
  }

  console.log(failures === 0 ? "\nAll agents funded." : `\n${failures} agent(s) failed. Re-run to retry just those.`);
  console.log("This script tops up TO the target, so re-running is safe.");
  return failures === 0 ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    if (error instanceof SolamiError) console.error(`\nSolami: ${error.message}`);
    else if (error instanceof OperatorWalletError) console.error(`\nOperator wallet: ${error.message}`);
    else console.error(`\n${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    process.exit(1);
  });
