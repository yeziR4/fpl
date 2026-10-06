/**
 * The wallet that signs market-creation transactions.
 *
 * This is NOT a user's wallet. A user signs their own primary buys in the
 * browser and we never see their key -- that is the whole point of Panta's
 * custody model. But markets are created by us, on a schedule, from a
 * generator, so the operator key has to live server-side. Treat it as a float,
 * not a treasury: it only ever needs to cover creation fees ($20 breaking,
 * $50 standard) plus gas.
 *
 * Accepted, in order:
 *   SOLANA_KEYPAIR_JSON  -- the JSON array solana-keygen writes to id.json
 *   SOLANA_KEYPAIR_B58   -- a base58 secret key, as Phantom exports it
 *   SOLANA_KEYPAIR_PATH  -- a path to a file holding either of the above
 *
 * The secret is read, used, and never logged. Only the public address is.
 */

import fs from "node:fs";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";

export class OperatorWalletError extends Error {}

function fromJsonArray(raw: string): Keypair | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((n) => typeof n === "number")) {
      return Keypair.fromSecretKey(Uint8Array.from(parsed as number[]));
    }
  } catch {
    // Not JSON. Try the other format.
  }
  return null;
}

function fromBase58(raw: string): Keypair | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return Keypair.fromSecretKey(bs58.decode(trimmed));
  } catch {
    return null;
  }
}

export function loadOperatorKeypair(): Keypair {
  const inline = process.env.SOLANA_KEYPAIR_JSON;
  if (inline) {
    const keypair = fromJsonArray(inline) ?? fromBase58(inline);
    if (keypair) return keypair;
    throw new OperatorWalletError(
      "SOLANA_KEYPAIR_JSON is neither a JSON array nor a base58 secret key.",
    );
  }

  const encoded = process.env.SOLANA_KEYPAIR_B58;
  if (encoded) {
    const keypair = fromBase58(encoded);
    if (keypair) return keypair;
    throw new OperatorWalletError("SOLANA_KEYPAIR_B58 is not a decodable base58 secret key.");
  }

  const filePath = process.env.SOLANA_KEYPAIR_PATH;
  if (filePath) {
    if (!fs.existsSync(filePath)) {
      throw new OperatorWalletError(`SOLANA_KEYPAIR_PATH does not exist: ${filePath}`);
    }
    const raw = fs.readFileSync(filePath, "utf8");
    const keypair = fromJsonArray(raw) ?? fromBase58(raw);
    if (keypair) return keypair;
    throw new OperatorWalletError(`${filePath} is neither a JSON array nor a base58 secret key.`);
  }

  throw new OperatorWalletError(
    "No operator keypair configured. Set SOLANA_KEYPAIR_PATH (a solana-keygen id.json), " +
      "SOLANA_KEYPAIR_JSON, or SOLANA_KEYPAIR_B58.",
  );
}

/**
 * Sign a base64 VersionedTransaction and return the signed base64.
 *
 * Panta hands us an unsigned transaction, we sign it here, and Solami
 * broadcasts the result. That split is intentional: the key never leaves this
 * process, and the broadcast stays a separate, observable step.
 */
export function signVersionedTransaction(base64Tx: string, keypair: Keypair): string {
  const tx = VersionedTransaction.deserialize(Buffer.from(base64Tx, "base64"));
  tx.sign([keypair]);
  return Buffer.from(tx.serialize()).toString("base64");
}
