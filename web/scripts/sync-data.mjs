/**
 * Copy the study data into the web app before a build or a dev server starts.
 *
 * `data/` is the single source of truth and lives beside the repo, not inside
 * web/. Next.js cannot import from outside its own project root, so rather than
 * duplicate anything, this copies it in at build time. The copies are gitignored:
 * a checked-in duplicate of a file that changes on every trade is a file that
 * will eventually disagree with the original.
 *
 * Deliberately a copy and not a symlink. Symlinks need privileges on Windows and
 * behave differently in git, and this has to work identically on a Windows dev
 * box and a Linux CI runner.
 *
 *   node scripts/sync-data.mjs
 */

import fs from "node:fs";
import path from "node:path";

const WEB = path.resolve(import.meta.dirname, "..");
const SRC = path.resolve(WEB, "..", "data");
const DEST = path.join(WEB, "src", "data", "study");

/** Files the research page reads, and whether a missing one is fatal. */
const SINGLE_FILES = [
  ["markets.json", true],
  ["agent_models.json", true],
  ["human_picks.json", false],
];

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function copyDir(from, to, filter) {
  if (!fs.existsSync(from)) return 0;
  let n = 0;
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from)) {
    if (!filter(entry)) continue;
    copyFile(path.join(from, entry), path.join(to, entry));
    n += 1;
  }
  return n;
}

const missing = [];
fs.rmSync(DEST, { recursive: true, force: true });

for (const [name, required] of SINGLE_FILES) {
  const from = path.join(SRC, name);
  if (!fs.existsSync(from)) {
    if (required) missing.push(name);
    continue;
  }
  copyFile(from, path.join(DEST, name));
}

const picks = copyDir(
  path.join(SRC, "agent_picks"),
  path.join(DEST, "agent_picks"),
  (f) => /^gw\d+\.json$/.test(f),
);
const fills = copyDir(
  path.join(SRC, "agent_fills"),
  path.join(DEST, "agent_fills"),
  (f) => /^gw\d+\.json$/.test(f),
);

if (missing.length > 0) {
  console.error(`sync-data: missing required file(s) in ${SRC}: ${missing.join(", ")}`);
  console.error("The research page cannot render without them.");
  process.exit(1);
}

console.log(
  `sync-data: ${picks} picks file(s), ${fills} fills file(s), ` +
    `${SINGLE_FILES.filter(([n]) => fs.existsSync(path.join(DEST, n))).length} registry file(s) -> src/data/study`,
);
