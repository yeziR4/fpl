export interface Env {
  /** The faucet wallet's recovery phrase. A Worker *secret*
   * (`wrangler secret put FAUCET_MNEMONIC`) -- never set in wrangler.toml,
   * never in this repo, never in a GitHub Actions run.
   *
   * Optional because some wallets (e.g. Polkadot{.js} extension) never
   * expose a mnemonic for an account once it exists, whether it was
   * created there or imported -- only an encrypted JSON export. See
   * FAUCET_KEYSTORE_JSON/FAUCET_KEYSTORE_PASSWORD below for that case;
   * FaucetLedger requires exactly one of the two credential shapes. */
  FAUCET_MNEMONIC?: string;
  /** Alternative to FAUCET_MNEMONIC: the JSON keystore from a wallet's
   * "Export Account" (Polkadot{.js}, SubWallet, etc), as a Worker
   * secret. Paired with FAUCET_KEYSTORE_PASSWORD -- the password set
   * *at export time* to encrypt that file, not a seed phrase. */
  FAUCET_KEYSTORE_JSON?: string;
  FAUCET_KEYSTORE_PASSWORD?: string;
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
  PAYOUT_VARA: string;
  MIN_RESERVE_VARA: string;
  ALLOWED_ORIGIN: string;
  IP_RATE_LIMIT_PER_HOUR: string;
  /** Set to "true" as an emergency stop, without a redeploy -- flip it
   * as a Worker secret/var and the faucet refuses every claim. */
  FAUCET_PAUSED?: string;
}
