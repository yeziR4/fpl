/**
 * Environment for the Panta/Solami signer service.
 *
 * Two secrets live here, and neither may ever reach the browser bundle:
 *
 *   PANTA_API_KEY  -- Panta's docs are explicit: "Never put it in a query
 *                     string, mobile binary, or frontend bundle."
 *   SOLAMI_API_KEY -- authenticates our RPC and Beam calls.
 *
 * That constraint is the entire reason this service exists. The web app is a
 * static export on GitHub Pages, so it has no server of its own; it talks to
 * this instead, and this is the only thing holding the keys.
 *
 * Everything reads through these accessors so a missing variable fails loudly
 * where it is used, rather than surfacing as a confusing 401 from somebody
 * else's API.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. It belongs in the Vercel project environment, never in the repo.`,
    );
  }
  return value;
}

export function pantaApiKey(): string {
  return required("PANTA_API_KEY");
}

/** Panta runs mainnet only -- there is no devnet, and pk_test_ keys hit the
 * same host. Overridable so a future environment can be pointed elsewhere
 * without a code change. */
export function pantaBaseUrl(): string {
  return process.env.PANTA_API_BASE_URL ?? "https://live-api.panta.market/api/v1";
}

/**
 * Solami's JSON-RPC is PATH-BASED and multi-chain: the path selects the chain.
 * It is `https://rpc.solami.dev/solana`, NOT `https://rpc.solami.dev`.
 *
 * Verified 2026-10-06:
 *   POST rpc.solami.dev         -> 405   nothing serves RPC at the root
 *   POST rpc.solami.dev/rpc     -> 400   "unknown variant `rpc`, expected one of
 *                                         `Solana`, `sol`, `solana`, `Monad`, `m..."
 *   POST rpc.solami.dev/solana  -> 401   {"message":"unauthorized"}
 *
 * So the path was the puzzle and auth is what is still missing: this needs a
 * Solami API key.
 */
export function solamiRpcUrl(): string {
  return process.env.SOLAMI_RPC_URL ?? "https://rpc.solami.dev/solana";
}

/**
 * Where transactions go when no Solami key is configured.
 *
 * This exists so the Panta integration can be proven end to end before the
 * Solami key arrives. It is a DEVELOPMENT UNBLOCK, NOT A SUBSTITUTE: the Solami
 * sidetrack is judged on "Solami is the data path ... doing real work", and
 * broadcasting through a public RPC does not satisfy that. Anything the
 * submission claims about Solami must have actually gone through Solami.
 *
 * solami.ts warns loudly, once, whenever this is used.
 */
export function rpcFallbackUrl(): string {
  return process.env.SOLANA_RPC_FALLBACK_URL ?? "https://api.mainnet-beta.solana.com";
}

export function hasSolamiKey(): boolean {
  return Boolean(process.env.SOLAMI_API_KEY);
}

export function solamiApiKey(): string | undefined {
  return process.env.SOLAMI_API_KEY;
}

/**
 * Header name is configurable because Solami's RPC auth scheme is not
 * documented publicly yet. Confirm the exact header in their Discord before
 * the demo rather than trusting this default -- get it wrong and every
 * broadcast 401s at the worst possible moment.
 */
export function solamiApiKeyHeader(): string {
  return process.env.SOLAMI_API_KEY_HEADER ?? "X-Api-Key";
}

export function solamiRequestTimeoutMs(): number {
  return Number(process.env.SOLAMI_TIMEOUT_MS ?? 30_000);
}
