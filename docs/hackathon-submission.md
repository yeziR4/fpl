# Kane CLI Hackathon — submission draft

Draft answers for the submission form. Fill in the bracketed bits and
record the demo video before submitting — everything else here is
ready to paste in.

1. **Solo or team?** [fill in]
2. **Signed up on TestMu AI and claimed the 10,000 free credits?**
   [fill in — required before the workflow in `verify-web.yml` can
   actually run]
3. **Name / team members:** [fill in]
4. **Teammate emails:** [fill in]
5. **GitHub repo:** https://github.com/yeziR4/fpl
6. **Demo video:** [record and link — see suggested script below]
7. **One-paragraph description:**

   > fpl is a prediction market on Fantasy Premier League outcomes —
   > AI models and humans both stake real VARA (Vara Network) on
   > whether a player clears a points threshold or plays a full 90
   > minutes, priced by a parimutuel pool rather than fixed odds. It's
   > a full stack: a Python data pipeline that snapshots FPL's API and
   > derives payout-safe settlement facts, a Next.js frontend with
   > real non-custodial in-browser wallets, a Cloudflare Worker
   > handling staking/faucet logic, and a Vercel service that signs
   > and broadcasts the actual chain transactions. Built with
   > **Claude Code**. **Kane CLI** verifies the deployed site itself,
   > in a real browser, after every deploy — confirming the live page
   > renders real player data, that a wallet is actually generated and
   > displayed client-side (the one flow no API-level smoke test could
   > ever reach), and that the stake dialog opens and cancels cleanly
   > — while deliberately never auto-confirming a real stake or faucet
   > claim, so verification never becomes the thing moving real funds.

8. **Live URL / install command:**

   ```
   https://yezir4.github.io/fpl/
   ```

9. **Lane:** Verification baked into your workflow
   (secondary fit: Apps that verify themselves)
10. **Coding agents used:** Claude Code

## Suggested demo video script (~2 min)

1. Show the live site (`https://yezir4.github.io/fpl/`): hero, markets
   grid with real player data and prices.
2. `git log`/repo tour: point at `data_pipeline/` (settlement logic +
   tests), `web/`, `faucet/`, `chain-signer/` — the full stack, not a
   mockup.
3. Open `.testmuai/tests/` and read one flow out loud (plain English,
   e.g. `wallet_creation_test.md`) — this is the point: a QA flow a
   human wrote once, in prose.
4. Trigger `verify-web.yml` (or show a completed run) in the Actions
   tab: Kane CLI opening the live site in a real browser, creating a
   wallet, opening the stake dialog, uploading the evidence pack.
5. Open one evidence pack (`kane-cli evidence serve`) and show the
   per-step screenshots — this is what actually ran, not just "tests
   passed."
6. Close on `docs/architecture.md`'s "Verification: Kane CLI" section:
   why the fund-moving flows are deliberately manual-only.
