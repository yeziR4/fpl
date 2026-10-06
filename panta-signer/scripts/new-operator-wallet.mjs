/**
 * Generate the operator wallet that signs market-creation transactions.
 *
 * RUN THIS YOURSELF. That is the entire point of it existing as a separate
 * script: the private key is then generated on your machine and never appears
 * in an agent transcript, a tool call, or anybody's sandbox.
 *
 *   cd panta-signer
 *   node scripts/new-operator-wallet.mjs "C:\Users\yezir\operator.json"
 *
 * Then point the tooling at it:
 *
 *   $env:SOLANA_KEYPAIR_PATH = "C:\Users\yezir\operator.json"     # PowerShell
 *   set SOLANA_KEYPAIR_PATH=C:\Users\yezir\operator.json          # cmd
 *
 * Notes:
 *   - Keep the file OUTSIDE this git repository. It is a hot key.
 *   - This wallet pays creation fees AND accrues creator royalties, so it can
 *     hold real value later. Treat it as a float, not a treasury: move anything
 *     meaningful to a wallet you hold properly.
 *   - The format written is the solana-keygen id.json array, which
 *     lib/operator-wallet.ts reads directly. A Phantom base58 export works too
 *     via SOLANA_KEYPAIR_B58.
 *   - An earlier key was generated inside an agent session using a script whose
 *     own header said "throwaway, never for real funds". This file exists so
 *     that mistake has a proper replacement.
 */

import fs from "node:fs";
import path from "node:path";
import { Keypair } from "@solana/web3.js";

const out = process.argv[2];
if (!out) {
  console.error('usage: node scripts/new-operator-wallet.mjs "<path/operator.json>"');
  process.exit(2);
}

const resolved = path.resolve(out);

// Refuse to clobber. Losing a funded key to a rerun would be unforgivable.
if (fs.existsSync(resolved)) {
  console.error(`Refusing to overwrite an existing file: ${resolved}`);
  console.error("Delete it deliberately if you really mean to replace it.");
  process.exit(1);
}

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
if (resolved.startsWith(repoRoot)) {
  console.error(`Refusing to write inside the git repository: ${resolved}`);
  console.error("A hot key in a repo is one `git add -A` from being public.");
  process.exit(1);
}

const keypair = Keypair.generate();
fs.writeFileSync(resolved, JSON.stringify(Array.from(keypair.secretKey)), { mode: 0o600 });

console.log("");
console.log("Operator address:");
console.log("  " + keypair.publicKey.toBase58());
console.log("");
console.log("Keypair written to:");
console.log("  " + resolved);
console.log("");
console.log("Fund it with:");
console.log("  ~21 USDC on Solana (SPL)   the 20 USDC creation fee, non-refundable");
console.log("  ~0.02 SOL                  gas plus rent for the accounts the create opens");
console.log("");
console.log("Confirm it landed: https://solscan.io/account/" + keypair.publicKey.toBase58());
console.log("");
console.log("The secret was NOT printed and exists only in that file.");
