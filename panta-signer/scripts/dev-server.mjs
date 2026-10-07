/**
 * Local development server for panta-signer.
 *
 * Panta requires an API key on every read, so the static frontend cannot fetch
 * the catalog itself -- and the frontend is a static export, so it has no
 * server of its own either. It talks to this service instead.
 *
 * Deploying to Vercel is the production answer. This is the development one: a
 * plain node:http server that mounts the SAME compiled handlers from
 * dist/api/, so there is no second implementation to drift. Point the frontend
 * at it with NEXT_PUBLIC_PANTA_API_BASE=http://localhost:8787
 *
 *   node --env-file=..\.env.local dist/scripts/dev-server.js
 *   # or during development, without a build step, see package.json
 *
 * It deliberately does not do TLS, load balancing, or anything else Vercel
 * handles. It maps a URL to a handler and adapts the request/response shape.
 */

import http from "node:http";
import { pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";

const PORT = Number(process.env.PORT ?? 8787);
// This file is plain .mjs and is not compiled, so it resolves the COMPILED
// handlers rather than its own directory. Run `npm run build:scripts` first.
const API_DIR = path.resolve(import.meta.dirname, "..", "dist", "api");

/** Vercel routes /api/foo -> api/foo.ts. Mirror that, one file per route. */
function handlerFor(pathname) {
  const name = pathname.replace(/^\/+|\/+$/g, "").split("/").pop();
  if (!name || !/^[a-z0-9-]+$/.test(name)) return null;
  const file = path.join(API_DIR, `${name}.js`);
  return fs.existsSync(file) ? file : null;
}

function toVercelRequest(req, url) {
  const query = {};
  for (const [k, v] of url.searchParams) query[k] = v;
  return { ...req, query, method: req.method, headers: req.headers };
}

function wrapResponse(res) {
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    if (!res.getHeader("Content-Type")) res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(payload));
    return res;
  };
  return res;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  if (url.pathname === "/health") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true, routes: fs.readdirSync(API_DIR).filter((f) => f.endsWith(".js")) }));
    return;
  }

  const file = handlerFor(url.pathname);
  if (!file) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "no_handler", path: url.pathname }));
    return;
  }

  try {
    const mod = await import(pathToFileURL(file).href);
    const handler = mod.default ?? mod.handler;
    if (typeof handler !== "function") throw new Error(`${file} has no default export function`);

    const body = await readBody(req);
    const vreq = toVercelRequest(req, url);
    if (body !== undefined) vreq.body = body;
    await handler(vreq, wrapResponse(res));
  } catch (error) {
    console.error(`[dev-server] ${url.pathname} failed`, error);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "dev_server_error", message: String(error) }));
    }
  }
});

server.listen(PORT, () => {
  console.log(`panta-signer dev server on http://localhost:${PORT}`);
  console.log(`  routes: ${fs.readdirSync(API_DIR).filter((f) => f.endsWith(".js")).map((f) => "/" + f.replace(/\.js$/, "")).join(" ")}`);
  console.log("  point the frontend at it with NEXT_PUBLIC_PANTA_API_BASE=http://localhost:" + PORT);
});
