/**
 * Public entry point: CORS, method/shape checks, and a coarse IP
 * throttle -- all the stuff that's fine to be "eventually consistent"
 * or best-effort. The things that actually protect real money (the
 * faucet wallet's per-address dedup and nonce-safe signing; a
 * market's dedup-by-signed-tx-hash) live in FaucetLedger.ts and
 * MarketLedger.ts, behind a Durable Object every request is forwarded
 * to.
 *
 * Two route families, both through this one Worker:
 *   POST /                                    -- faucet claim (unchanged
 *                                                 since before markets existed;
 *                                                 NEXT_PUBLIC_FAUCET_URL points
 *                                                 straight at this root)
 *   GET  /markets/:playerId/:gw/:threshold/totals
 *   POST /markets/:playerId/:gw/:threshold/stake
 *   POST /markets/:playerId/:gw/:threshold/settle -- admin-only, see below
 */

import type { Env } from "./env";
import { FaucetLedger } from "./FaucetLedger";
import { MarketLedger } from "./MarketLedger";

export { FaucetLedger, MarketLedger };

const MARKET_PATH = /^\/markets\/(\d+)\/(\d+)\/(\d+)\/(totals|stake|settle)$/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(env.ALLOWED_ORIGIN);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    const url = new URL(request.url);
    const marketMatch = url.pathname.match(MARKET_PATH);
    if (marketMatch) {
      return handleMarketRequest(request, env, cors, marketMatch);
    }

    return handleFaucetClaim(request, env, cors);
  },
};

async function handleFaucetClaim(request: Request, env: Env, cors: HeadersInit): Promise<Response> {
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405, cors);
  }

  let body: { address?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400, cors);
  }

  const address = body.address;
  if (typeof address !== "string" || address.length === 0) {
    return json({ error: "address_required" }, 400, cors);
  }

  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const throttled = await isRateLimited(env, ip);
  if (throttled) {
    return json({ error: "rate_limited" }, 429, cors);
  }

  // Every request, from every colo, goes to the SAME named instance --
  // that's what makes the serialization guarantee in FaucetLedger
  // actually hold. A per-address or per-request instance ID would
  // give each claim its own isolated (and therefore un-serialized)
  // Durable Object, defeating the whole point.
  const id = env.FAUCET_LEDGER.idFromName("faucet");
  const stub = env.FAUCET_LEDGER.get(id);
  const ledgerResponse = await stub.fetch("https://faucet-ledger.internal/claim", {
    method: "POST",
    body: JSON.stringify({ address }),
    headers: { "content-type": "application/json" },
  });

  const responseBody = await ledgerResponse.text();
  return new Response(responseBody, {
    status: ledgerResponse.status,
    headers: { ...cors, "content-type": "application/json" },
  });
}

async function handleMarketRequest(
  request: Request,
  env: Env,
  cors: HeadersInit,
  match: RegExpMatchArray,
): Promise<Response> {
  const [, playerId, gw, threshold, action] = match;
  // One Durable Object per market -- see MarketLedger.ts for why these
  // don't need to serialize against each other the way faucet claims do.
  const id = env.MARKET_LEDGER.idFromName(`${playerId}:${gw}:${threshold}`);
  const stub = env.MARKET_LEDGER.get(id);

  if (action === "totals") {
    if (request.method !== "GET") {
      return json({ error: "method_not_allowed" }, 405, cors);
    }
    const ledgerResponse = await stub.fetch("https://market-ledger.internal/totals");
    const responseBody = await ledgerResponse.text();
    return new Response(responseBody, {
      status: ledgerResponse.status,
      headers: { ...cors, "content-type": "application/json" },
    });
  }

  if (action === "settle") {
    if (request.method !== "POST") {
      return json({ error: "method_not_allowed" }, 405, cors);
    }
    // Admin-only: unlike totals (public, read-only) and stake (only
    // ever moves the *staker's own* already-signed funds), settling a
    // market decides real payouts out of the shared pool wallet --
    // this must never be callable by an arbitrary visitor. Checked
    // here, before a request ever reaches the Durable Object, same
    // layering as CORS/method checks above.
    if (!isSettlementAuthorized(request, env)) {
      return json({ error: "unauthorized" }, 401, cors);
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: "invalid_json" }, 400, cors);
    }
    const ledgerResponse = await stub.fetch("https://market-ledger.internal/settle", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    });
    const responseBody = await ledgerResponse.text();
    return new Response(responseBody, {
      status: ledgerResponse.status,
      headers: { ...cors, "content-type": "application/json" },
    });
  }

  // action === "stake"
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405, cors);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400, cors);
  }
  const ledgerResponse = await stub.fetch("https://market-ledger.internal/stake", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  const responseBody = await ledgerResponse.text();
  return new Response(responseBody, {
    status: ledgerResponse.status,
    headers: { ...cors, "content-type": "application/json" },
  });
}

function isSettlementAuthorized(request: Request, env: Env): boolean {
  if (!env.SETTLEMENT_API_KEY) return false; // fail closed if unconfigured
  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${env.SETTLEMENT_API_KEY}`;
}

async function isRateLimited(env: Env, ip: string): Promise<boolean> {
  if (ip === "unknown") return false; // fail open on IP -- the DO's per-address dedup is the real guard
  const limit = Number.parseInt(env.IP_RATE_LIMIT_PER_HOUR || "3", 10);
  const key = `ip:${await sha256(ip)}`;
  const current = Number.parseInt((await env.IP_THROTTLE.get(key)) ?? "0", 10);
  if (current >= limit) return true;
  await env.IP_THROTTLE.put(key, String(current + 1), { expirationTtl: 3600 });
  return false;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function corsHeaders(allowedOrigin: string): HeadersInit {
  return {
    "access-control-allow-origin": allowedOrigin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  };
}

function json(body: unknown, status: number, cors: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });
}
