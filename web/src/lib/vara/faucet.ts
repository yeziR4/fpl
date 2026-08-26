/**
 * Client for the demo faucet Worker (faucet/ at the repo root). Pure
 * fetch to a public endpoint -- the faucet wallet's key never comes
 * anywhere near this file or the browser; see faucet/src/FaucetLedger.ts
 * for where the actual signing happens.
 *
 * The Worker's URL isn't knowable at write time (it depends on the
 * operator's own Cloudflare account subdomain, or a custom domain they
 * point at it) -- baked in via NEXT_PUBLIC_FAUCET_URL at build time
 * instead of hardcoded. See docs/architecture.md for the one-time
 * setup this depends on. Deliberately fails soft (isConfigured: false)
 * rather than throwing when it's unset, so the wallet UI can just hide
 * the Claim button instead of showing a broken one.
 */

export type FaucetClaimResult =
  | { ok: true; status: "sent"; txHash: string; amount: string }
  | { ok: false; error: string };

export function isFaucetConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_FAUCET_URL);
}

export async function claimFaucet(address: string): Promise<FaucetClaimResult> {
  const url = process.env.NEXT_PUBLIC_FAUCET_URL;
  if (!url) {
    return { ok: false, error: "not_configured" };
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address }),
    });
    const body = (await res.json()) as Record<string, unknown>;

    if (res.ok && body.status === "sent") {
      return { ok: true, status: "sent", txHash: String(body.txHash), amount: String(body.amount) };
    }
    return { ok: false, error: typeof body.error === "string" ? body.error : "unknown_error" };
  } catch {
    return { ok: false, error: "network_error" };
  }
}

/** Human-readable text for each error code the Worker/network can return. */
export function faucetErrorMessage(error: string): string {
  switch (error) {
    case "already_claimed":
      return "This wallet already claimed from the faucet.";
    case "rate_limited":
      return "Too many requests from this network -- try again in a bit.";
    case "faucet_paused":
      return "The faucet is temporarily paused.";
    case "faucet_low":
      return "The faucet is running low and needs a top-up.";
    case "invalid_address":
      return "That doesn't look like a valid address.";
    case "timeout":
      return "That took too long -- the chain may be slow right now. Try again.";
    case "not_configured":
      return "The faucet isn't set up yet.";
    case "network_error":
      return "Couldn't reach the faucet -- try again.";
    default:
      return "Couldn't complete the claim.";
  }
}
