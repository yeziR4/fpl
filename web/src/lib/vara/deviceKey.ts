/**
 * A per-browser-profile AES-GCM key, generated once and kept in
 * IndexedDB as `extractable: false`.
 *
 * Why non-extractable matters: a normal "encrypt with a passphrase we
 * also store next to it" scheme is security theater -- anyone who can
 * read localStorage can read both the ciphertext and the key. A
 * non-extractable CryptoKey is different: the browser lets this page's
 * own script *use* it (encrypt/decrypt) but there is no API that can
 * ever hand its raw bytes back out, not even to this page's own code,
 * not even via devtools. That raises the bar specifically against
 * passive inspection (a snooped localStorage dump, a backup that
 * captured browser storage) without pretending to defend against an
 * active XSS on this origin -- XSS can still call encrypt/decrypt
 * itself, same as any client-side scheme. See wallet-cache.ts for what
 * this key actually protects, and its own caveat about what this
 * doesn't cover.
 */

const DB_NAME = "vara-wallet-device";
const STORE_NAME = "keys";
const KEY_ID = "device-aes-key";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadStoredKey(db: IDBDatabase): Promise<CryptoKey | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(KEY_ID);
    req.onsuccess = () => resolve(req.result as CryptoKey | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function saveKey(db: IDBDatabase, key: CryptoKey): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(key, KEY_ID);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

let cached: Promise<CryptoKey> | null = null;

/** Gets this browser profile's device key, generating one on first use. */
export function getDeviceKey(): Promise<CryptoKey> {
  if (!cached) {
    cached = (async () => {
      const db = await openDb();
      const existing = await loadStoredKey(db);
      if (existing) return existing;

      const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
        "encrypt",
        "decrypt",
      ]);
      await saveKey(db, key);
      return key;
    })();
  }
  return cached;
}
