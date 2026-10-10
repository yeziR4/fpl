/**
 * Fund the human wallets from the operator wallet.
 *
 *   cd panta-signer
 *   node dist/scripts/fund-human-wallets.js --check
 *   node dist/scripts/fund-human-wallets.js --send
 *
 *     --sol=<amount>    SOL to top each wallet up to. Default 0.005
 *     --usdc=<amount>   USDC to top each wallet up to. Default 3.06
 *     --handle=<@x>     only this participant. Repeatable in spirit, one at a time.
 *
 * Modeled deliberately closely on fund-agents.ts, including the parts that were
 * learned the hard way:
 *
 *   - It tops UP TO a target rather than sending a fixed amount, so re-running
 *     after a partial failure does not double-fund anyone.
 *   - It reports the operator's balance against what it is about to send BEFORE
 *     sending, because Solana transactions are atomic per wallet and a run that
 *     dies halfway leaves some people funded and others not.
 *   - It creates the USDC token account idempotently, so it is safe whether or
 *     not the sender that deposited already made one.
 *
 * These wallets are not ours. See provision-human-wallets.ts -- the money in
 * them becomes a named person's the moment the market resolves, so every
 * mistake here is a mistake against somebody who did us a favour.
 */

import fs from "node:fs";
import path from "node:path";
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
import { OperatorWalletError, loadOperatorKeypair, signVersionedTransaction } from "../lib/operator-wallet.js";
import { SolamiError, confirmSignature, getLatestBlockhash, sendTransaction, solamiRpc } from "../lib/solami.js";

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

const DEFAULT_SOL = 0.005;
const DEFAULT_USDC = 3.06;

const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const USDC_DECIMALS = 6;
const LAMPORTS_PER_SOL = 1_000_000_000;

interface Participant {
  handle: string;
  displayName?: string;
  wallet?: string | null;
}

