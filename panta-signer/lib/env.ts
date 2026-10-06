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

export function solamiRpcUrl(): string {
  return process.env.SOLAMI_RPC_URL ?? "https://rpc.solami.dev";
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
