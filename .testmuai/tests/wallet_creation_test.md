---
mode: testing
tags: [smoke]
---

<!--
Covers the one piece of this app that can never be checked by a
curl-based smoke test (see deploy-faucet.yml's "Smoke test the live
Worker" step, which only exercises the Worker's HTTP surface): real
client-side key generation and rendering, in a real browser, with no
backend involved at all (docs/architecture.md, "Wallets: on-site,
non-custodial key generation").

Safe to run unattended: wallet creation is entirely local (a keypair
generated in-browser -- see web/src/lib/vara/keyring.ts). No network
call, no funds, nothing to clean up. A fresh wallet is created on
every run, so this never collides with a previous run's wallet.
-->

# Create a wallet in the browser

## Open the deployed site
Open https://yezir4.github.io/fpl/.

## Create a wallet
Click the "Create Wallet" button in the header.
Verify a "Wallet created" notice appears mentioning a seed phrase.
Dismiss the notice.

## Verify the wallet renders
Verify the header now shows a shortened wallet address (a short
string with an ellipsis in the middle, not the literal words
"Create Wallet" anymore).
Verify the header shows a balance of "0 VARA" next to the address --
a brand-new wallet has never received any funds.

## Verify the wallet menu
Click the wallet address in the header to open the wallet menu.
Verify a "Wallet address" section and a "Balance" section are both
visible.
Verify a "Log out on this browser" button is visible.
