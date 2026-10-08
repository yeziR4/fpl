/**
 * Generate one Solana wallet per agent model.
 *
 *   cd panta-signer
 *   node dist/scripts/provision-agent-wallets.js
 *   node dist/scripts/provision-agent-wallets.js --dry-run
 *
 * Writes two things:
 *
 *   <wallets>/<slug>.json     the keypair. Mode 0600, OUTSIDE the repo.
 *   ../data/agent_models.json the public addresses. Committed on purpose --
 *                             the board needs them to attribute a trade to a
 *                             model, and a public key is public information.
 *
 * Idempotent and ADOPTIVE: a slug that already has a key on disk keeps it, and
 * only its address is re-read. Regenerating a funded wallet would strand the
 * money in an account nobody holds the key to, so this refuses to do it.
 *
 * The secret key is never printed, logged, or returned. Same discipline as
 * new-operator-wallet.mjs, whose guardrails this reuses: refuse to overwrite,
 * refuse to write inside the git repository, write 0600.
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { Keypair } from "@solana/web3.js";
import {
  DEFAULT_AGENT_MODELS,
  DEFAULT_MODELS_REGISTRY,
  DEFAULT_WALLETS_DIR,
  isInside,
  keyFilenameFor,
  keyPathFor,
  readModelsRegistry,
  walletsDir,
  writeModelsRegistry,
  type AgentModelEntry,
} from "../lib/agent-wallets.js";

/** Rent for a USDC token account plus a few transactions. Not a fee -- a floor. */
const SOL_PER_AGENT = 0.0021;
/** The bankroll each model actually trades with. */
const USDC_PER_AGENT = 5.0;

/**
 * Restrict a key file to its owner. Returns null on success, or a reason.
 *
 * `mode: 0o600` on writeFileSync is a no-op on Windows: the file inherits the
 * directory's ACL instead, and on the machine this was written for that
 * inherited ACL granted read access to a sandbox group -- meaning an agent
 * sandbox could read every private key, which is precisely what this whole file
 * exists to prevent. So on Windows this shells out to icacls.
 *
 * It can fail, and when it does that is reported rather than swallowed: the
 * same sandbox that inherits the read access is also denied the right to change
 * the ACL, so this only actually takes effect when a human runs it.
 */
function hardenPermissions(file: string): string | null {
  if (process.platform !== "win32") {
    try {
      fs.chmodSync(file, 0o600);
      return null;
    } catch (error) {
      return String(error);
    }
  }

  const user = `${process.env.USERDOMAIN}\\${process.env.USERNAME}`;
  try {
    const result = spawnSync(
      "icacls",
      [file, "/inheritance:r", "/grant:r", `${user}:F`],
      { encoding: "utf8" },
    );
    if (result.error) return String(result.error);
    if (result.status !== 0) {
      return (result.stderr || result.stdout || "").trim() || `icacls exited ${result.status}`;
    }
    return null;
  } catch (error) {
    return String(error);
  }
}

