---
mode: testing
tags: [manual, funds]
---

<!--
NOT run by the default/scheduled verify-web.yml job -- only via
workflow_dispatch with include_fund_movement: true. This flow claims
from the project's own real demo faucet (faucet/, see
docs/architecture.md), which really does sign and broadcast a VARA
transfer via chain-signer. That's exactly what the faucet is for
(demo funds, not user funds, from a wallet the project funds on
purpose) -- but running it on every deploy would silently drain the
faucet's reserve one fresh wallet at a time, with nobody deciding
that should happen. Same reasoning as debug-faucet-claim.yml being
manual-only, applied here.

Each run creates a brand-new, disposable wallet, so this can never
collide with -- or drain -- a real visitor's claim (the faucet's
per-address dedup means this wallet could only ever claim once
anyway).
-->

# Claim from the demo faucet

## Open the deployed site and create a wallet
Open https://yezir4.github.io/fpl/.
Click the "Create Wallet" button in the header.
Dismiss the "Wallet created" notice if it appears.

## Claim demo VARA
Click the wallet address in the header to open the wallet menu.
Verify a "Demo faucet" section with a "Claim demo VARA" button is
visible.
Click "Claim demo VARA".
Verify a message appears confirming VARA was sent (e.g. "Sent ... VARA").

## Verify the balance updated
Click "Refresh" in the Balance section.
Verify the balance is no longer "0 VARA".