function flag(name: string, argv: string[]): string | undefined {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

function usage(): never {
  console.error(`
Fund the human wallets from the operator wallet.

    node dist/scripts/fund-human-wallets.js --check    report only
    node dist/scripts/fund-human-wallets.js --send     actually move the money

    --sol=<amount>     SOL target per wallet.  Default ${DEFAULT_SOL}
    --usdc=<amount>    USDC target per wallet. Default ${DEFAULT_USDC}
    --handle=<@x>      only this participant

Environment:
    SOLANA_KEYPAIR_PATH  the operator keypair. It pays.
`);
  process.exit(2);
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) usage();

  const check = argv.includes("--check");
  const send = argv.includes("--send");
  if (check === send) {
    console.error("Pass exactly one of --check or --send.");
    return 2;
  }

  const solTarget = Number(flag("sol", argv) ?? DEFAULT_SOL);
  const usdcTarget = Number(flag("usdc", argv) ?? DEFAULT_USDC);
  const onlyHandle = flag("handle", argv);

  if (!Number.isFinite(solTarget) || solTarget <= 0) return 2;
  if (!Number.isFinite(usdcTarget) || usdcTarget < 0) return 2;

  let keypair;
  try {
    keypair = loadOperatorKeypair();
  } catch (error) {
    if (error instanceof OperatorWalletError) {
      console.error(error.message);
      return 1;
    }
    throw error;
  }
  const operator = keypair.publicKey;

  const picks = JSON.parse(fs.readFileSync(HUMAN_PICKS, "utf8")) as { participants?: Participant[] };
  const targets = (picks.participants ?? []).filter(
    (p) => p.wallet && (!onlyHandle || p.handle === onlyHandle),
  );

  if (targets.length === 0) {
    console.error("No human participants with a wallet. Run provision-human-wallets first.");
    return 1;
  }

  console.log(`\nOperator : ${operator.toBase58()}`);
  console.log(`Target   : ${solTarget} SOL and ${usdcTarget.toFixed(2)} USDC per wallet`);
  console.log(`Mode     : ${check ? "CHECK -- nothing sent" : "SENDING"}`);

  const operatorAta = getAssociatedTokenAddressSync(USDC_MINT, operator);
  await solamiRpc("getBalance", [operator.toBase58()]);

  interface State {
    p: Participant;
    address: string;
    ata: PublicKey;
    sol: number;
    usdc: number;
    solShort: number;
    usdcShort: number;
  }
  const states: State[] = [];

  for (const p of targets) {
    const owner = new PublicKey(p.wallet!);
    const ata = getAssociatedTokenAddressSync(USDC_MINT, owner);
    const bal = await solamiRpc<{ value: number }>("getBalance", [p.wallet!]);
    const sol = (bal?.value ?? 0) / LAMPORTS_PER_SOL;

    let usdc = 0;
    try {
      const t = await solamiRpc<{ value: { uiAmountString: string | null } }>(
        "getTokenAccountBalance",
        [ata.toBase58()],
      );
      usdc = Number(t?.value?.uiAmountString ?? 0);
    } catch {
      // Missing token account is a normal state, not an error.
    }

    states.push({
      p,
      address: p.wallet!,
      ata,
      sol,
      usdc,
      solShort: Math.max(0, solTarget - sol),
      usdcShort: Math.max(0, usdcTarget - usdc),
    });
  }

  console.log("");
  console.log(`  ${"participant".padEnd(22)}${"SOL".padStart(11)}${"USDC".padStart(10)}  needs`);
  console.log("  " + "-".repeat(62));
  for (const s of states) {
    const needs: string[] = [];
    if (s.solShort > 0) needs.push(`+${s.solShort.toFixed(6)} SOL`);
    if (s.usdcShort > 0) needs.push(`+${s.usdcShort.toFixed(2)} USDC`);
    console.log(
      `  ${(s.p.displayName || s.p.handle).slice(0, 20).padEnd(22)}` +
        `${s.sol.toFixed(6).padStart(11)}${s.usdc.toFixed(2).padStart(10)}  ` +
        (needs.length ? needs.join(", ") : "nothing"),
    );
  }

  const totalSol = states.reduce((a, s) => a + s.solShort, 0);
  const totalUsdc = states.reduce((a, s) => a + s.usdcShort, 0);
  console.log("  " + "-".repeat(62));
  console.log(`  ${"total to send".padEnd(22)}${totalSol.toFixed(6).padStart(11)}${totalUsdc.toFixed(2).padStart(10)}`);

  const opBal = await solamiRpc<{ value: number }>("getBalance", [operator.toBase58()]);
  const opSol = (opBal?.value ?? 0) / LAMPORTS_PER_SOL;
  let opUsdc = 0;
  try {
    const t = await solamiRpc<{ value: { uiAmountString: string | null } }>(
      "getTokenAccountBalance",
      [operatorAta.toBase58()],
    );
    opUsdc = Number(t?.value?.uiAmountString ?? 0);
  } catch {
    // no operator ATA: it simply holds no USDC
  }

  console.log(`\n  operator holds ${opUsdc.toFixed(2)} USDC and ${opSol.toFixed(6)} SOL.`);
  // A hair of headroom for the transfer fees themselves, so a run that exactly
  // spends the balance does not fail on the last wallet.
  if (opSol < totalSol + 0.0001 || opUsdc < totalUsdc) {
    console.error("\nThe operator cannot cover this.");
    if (totalSol + 0.0001 > opSol) console.error(`  short ${(totalSol + 0.0001 - opSol).toFixed(6)} SOL`);
    if (totalUsdc > opUsdc) console.error(`  short ${(totalUsdc - opUsdc).toFixed(2)} USDC`);
    return 1;
  }

  if (check) {
    console.log("\nCHECK complete. Nothing was sent. Re-run with --send to fund.");
    return 0;
  }

  console.log("");
  let failures = 0;
  for (const s of states) {
    if (s.solShort === 0 && s.usdcShort === 0) {
      console.log(`  ${s.address}  already funded, skipped`);
      continue;
    }

    const instructions = [];
    if (s.solShort > 0) {
      instructions.push(
        SystemProgram.transfer({
          fromPubkey: operator,
          toPubkey: new PublicKey(s.address),
          lamports: Math.round(s.solShort * LAMPORTS_PER_SOL),
        }),
      );
    }
    instructions.push(
      createAssociatedTokenAccountIdempotentInstruction(operator, s.ata, new PublicKey(s.address), USDC_MINT),
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
      // Signed through the operator-wallet helper rather than tx.sign(), so
      // every path that spends the operator's key goes through one place.
      const signed = signVersionedTransaction(
        Buffer.from(tx.serialize()).toString("base64"),
        keypair,
      );
      const signature = await sendTransaction(signed);
      console.log(
        `  ${s.p.handle.padEnd(18)} sent ${s.solShort.toFixed(6)} SOL, ${s.usdcShort.toFixed(2)} USDC  ${signature.slice(0, 12)}...`,
      );
      await confirmSignature(signature).catch(() => undefined);
    } catch (error) {
      failures += 1;
      const detail = error instanceof SolamiError ? error.message : String(error);
      console.error(`  ${s.p.handle.padEnd(18)} FAILED  ${detail}`);
    }
  }

  console.log(
    failures === 0
      ? "\nAll human wallets funded."
      : `\n${failures} wallet(s) failed. Re-run --check, then --send; it tops up to the target rather than adding on top.`,
  );
  return failures === 0 ? 0 : 1;
}

process.exit(await main());
