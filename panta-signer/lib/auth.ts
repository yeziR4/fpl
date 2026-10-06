/**
 * A shared bearer token gates every write endpoint here.
 *
 * This service is not public. It holds a Panta API key with market-creation
 * rights and it can push transactions through our Solami quota, so an open URL
 * is an open "spend our money" button. Fail closed: an unconfigured deployment
 * serves nothing at all, rather than defaulting to allow.
 *
 * Same shape as chain-signer/lib/auth.ts, deliberately, so the two services
 * read the same way.
 */

import type { VercelRequest } from "@vercel/node";

export function isAuthorized(req: VercelRequest): boolean {
  const expected = process.env.PANTA_SIGNER_API_KEY;
  if (!expected) return false;
  const header = req.headers.authorization;
  return header === `Bearer ${expected}`;
}
