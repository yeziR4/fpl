/**
 * Agent wallets: one Solana keypair per model, so each model's P&L is a fact
 * about the chain rather than a row in our own ledger.
 *
 * The Vara version ran all five models through one shared hot wallet and kept a
 * spreadsheet of who owned what. That is the exact thing this rewrite exists to
 * remove -- "we ran the house ourselves with a shared hot wallet and off-chain
 * bookkeeping". With one wallet per model, "GPT made 12% and Claude lost 8%" is
 * something anyone can verify, for the price of about 40 cents of rent each.
 *
 * Two files, deliberately different in kind:
 *
 *   data/agent_models.json     COMMITTED. slug, display name, public address.
 *                              A public key is public information, and the board
 *                              needs it to attribute trades to a model.
 *
 *   <wallets dir>/<slug>.json  NEVER COMMITTED. The full keypair, outside the
 *                              git repository entirely, mode 0600 -- the same
 *                              treatment the operator key already gets.
 *
 * Anything that needs to sign calls loadAgentKeypair(). Nothing in this module
 * ever prints, logs, or returns a secret key.
 */

import fs from "node:fs";
import path from "node:path";
import { Keypair } from "@solana/web3.js";

/** Where the committed slug -> address mapping lives. cwd is panta-signer/. */
export const DEFAULT_MODELS_REGISTRY = path.join("..", "data", "agent_models.json");

/**
 * Where the keypairs live: beside the repo, next to the operator key, so a
 * single `git add -A` cannot reach them.
 */
export const DEFAULT_WALLETS_DIR = path.join("..", "..", ".agent-wallets");

export interface AgentModelEntry {
  slug: string;
  name: string;
  /** Base58. Public. Committed on purpose. */
  solana_address: string;
}

/**
 * The default lineup, and it MUST stay in step with
 * data_pipeline/agents.py's _DEFAULT_AGENT_MODELS -- the Python side decides
 * what to ask, this decides which wallet pays for the answer. A drift here
 * would silently attribute one model's trades to another.
 *
 * One model per lab, for genuine cross-lab diversity rather than several from
 * one family.
 */
export const DEFAULT_AGENT_MODELS: readonly { slug: string; name: string }[] = [
  { slug: "~openai/gpt-latest", name: "GPT (latest)" },
  { slug: "~anthropic/claude-opus-latest", name: "Claude Opus (latest)" },
  { slug: "~google/gemini-pro-latest", name: "Gemini Pro (latest)" },
  { slug: "x-ai/grok-4.20", name: "Grok 4.20" },
  { slug: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro" },
];

/** The wallets directory, overridable so CI or a second machine can differ. */
export function walletsDir(): string {
  return path.resolve(process.env.AGENT_KEYPAIRS_DIR ?? DEFAULT_WALLETS_DIR);
}

/**
 * A slug is an OpenRouter model id and contains "/" and "~", so it cannot be a
 * filename. This is the single definition of the mapping, used by both the
 * provisioner and the trader -- deriving it in two places is how a script ends
 * up reading a different wallet than it wrote.
 */
export function keyFilenameFor(slug: string): string {
  const safe = slug.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
  if (!safe) throw new Error(`slug ${JSON.stringify(slug)} has no filename-safe characters`);
  return `${safe}.json`;
}

export function keyPathFor(slug: string, dir = walletsDir()): string {
  return path.join(dir, keyFilenameFor(slug));
}

export function readModelsRegistry(
  registryPath = path.resolve(DEFAULT_MODELS_REGISTRY),
): AgentModelEntry[] {
  if (!fs.existsSync(registryPath)) return [];
  const raw = fs.readFileSync(registryPath, "utf8").replace(/^\uFEFF/, "");
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error(`${registryPath} is not a JSON array`);
  return parsed as AgentModelEntry[];
}

export function writeModelsRegistry(
  entries: AgentModelEntry[],
  registryPath = path.resolve(DEFAULT_MODELS_REGISTRY),
): void {
  const sorted = [...entries].sort((a, b) => a.slug.localeCompare(b.slug));
  fs.mkdirSync(path.dirname(registryPath), { recursive: true });
  fs.writeFileSync(registryPath, `${JSON.stringify(sorted, null, 2)}\n`);
}

/**
 * The keypair that signs for one model.
 *
 * Fails loudly rather than falling back to any other wallet. A silent fallback
 * here would be the worst possible bug in this file: two models sharing a
 * wallet would make the leaderboard a lie while still looking like it worked.
 */
export function loadAgentKeypair(slug: string, dir = walletsDir()): Keypair {
  const file = keyPathFor(slug, dir);
  if (!fs.existsSync(file)) {
    throw new Error(
      `No keypair for ${slug} at ${file}.\n` +
        `Run: node dist/scripts/provision-agent-wallets.js`,
    );
  }
  const raw = fs.readFileSync(file, "utf8").trim();
  let secret: number[];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("not an array");
    secret = parsed as number[];
  } catch {
    // Not JSON: accept a base58 secret so a Phantom export works too.
    secret = Array.from(bs58Decode(raw));
  }
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

/** Minimal base58 decode, so this module does not need the bs58 dependency. */
function bs58Decode(value: string): Uint8Array {
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let num = 0n;
  for (const char of value) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) throw new Error(`not base58: ${value.slice(0, 12)}...`);
    num = num * 58n + BigInt(index);
  }
  const bytes: number[] = [];
  while (num > 0n) {
    bytes.unshift(Number(num % 256n));
    num /= 256n;
  }
  for (const char of value) {
    if (char !== "1") break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

/** True when `candidate` sits inside `root` -- used to refuse writing keys to a repo. */
export function isInside(candidate: string, root: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(candidate));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}
