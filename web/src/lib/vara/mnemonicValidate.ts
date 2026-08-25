/**
 * Just the BIP39 checksum check, imported directly from
 * @polkadot/util-crypto rather than through keyring.ts's `@gear-js/api`
 * import. Kept as its own tiny module deliberately: this is the one
 * piece of wallet logic needed synchronously on every keystroke (the
 * Restore modal's live "does this look valid yet" feedback), while
 * everything else in this directory is heavy enough to load lazily
 * (see WalletProvider.tsx's dynamic imports) -- @gear-js/api's barrel
 * export pulls in @polkadot/api's full RPC/metadata client alongside
 * GearKeyring, so importing through it here would undo that split.
 */
import { mnemonicValidate } from "@polkadot/util-crypto";

export function isValidMnemonic(mnemonic: string): boolean {
  return mnemonicValidate(mnemonic.trim());
}
