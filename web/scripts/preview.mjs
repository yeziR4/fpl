/**
 * Serve the built static export, for looking at the page without `next dev`.
 *
 *   node scripts/preview.mjs          # after GITHUB_PAGES=true npm run build
 *   open http://localhost:4321/fpl/
 *
 * Why this exists: `next dev` forks a child process over a pipe, which some
 * sandboxed environments block outright (EPERM on spawn). The production build
 * does not -- it is a plain directory of files by then -- so building and serving
 * the output is a way to see the real thing from an environment that cannot run
 * the dev server.
 *
 * It also happens to be closer to what a visitor actually gets: the static export
 * is the shipped artefact, quirks and all, not a dev-mode approximation of it.
 *
 * The export is built with basePath /fpl for GitHub Pages, so this serves it at
 * /fpl/ and strips the prefix, exactly as Pages does.
 */

import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const PORT = Number(process.env.PORT ?? 4321);
const PREFIX = "/fpl";
const OUT = path.resolve(import.meta.dirname, "..", "out");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

if (!fs.existsSync(OUT)) {
  console.error(`No build at ${OUT}. Run:  $env:GITHUB_PAGES="true"; npm run build`);
  process.exit(1);
}

/** Resolve a URL path inside OUT, refusing anything that escapes it. */
function resolve(urlPath) {
  let rel = urlPath;
  if (rel === PREFIX) rel = "/";
  else if (rel.startsWith(PREFIX + "/")) rel = rel.slice(PREFIX.length);
  else return null; // anything outside the basePath is not ours

  const decoded = decodeURIComponent(rel.split("?")[0]);
  const candidates = [
    decoded,
    `${decoded}.html`,
    path.join(decoded, "index.html"),
  ];

  for (const candidate of candidates) {
    const full = path.resolve(OUT, "." + candidate);
    // `..` in a URL must not be able to read outside the export.
    if (!full.startsWith(OUT)) continue;
    if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
  }
  return null;
}

http
  .createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
    const file = resolve(url.pathname);

    if (!file) {
      const notFound = path.join(OUT, "404.html");
      res.statusCode = 404;
      res.setHeader("Content-Type", TYPES[".html"]);
      res.end(fs.existsSync(notFound) ? fs.readFileSync(notFound) : "Not found");
      return;
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", TYPES[path.extname(file)] ?? "application/octet-stream");
    res.end(fs.readFileSync(file));
  })
  .listen(PORT, () => {
    console.log(`static preview on http://localhost:${PORT}${PREFIX}/`);
    console.log(`serving ${OUT}`);
    console.log("live market prices need the API on :8791; the study data is baked in.");
  });
