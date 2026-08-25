/**
 * The "browser remembers you" convenience layer -- NOT the backup.
 *
 * The downloaded seed-phrase file (see walletDownload.ts) is the one
 * real backup; this is purely so a returning visitor on the same
 * browser profile doesn't have to paste it back in every time. The
 * mnemonic is encrypted at rest with this device's non-extractable key
 * (deviceKey.ts) before it touches localStorage, but be honest about
 * what that buys: it stops a passive read of localStorage (a backup
 * dump, a curious devtools poke) from yielding usable key material. It
 * does NOT stop an active XSS on this origin, which could just call
 * this module's own decrypt path -- no client-side scheme can defend
 * against that. Standard web security hygiene (sanitize everything
 * rendered, keep dependencies patched, a real CSP) is what actually
 * carries that risk, not this encryption layer.
 */

import { getDeviceKey } from "./deviceKey";

const STORAGE_KEY = "vara-wallet-cache";

interface StoredPayload {
  address: string;
  ivBase64: string;
  ciphertextBase64: string;
}

export interface CachedWallet {
  address: string;
  mnemonic: string;
}

function bufToBase64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function base64ToBuf(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/** Encrypts and caches a wallet's mnemonic for this browser profile. */
export async function cacheWallet(address: string, mnemonic: string): Promise<void> {
  const key = await getDeviceKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(mnemonic),
  );
  const payload: StoredPayload = {
    address,
    ivBase64: bufToBase64(iv.buffer),
    ciphertextBase64: bufToBase64(ciphertext),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

/**
 * Reads back and decrypts the cached wallet, if one exists on this
 * browser profile. Returns null on anything from "never created one"
 * to "storage was cleared" to "device key changed" -- all of these are
 * the same case from the caller's perspective: fall back to asking the
 * user to restore from their downloaded seed phrase.
 */
export async function loadCachedWallet(): Promise<CachedWallet | null> {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;

  try {
    const payload = JSON.parse(raw) as StoredPayload;
    const key = await getDeviceKey();
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBuf(payload.ivBase64) },
      key,
      base64ToBuf(payload.ciphertextBase64),
    );
    return { address: payload.address, mnemonic: new TextDecoder().decode(plaintext) };
  } catch {
    return null;
  }
}

/** Forgets the wallet on this browser profile. Does not touch the chain -- the wallet itself still exists, recoverable from its seed phrase. */
export function clearCachedWallet(): void {
  localStorage.removeItem(STORAGE_KEY);
}
