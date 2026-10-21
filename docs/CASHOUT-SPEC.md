# Cash out to Finance District — build spec (for the builder)

TASK: Add a "cash out to Finance District" flow for human winners.

## Context
- Humans' Panta positions are held in per-human Solana wallets we custody
  (`panta-signer/scripts/provision-human-wallets.ts`). Panta stays the betting
  venue. We are NOT adding public staking or any new custody.
- When a human wins, we claim on Panta, then send the USDC to a Finance
  District Agent Wallet the human creates (email signup, no seed phrase).
  After cash-out the custodial wallet should be EMPTY.

## Steps (new script: `panta-signer/scripts/claim-and-withdraw.ts`)
1. **Find winners**: for each human fill in `data/human_picks.json` whose market
   has resolved on chain for their side, check claim eligibility via Panta.
2. **Claim**: `buildWinClaim()` (`lib/panta.ts`) -> sign with that human's keypair
   -> broadcast on our RPC (same path as orders) -> report attribution with kind `"claim"`.
3. **Verify the payout address**: the human posts their FD *Solana* address from the
   SAME X handle that made the call. Record the address + post URL in
   `data/withdrawals.json`. The script REFUSES to send without both, and validates
   the address is a valid Solana base58 public key.
4. **Fees**: if the custodial wallet's SOL is below what claim + transfer need, top it
   up from the operator wallet (`lib/operator-wallet.ts`).
   A brand-new FD wallet may have no USDC token account: create the recipient's
   associated token account idempotently (~0.002 SOL rent) before transferring.
5. **Send** the FULL USDC balance to the FD address, then sweep leftover SOL back to
   the operator wallet so the custodial wallet is empty.
6. **Record** in `data/withdrawals.json`:
   `{ handle, market_id, claim_signature, amount_usdc, fd_address, proof_url,
   transfer_signature, sol_swept_signature, paid_at }`

## Safety (non-negotiable)
- Dry-run by default; only send with `--execute`.
- Idempotent: skip any entry that already has `transfer_signature`.
- Per-withdrawal cap (default 50 USDC, configurable); abort above it.
- Never print, log or commit private keys. Key files stay 0600 and gitignored.
- First live test: one wallet, a tiny amount (e.g. 0.10 USDC) sent to the OWNER's own
  FD wallet, before any real winner.

## Site (`web/`)
- New "Cash out" section: "Won? 1) Create a free Finance District wallet with your
  email (apps.fd.xyz) 2) Post your Solana address from your X account 3) We send your
  winnings."
- Public withdrawals log from `data/withdrawals.json`: handle, amount, Solscan link,
  proof post.
- In the participant table, show "Paid ✓" with the Solscan link once paid.

## Out of scope
x402/Prism, public staking, any change to how bets are placed.
