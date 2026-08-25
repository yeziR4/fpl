/**
 * Wallet key generation, purely client-side.
 *
 * This is the entire trust boundary of "on-site wallet creation": every
 * function here runs in the visitor's own browser, using @gear-js/api's
 * GearKeyring (which wraps @polkadot/keyring + @polkadot/util-crypto --
 * the same sr25519 keypair machinery the Polkadot.js browser extension
 * itself uses). Nothing here ever sends a mnemonic, seed, or private key
 * anywhere -- there's no server in this flow to send it to (this is a
 * static export, see docs/architecture.md), and even once a backend
 * exists, this module's contract is that it stays that way.
 *
 * Verified against the real @gear-js/api package (not guessed): its
 * `GearKeyring.create()` already defaults to VARA_SS58_FORMAT (137) and
 * calls the WASM crypto's waitReady() internally, so callers don't have
 * to.
 */

import { GearKeyring } from "@gear-js/api";
import type { KeyringPair } from "@polkadot/keyring/types";
import { isValidMnemonic } from "./mnemonicValidate";

export interface NewWallet {
  keyring: KeyringPair;
  address: string;
  /** The recovery phrase -- the ONLY backup. Never stored, never sent anywhere. */
  mnemonic: string;
}

/**
 * Generates a brand-new keypair. Caller is responsible for getting the
 * mnemonic to the user immediately (see wallet-download.ts) -- this
 * function does not persist anything.
 */
export async function generateWallet(): Promise<NewWallet> {
  const { keyring, mnemonic } = await GearKeyring.create("vara-wallet");
  return { keyring, address: keyring.address, mnemonic };
}

/**
 * Re-derives the same keypair from a previously-generated mnemonic --
 * the "I'm on a new browser / cleared storage, here's my backup" path.
 *
 * Validates the BIP39 checksum first and rejects if it doesn't match.
 * This matters more than it looks: @polkadot/keyring's addFromUri (what
 * GearKeyring.fromMnemonic calls under the hood) does NOT require valid
 * BIP39 input -- it happily derives *some* keypair from any string via
 * a raw-seed fallback. Skipping validation here would mean a fat-
 * fingered or garbled paste silently produces a different, empty
 * wallet instead of an error -- confirmed as a real failure mode while
 * testing this flow, not a hypothetical.
 */
export async function restoreWalletFromMnemonic(mnemonic: string): Promise<NewWallet> {
  const trimmed = mnemonic.trim();
  if (!isValidMnemonic(trimmed)) {
    throw new Error("Invalid mnemonic");
  }
  const keyring = await GearKeyring.fromMnemonic(trimmed, "vara-wallet");
  return { keyring, address: keyring.address, mnemonic: trimmed };
}

export { isValidMnemonic } from "./mnemonicValidate";
