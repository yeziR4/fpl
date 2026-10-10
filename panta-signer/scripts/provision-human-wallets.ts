/**
 * Generate one Solana wallet per human call we are placing on their behalf.
 *
 *   cd panta-signer
 *   node dist/scripts/provision-human-wallets.js --gw=6
 *   node dist/scripts/provision-human-wallets.js --gw=6 --dry-run
 *
 * Writes two things:
 *
 *   ../.human-wallets/<handle>.json   the keypair. Mode 0600, OUTSIDE the repo.
 *   ../data/human_picks.json          the PUBLIC address, written back onto the
 *                                     participant. Committed on purpose: the board
 *                                     needs it to attribute a position, and a
 *                                     public key is public information.
 *
 * ---------------------------------------------------------------------------
 * THE DIFFERENCE FROM provision-agent-wallets, and it is not a small one.
 *
 * An agent's wallet holds the agent's bankroll. If the key is lost, we lose our
 * own money and the experiment is dented.
 *
 * These wallets hold money that becomes SOMEONE ELSE'S the moment the market
 * resolves. We are the custodian of a payout that a named person is owed. Losing
 * a key does not cost us a position -- it costs a stranger their winnings, and
 * they have no way to recover it and no way to even prove we had it except the
 * address published on our own page.
 *
 * So: never delete this directory before settlement. Never regenerate a key
 * that already exists. And pay out when it resolves, because the alternative is
 * taking money from people who did us a favour by replying to a post.
 * ---------------------------------------------------------------------------
 *
 * Idempotent and ADOPTIVE, reusing provision-agent-wallets' guardrails: refuse
 * to overwrite, refuse to write inside the git repository, refuse to print a
 * secret, harden the ACL on Windows where mode 0600 is a no-op.
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { Keypair } from "@solana/web3.js";

const HERE = import.meta.dirname;

/**
 * Locate the project root by looking for a file we know lives in it.
 *
 * Counting `..` is what broke this the first time: the script runs from
 * dist/scripts, so two levels up is panta-signer, not the project. Walking up
 * until data/markets.json actually appears works from dist, from src, and from
 * wherever a future build decides to put the output.
 */
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
const DEFAULT_DIR = path.resolve(PROJECT_ROOT, "..", ".human-wallets");
const HUMAN_PICKS = path.join(PROJECT_ROOT, "data", "human_picks.json");
const MARKETS = path.join(PROJECT_ROOT, "data", "markets.json");

/** The stake each human call gets, and the fee Panta takes on top of it. */
const STAKE_USDC = 3.0;
const FEE_RATE = 0.02;
/**
 * Rent for the USDC token account plus one order's transaction fees.
 *
 * MEASURED, not guessed. The agent run established the floor the hard way: with
 * 0.0021 SOL every order failed with "insufficient funds for rent", 0.0071
 * placed two, so roughly 0.0025 per order on top of about 0.0021 of base. This
 * is that sum with a little headroom, because a wallet that runs dry mid-order
 * leaves a half-finished position that is worse than no position.
 */
const SOL_PER_WALLET = 0.005;

interface HumanPrediction {
  market_id: string;
  side?: string;
  reasoning?: string;
}
interface HumanParticipant {
  handle: string;
  displayName?: string;
  wallet?: string | null;
  status?: string;
  predictions?: HumanPrediction[];
}
interface HumanFile {
  gw?: number;
  participants?: HumanParticipant[];
  [key: string]: unknown;
}

function flag(name: string, argv: string[]): string | undefined {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

/** A filename-safe form of a handle. Strips the @ and anything exotic. */
function keyFilenameFor(handle: string): string {
  const cleaned = handle.replace(/^@/, "").replace(/[^A-Za-z0-9._-]/g, "");
  return `${cleaned || "unnamed"}.json`;
}

function isInside(child: string, parent: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

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
    const result = spawnSync("icacls", [file, "/inheritance:r", "/grant:r", `${user}:F`], {
      encoding: "utf8",
    });
    if (result.error) return String(result.error);
    if (result.status !== 0) {
      return (result.stderr || result.stdout || "").trim() || `icacls exited ${result.status}`;
    }
    return null;
  } catch (error) {
    return String(error);
  }
}

function usage(): never {
  console.error(`
Generate one Solana wallet per human call we are placing.

    node dist/scripts/provision-human-wallets.js --gw=6 [--dry-run]
    node dist/scripts/provision-human-wallets.js --gw=6 --dir=<path> --market=<id>

    --gw=<n>        which gameweek's calls to provision.
    --market=<id>   only calls on this market. Default: every market that is
                    still open to new primary buys.
    --dry-run       report what would be created. Writes nothing.

Existing keys are ADOPTED, never regenerated. A regenerated key strands a
payout that belongs to somebody else, and they cannot recover it.
`);
  process.exit(2);
}

