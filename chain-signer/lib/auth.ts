/**
 * Every endpoint here can trigger a real chain action (a payout, a
 * broadcast) -- unlike faucet/'s Worker, which is meant to be public,
 * this service is meant to be called by exactly one caller: the
 * Cloudflare Worker, which already did its own public-facing checks
 * (CORS, IP throttling, dedup) before ever reaching here. A shared
 * bearer token, set as an env var on both sides
 * (CHAIN_SIGNER_API_KEY), is the only thing stopping this from being
 * an open "sign and send" oracle to anyone who finds the URL.
 */

import type { VercelRequest } from "@vercel/node";

export function isAuthorized(req: VercelRequest): boolean {
  const expected = process.env.CHAIN_SIGNER_API_KEY;
  if (!expected) return false; // fail closed: unconfigured means nothing gets through
  const header = req.headers.authorization;
  return header === `Bearer ${expected}`;
}
