export interface Env {
  IP_THROTTLE: KVNamespace;
  FAUCET_LEDGER: DurableObjectNamespace;
  /** One Durable Object instance per (player_id, gw, threshold) market --
   * see MarketLedger.ts. Unlike FAUCET_LEDGER, never needs the wallet's
   * key: a stake arrives already signed by the staker's own wallet. */
  MARKET_LEDGER: DurableObjectNamespace;
  /** Where stakes are sent -- a plain address, not a secret (addresses
   * are public by nature). Currently the same address as the faucet
   * wallet; see docs/architecture.md for why that's an accepted v1
   * simplification, not an oversight. */
  MARKET_POOL_ADDRESS: string;
  /** Base URL of the chain-signer service (a small Node.js service on
   * Vercel -- see chain-signer/ and docs/architecture.md for why the
   * actual chain interaction lives there and not in this Worker:
   * GearApi.create() cannot initialize inside a Cloudflare Workers
   * isolate, confirmed via a real plain-Node control test). Not a
   * secret -- it's a plain deployment URL. */
  CHAIN_SIGNER_URL: string;
  /** Shared bearer token, checked by chain-signer on every request --
   * a Worker *secret* (`wrangler secret put CHAIN_SIGNER_API_KEY`),
   * matching the same value set as a Vercel environment variable on
   * chain-signer's side. Without this, anyone who found chain-signer's
   * URL could trigger a real payout or broadcast directly, bypassing
   * every check (dedup, pause, rate limit) this Worker does first. */
  CHAIN_SIGNER_API_KEY: string;
  /** Shared bearer token gating POST .../settle -- checked directly in
   * index.ts before a request ever reaches a MarketLedger instance (see
   * checkSettlementAuth there). A Worker *secret*
   * (`wrangler secret put SETTLEMENT_API_KEY`), matching the same value
   * set as a GitHub Actions secret for the "Agent picks & leaderboard"
   * workflow, which is the only caller. Without this, anyone who found
   * this Worker's URL could force a market to settle (and pay out) on
   * whatever outcome they chose. */
  SETTLEMENT_API_KEY: string;
  PAYOUT_VARA: string;
  MIN_RESERVE_VARA: string;
  ALLOWED_ORIGIN: string;
  IP_RATE_LIMIT_PER_HOUR: string;
  /** Set to "true" as an emergency stop, without a redeploy -- flip it
   * as a Worker secret/var and the faucet refuses every claim. */
  FAUCET_PAUSED?: string;
}
