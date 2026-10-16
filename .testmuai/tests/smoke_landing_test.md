---
mode: testing
tags: [smoke]
---

<!--
Runs against the live GitHub Pages deploy (see
.github/workflows/verify-web.yml), not localhost -- deploy-web.yml
already treats a GitHub Actions runner's real internet access as the
first genuine end-to-end check of the FPL image CDN URLs (see
docs/architecture.md, "Hosting: GitHub Pages via Actions"). This test
is the same idea one level up: confirming the *deployed page* actually
renders real data in a real browser, not just that the build
succeeded.

Deliberately safe to run unattended on every deploy: read-only,
no wallet, no chain interaction.
-->

# Landing page renders real FPL data

## Open the deployed site
Open https://yezir4.github.io/fpl/.
Verify the page loads without a browser error page.

## Hero section
Verify the text "Premier League" is visible somewhere in the hero
section (headline, eyebrow label, or supporting copy) -- deliberately
not pinned to the exact headline wording, which is stylized ("Call the
gameweek before it happens.") and has already changed once since this
test was written. Requiring literal "Fantasy Premier League" or
"prediction market" text in the headline itself is what broke this
check for real on 2026-09-07 (run 68: Kane CLI's own auto-triage
correctly root-caused it as the page having genuinely different
copy, not a flake -- see .testmuai/evidence from that run).
Verify a "Create Wallet" button is visible in the header.

## Markets grid
Scroll to the markets section.
Verify at least one player card is visible, showing a player name and
a price.
Verify the text "Markets unavailable" is NOT visible anywhere on the
page -- that text only renders when the FPL data fetch failed at
build time (see src/components/MarketsSection.tsx), which would mean
this deploy shipped broken.
