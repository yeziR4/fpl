/**
 * Origin allowlist for the browser-callable endpoints, plus their CORS headers.
 *
 * The buy and read endpoints are non-custodial. A primary buy spends the
 * *user's* USDC and cannot complete without that user's own wallet signature,
 * so the worst a stranger can do is burn some of our Solami compute. That is
 * why they are not bearer-gated: a bearer token would have to ship inside the
 * static frontend, which is a worse leak than the thing it would protect.
 *
 * Market creation is the opposite -- it costs real, non-refundable USDC and is
 * driven by our own generator rather than by a browser -- so it keeps the
 * bearer gate in lib/auth.ts.
 *
 * Be honest about what this is: an Origin header is trivially spoofed by
 * anything that is not a browser. It is a speed bump for casual abuse, not a
 * security boundary, and the split above is what actually contains the blast
 * radius.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";

function allowedOrigins(): string[] {
  return (process.env.ALLOWED_ORIGINS ?? "https://yezir4.github.io,http://localhost:3000")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function applyCors(req: VercelRequest, res: VercelResponse): void {
  const origin = req.headers.origin;
  if (typeof origin === "string" && allowedOrigins().includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "600");
}

/** Returns true when the request was a preflight and has already been answered. */
export function handlePreflight(req: VercelRequest, res: VercelResponse): boolean {
  applyCors(req, res);
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return true;
  }
  return false;
}

export function isAllowedOrigin(req: VercelRequest): boolean {
  const origin = req.headers.origin;
  // No Origin means the caller is not a browser (curl, a script, our own
  // generator). Those paths are either already bearer-gated or deliberately
  // open because they cannot move our funds.
  if (typeof origin !== "string") return true;
  return allowedOrigins().includes(origin);
}
