export interface Env {
  /** The faucet wallet's recovery phrase. A Worker *secret*
   * (`wrangler secret put FAUCET_MNEMONIC`) -- never set in wrangler.toml,
   * never in this repo, never in a GitHub Actions run. */
  FAUCET_MNEMONIC: string;
  IP_THROTTLE: KVNamespace;
  FAUCET_LEDGER: DurableObjectNamespace;
  PAYOUT_VARA: string;
  MIN_RESERVE_VARA: string;
  ALLOWED_ORIGIN: string;
  IP_RATE_LIMIT_PER_HOUR: string;
  /** Set to "true" as an emergency stop, without a redeploy -- flip it
   * as a Worker secret/var and the faucet refuses every claim. */
  FAUCET_PAUSED?: string;
}