function main(): number {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) usage();
  const dryRun = argv.includes("--dry-run");

  const dir = flag("dir", argv) ? path.resolve(flag("dir", argv)!) : DEFAULT_DIR;
  // Checked against the PROJECT root, not panta-signer: the git repository is
  // the project, so a key anywhere under it is a key one `git add -A` from
  // being public. Checking the narrower directory would have passed a path
  // inside the repo and looked like it was guarding something.
  if (isInside(dir, PROJECT_ROOT)) {
    console.error(`Refusing to write keypairs inside the git repository: ${dir}`);
    console.error(`Repository root: ${PROJECT_ROOT}`);
    console.error("A hot key in a working tree is one 'git add -A' from being public.");
    return 1;
  }

  const picks = JSON.parse(fs.readFileSync(HUMAN_PICKS, "utf8")) as HumanFile;
  const markets = JSON.parse(fs.readFileSync(MARKETS, "utf8")) as {
    market_id: string;
    player_name: string;
  }[];
  const nameOf = new Map(markets.map((m) => [m.market_id, m.player_name]));

  // Which calls can actually still be placed. Filtering here rather than making
  // the caller remember is the point: a wallet for a market that refuses buys is
  // a funded wallet that can never trade.
  const onlyMarket = flag("market", argv);
  const eligible = (p: HumanParticipant): HumanPrediction[] =>
    (p.predictions ?? []).filter(
      (pred) =>
        (pred.side === "yes" || pred.side === "no") &&
        (!onlyMarket || pred.market_id === onlyMarket),
    );

  const targets = (picks.participants ?? []).filter((p) => eligible(p).length > 0);

  console.log(`\nGameweek : ${picks.gw ?? "?"}`);
  console.log(`Wallets  : ${dir}`);
  console.log(`Registry : ${HUMAN_PICKS}`);
  console.log(`Mode     : ${dryRun ? "DRY RUN -- nothing written" : "WRITING"}`);
  if (onlyMarket) console.log(`Market   : ${nameOf.get(onlyMarket) ?? onlyMarket}`);

  if (targets.length === 0) {
    console.log("\nNo human calls match. Nothing to do.");
    return 0;
  }

  fs.mkdirSync(dir, { recursive: true });
  const permissionProblems: string[] = [];
  const rows: { handle: string; name: string; address: string; action: string; market: string }[] = [];

  for (const p of targets) {
    const file = path.join(dir, keyFilenameFor(p.handle));
    let address: string;
    let action: string;

    if (fs.existsSync(file)) {
      // Adopt. Read the public key back off disk rather than trusting the JSON,
      // so a hand-edited registry cannot misattribute somebody's payout.
      const raw = fs.readFileSync(file, "utf8").trim();
      const secret = Uint8Array.from(JSON.parse(raw.replace(/^\uFEFF/, "")) as number[]);
      address = Keypair.fromSecretKey(secret).publicKey.toBase58();
      const drifted = p.wallet && p.wallet !== address;
      action = drifted ? "adopted (registry was WRONG, corrected)" : "adopted";
    } else {
      const keypair = Keypair.generate();
      address = keypair.publicKey.toBase58();
      if (!dryRun) {
        fs.writeFileSync(file, JSON.stringify(Array.from(keypair.secretKey)), { mode: 0o600 });
        const hardened = hardenPermissions(file);
        if (hardened) permissionProblems.push(`${keyFilenameFor(p.handle)}: ${hardened}`);
      }
      action = dryRun ? "would create" : "created";
    }

    // Written back only when not a dry run. A dry run that edits the registry
    // would leave addresses with no keys behind them.
    if (!dryRun) p.wallet = address;

    rows.push({
      handle: p.handle,
      name: p.displayName?.trim() || p.handle,
      address,
      action,
      market: eligible(p).map((pred) => nameOf.get(pred.market_id) ?? "?").join(", "),
    });
  }

  console.log("");
  for (const r of rows) {
    console.log(`  ${r.name.padEnd(22)} ${r.address}  [${r.action}]`);
    console.log(`  ${" ".repeat(22)} ${r.handle}  ->  ${r.market}`);
  }

  if (!dryRun) {
    fs.writeFileSync(HUMAN_PICKS, `${JSON.stringify(picks, null, 2)}\n`, "utf8");
    console.log(`\nWrote ${rows.length} addresses back to ${HUMAN_PICKS}`);
  }

  const perWallet = STAKE_USDC * (1 + FEE_RATE);
  console.log("\nFund EACH wallet with:");
  console.log(`  ${perWallet.toFixed(2)} USDC   the ${STAKE_USDC.toFixed(2)} stake plus Panta's ~2% fee`);
  console.log(`  ${SOL_PER_WALLET.toFixed(4)} SOL    rent for its USDC account, plus order fees`);
  console.log(
    `\n  ${rows.length} wallets: ${(perWallet * rows.length).toFixed(2)} USDC and ` +
      `${(SOL_PER_WALLET * rows.length).toFixed(4)} SOL in total.`,
  );

  console.log("\nKEEP THIS DIRECTORY UNTIL THE MARKETS RESOLVE AND PAY OUT.");
  console.log("These keys hold money that becomes someone else's when the market");
  console.log("settles. Losing one costs a named person their winnings, and the");
  console.log("only record they have that it existed is the address on our page.");

  if (permissionProblems.length > 0) {
    console.log("\nCOULD NOT RESTRICT FILE PERMISSIONS:");
    for (const problem of permissionProblems) console.log(`  ${problem}`);
    console.log("\nRun this from a normal shell, not a sandbox, and it will apply:");
    console.log(`\n  icacls "${dir}\\*.json" /inheritance:r /grant:r "%USERDOMAIN%\\%USERNAME%:F"`);
  }

  console.log("\nNo secret key was printed; none exists anywhere but those files.");
  return 0;
}

process.exit(main());