function flag(name: string, argv: string[]): string | undefined {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

function usage(): never {
  console.error(`
Generate one Solana wallet per agent model.

    node dist/scripts/provision-agent-wallets.js [--dry-run]
    node dist/scripts/provision-agent-wallets.js --dir=<path> --registry=<path>

    --dry-run     report what would be created or adopted. Writes nothing.

Environment:
    AGENT_KEYPAIRS_DIR   where keypairs live. Default: ${DEFAULT_WALLETS_DIR}

Existing keys are ADOPTED, never regenerated -- regenerating a funded wallet
would strand its balance in an account nobody can sign for. Delete a key file
deliberately if you really mean to replace it, and move its funds first.
`);
  process.exit(2);
}

function main(): number {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) usage();
  const dryRun = argv.includes("--dry-run");

  const dir = flag("dir", argv) ? path.resolve(flag("dir", argv)!) : walletsDir();
  const registryPath = flag("registry", argv)
    ? path.resolve(flag("registry", argv)!)
    : path.resolve(DEFAULT_MODELS_REGISTRY);

  // A hot key inside a working tree is one `git add -A` from being public. The
  // default already sits outside it; this catches an override that does not.
  const repoRoot = path.resolve(import.meta.dirname, "..", "..");
  if (isInside(dir, repoRoot)) {
    console.error(`Refusing to write keypairs inside the git repository: ${dir}`);
    console.error(`Repository root: ${repoRoot}`);
    console.error("Pick a directory outside it, or accept the default.");
    return 1;
  }

  console.log(`\nWallets  : ${dir}`);
  console.log(`Registry : ${registryPath}`);
  console.log(`Mode     : ${dryRun ? "DRY RUN -- nothing written" : "WRITING"}`);

  // Whatever the registry already knows wins on naming, so a model renamed
  // there is not silently re-added under its old default.
  const existing = readModelsRegistry(registryPath);
  const bySlug = new Map(existing.map((e) => [e.slug, e]));

  const entries: AgentModelEntry[] = [];
  const rows: { slug: string; name: string; address: string; action: string }[] = [];
  const permissionProblems: string[] = [];

  for (const model of DEFAULT_AGENT_MODELS) {
    const file = keyPathFor(model.slug, dir);
    const prior = bySlug.get(model.slug);
    const name = prior?.name ?? model.name;

    if (fs.existsSync(file)) {
      // Adopt. Read the public key back from disk rather than trusting the
      // registry, so a hand-edited registry cannot misattribute a wallet.
      const raw = fs.readFileSync(file, "utf8").trim();
      const secret = Uint8Array.from(JSON.parse(raw.replace(/^\uFEFF/, "")) as number[]);
      const address = Keypair.fromSecretKey(secret).publicKey.toBase58();
      const drifted = prior && prior.solana_address && prior.solana_address !== address;
      rows.push({
        slug: model.slug,
        name,
        address,
        action: drifted ? "adopted (registry was WRONG, corrected)" : "adopted",
      });
    } else {
      const keypair = Keypair.generate();
      const address = keypair.publicKey.toBase58();
      if (!dryRun) {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(file, JSON.stringify(Array.from(keypair.secretKey)), { mode: 0o600 });
        const hardened = hardenPermissions(file);
        if (hardened) permissionProblems.push(`${keyFilenameFor(model.slug)}: ${hardened}`);
      }
      rows.push({ slug: model.slug, name, address, action: dryRun ? "would create" : "created" });
    }

    entries.push({ slug: model.slug, name, solana_address: rows[rows.length - 1].address });
  }

  console.log("");
  for (const row of rows) {
    console.log(`  ${row.name.padEnd(22)} ${row.address}  [${row.action}]`);
    console.log(`  ${" ".repeat(22)} ${keyFilenameFor(row.slug)}`);
  }

  if (!dryRun) {
    writeModelsRegistry(entries, registryPath);
    console.log(`\nWrote ${entries.length} addresses to ${registryPath}`);
  }

  const totalUsdc = USDC_PER_AGENT * entries.length;
  const totalSol = SOL_PER_AGENT * entries.length;
  console.log("\nFund each wallet with:");
  console.log(`  ${USDC_PER_AGENT.toFixed(2)} USDC   the bankroll it trades with`);
  console.log(`  ${SOL_PER_AGENT.toFixed(4)} SOL    rent for its USDC account plus transaction fees`);
  console.log(`\n  ${entries.length} wallets: ~${totalUsdc.toFixed(2)} USDC and ~${totalSol.toFixed(4)} SOL in total.`);

  console.log("\nKEEP THIS DIRECTORY UNTIL THE MARKETS RESOLVE AND PAY OUT.");
  console.log("A winning position is claimable only by the wallet that holds it, so");
  console.log("deleting a key before settlement makes its winnings unrecoverable.");

  console.log("\nNo secret key was printed; none exists anywhere but those files.");

  if (permissionProblems.length > 0) {
    console.log("\nCOULD NOT RESTRICT FILE PERMISSIONS:");
    for (const problem of permissionProblems) console.log(`  ${problem}`);
    console.log("\nThese key files inherit their directory's ACL, so other accounts on");
    console.log("this machine may be able to read them. Node's mode 0o600 is a no-op");
    console.log("on Windows, and changing an ACL needs rights a sandbox is usually");
    console.log("denied -- so run this from a normal shell and it will apply:");
    console.log(`\n  icacls "${dir}\\*.json" /inheritance:r /grant:r "%USERDOMAIN%\\%USERNAME%:F"`);
  }
  return 0;
}

process.exit(main());
