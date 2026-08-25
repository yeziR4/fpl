/**
 * Public entry point: CORS, method/shape checks, and a coarse IP
 * throttle -- all the stuff that's fine to be "eventually consistent"
 * or best-effort. The one thing that actually protects the wallet
 * (per-address dedup, nonce-safe signing) lives in FaucetLedger.ts,
 * behind a single serialized Durable Object instance every request
 * gets forwarded to.
 */

import type { Env } from "./env";
import { FaucetLedger } from "./FaucetLedger";

export { FaucetLedger };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(env.ALLOWED_ORIGIN);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }
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
  },
};

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
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  };
}

function json(body: unknown, status: number, cors: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });
}
