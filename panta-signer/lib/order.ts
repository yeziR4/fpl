/**
 * Place one primary order on Panta. The whole flow, in one place.
 *
 * Extracted from scripts/buy.ts so the agent trader and the manual buy CLI run
 * the identical path. Two implementations of "sign and broadcast an order"
 * is how one of them ends up subtly wrong -- and this one moves real money for
 * five different wallets.
 *
 * The buy flow is NOT the create flow, and the difference is what this file
 * chiefly exists to get right: market creation returns an assembled
 * VersionedTransaction, while a primary buy returns bare *instructions* the
 * client has to compile itself.
 *
 * Who signs is the caller's business. The operator signs its own buys; an agent
 * model signs with its own keypair, because that is the whole reason each model
 * has a separate wallet -- so its P&L is a fact about the chain rather than a
 * row in our ledger.
 */

import {
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { buildOrder, quoteOrder, submitOrder, verifyOrder } from "./panta.js";
import { confirmSignature, sendTransaction } from "./solami.js";

/** Panta returns instructions in this shape; @solana/web3.js wants its own. */
interface RawInstruction {
  programId: string;
  data: string;
  accounts?: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
}

export function toInstruction(raw: unknown): TransactionInstruction {
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

export interface OrderFill {
  marketId: string;
  side: "yes" | "no";
  /** What we asked to spend. */
  requestedUsdc: number;
  /** What the quote said we would get. Null when Panta did not say. */
  shares: string | null;
  avgPrice: string | null;
  feeUsdc: string | null;
  orderId: string;
  signature: string;
  /** Panta's own verdict from /primaryorderverify/. */
  status: string;
}

export interface PlaceOrderOptions {
  marketId: string;
  side: "yes" | "no";
  amountUsdc: number;
  keypair: Keypair;
  /** Progress, for a CLI. Never receives anything secret. */
  log?: (message: string) => void;
  /** Build and compile, then stop before signing. Proves the shape for free. */
  dryRun?: boolean;
}

/**
 * Quote, build, compile, sign, broadcast, confirm, submit, verify.
 *
 * Returns the fill. Throws rather than returning a partial success: a caller
 * that has to distinguish "submitted but unverified" from "done" is a caller
 * that will eventually get it wrong, and these are real positions.
 */
export async function placePrimaryOrder(options: PlaceOrderOptions): Promise<OrderFill> {
  const { marketId, side, amountUsdc, keypair, dryRun = false } = options;
  const log = options.log ?? (() => {});
  const wallet = keypair.publicKey.toBase58();

  if (amountUsdc < 0.1) {
    throw new Error(`${amountUsdc} USDC is below Panta's 0.10 minimum order size`);
  }

  log(`quote ${marketId} ${side} ${amountUsdc.toFixed(2)} USDC`);
  const quote = await quoteOrder({
    marketId,
    side,
    amountUsdc: amountUsdc.toFixed(2),
    wallet,
  });
  if (!quote.quoteId) throw new Error(`no quoteId: ${JSON.stringify(quote)}`);

  const built = await buildOrder({ quoteId: quote.quoteId, wallet });
  if (!built.orderId || !Array.isArray(built.instructions)) {
    throw new Error(`unusable build: ${JSON.stringify(built).slice(0, 400)}`);
  }

  // Compiled BEFORE the dry-run exit, on purpose: compiling Panta's bare
  // instructions is the step most likely to be wrong, so a dry run that skipped
  // it would not be testing the risky part.
  const message = new TransactionMessage({
    payerKey: keypair.publicKey,
    recentBlockhash: built.recentBlockhash,
    instructions: built.instructions.map(toInstruction),
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);

  if (dryRun) {
    log(`would sign ${tx.serialize().length} bytes (${built.instructions.length} instructions)`);
    return {
      marketId,
      side,
      requestedUsdc: amountUsdc,
      shares: (quote.shares as string) ?? null,
      avgPrice: (quote.avgPrice as string) ?? null,
      feeUsdc: (quote.feeUsdc as string) ?? null,
      orderId: built.orderId,
      signature: "(dry run)",
      status: "dry_run",
    };
  }

  tx.sign([keypair]);
  const signature = await sendTransaction(Buffer.from(tx.serialize()).toString("base64"));

  const confirmation = await confirmSignature(signature);
  if (confirmation.failed) {
    throw new Error(`transaction failed on chain: ${String(confirmation.err)} (${signature})`);
  }
  if (!confirmation.confirmed) {
    throw new Error(
      `transaction not confirmed within the timeout: ${signature}. ` +
        "It may still land; check the signature before retrying.",
    );
  }

  const submitted = await submitOrder(built.orderId, signature);
  const verified = await verifyOrder(built.orderId, signature);

  return {
    marketId,
    side,
    requestedUsdc: amountUsdc,
    shares: (quote.shares as string) ?? null,
    avgPrice: (quote.avgPrice as string) ?? null,
    feeUsdc: (quote.feeUsdc as string) ?? null,
    orderId: built.orderId,
    signature,
    status: String((verified as Record<string, unknown>)?.status ?? (submitted as Record<string, unknown>)?.status ?? "submitted"),
  };
}
