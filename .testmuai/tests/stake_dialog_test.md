---
mode: testing
tags: [smoke]
---

<!--
Verifies the Yes/No staking UI wires up correctly WITHOUT ever
clicking Confirm. This is deliberate, not an oversight: confirming a
stake calls wallet.placeStake, which signs and broadcasts a real VARA
transfer on Vara mainnet (see web/src/lib/vara/stake.ts and
docs/architecture.md, "Market staking"). An unattended CI job must
never be the thing that moves real funds -- same discipline this repo
already applies to debug-faucet-claim.yml ("Manual-only -- this can
trigger a real payout, so it must never run automatically").

So this test only proves the dialog opens and can be cancelled --
real confirmation is deliberately left to a human, or to the separate
manual-only faucet_claim_test.md, which is explicit about the funds
it moves.
-->

# Stake dialog opens and cancels cleanly

## Open the deployed site and create a wallet
Open https://yezir4.github.io/fpl/.
Click the "Create Wallet" button in the header.
Dismiss the "Wallet created" notice if it appears.

## Open a stake dialog
Scroll to the markets section.
Click the "Yes" button on the first market card's first threshold.
Verify an amount input and a "Confirm Yes" button now appear in place
of the Yes/No buttons.

## Cancel without confirming
Click the cancel (✕) button next to the amount input.
Verify the Yes/No buttons reappear and no "Staked" confirmation
message is shown -- confirming nothing was submitted.
