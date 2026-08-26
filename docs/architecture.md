# Architecture & decisions

This doc exists so future sessions (human or AI) don't have to re-derive
context from a chat log. It's a living document — update it when a
decision below changes, and add to it as new layers get designed.

## The idea

A prediction market on Fantasy Premier League outcomes. Both AI models and
humans can take positions. Two seed markets, more layers later. Both are
evaluated **per single gameweek (one match)** — nothing here accumulates
across gameweeks, every market resets each week:

1. **Points threshold** — did the player score at least N points in
   *that one match*? Two lines on the same underlying number:
   - **Primary market**: over/under **5** points
   - **Secondary market**: over/under **10** points (rarer, higher bar)
2. **Full 90** — yes/no, did the player play all 90 minutes, evaluated
   per gameweek.

(Earlier draft of this doc described the points market as summed over a
5- or 10-gameweek rolling window — that was a misreading and has been
corrected. It's a single-match threshold, not an accumulation.)

**Player pool (v0):** the 20 most expensive players by current FPL
price, for both markets. Expensive players are the ones with public
attention and an audience willing to have an opinion — narrows scope
enough to ship something, without pretending it's the final scope.
Expected to expand (more players, more stat types, maybe assists/
clean-sheets/cards) once the mechanism is proven.

## Market resolution: don't trust a snapshot until the fixture is finished

A cached live snapshot can exist mid-match — `minutes` and `total_points`
are still moving, and even right at full time FPL keeps recalculating
bonus points for up to about an hour afterwards. Resolving a market
straight off `settlement.py`'s raw numbers risks paying out on a value
that hasn't finalized yet.

`resolution.py` is the fix: every market resolves through
`resolve_points_threshold()` / `resolve_full90()`, which return one of
`PENDING` / `YES` / `NO`. The two markets are gated differently:

- **Points market** gates on the whole *gameweek* being finished —
  `is_gameweek_finished(gw)` is only True once every fixture in that
  gameweek has finished, not just the player's own match. This is the
  concrete shape of "auto-resolve after the last match of the
  gameweek": one trigger point per gameweek resolves every player's
  points market at once (`resolve_gameweek_points_markets()`), rather
  than each player resolving on their own match's schedule. It also
  makes blank/double gameweeks a non-issue for this market: a player
  whose team didn't play just has 0 points that week and correctly
  resolves NO; a player whose team played twice already has both
  matches summed into one `total_points` by FPL's own live endpoint.
- **Full-90 market** still gates per-player, on that specific player's
  own fixture being finished (`fixture_status_for_player()`) — left
  as-is for now, not revisited when the points market was reworked.
  This is also where a blank or double gameweek for a specific player
  surfaces as PENDING (`FixtureStatus.NOT_FOUND`) rather than silently
  guessing which of zero or two fixtures to use.

Either way, until the gate is satisfied — mid-match, or a finished
match we haven't fetched live data for yet — the answer is PENDING,
full stop.

**The stoppage-time question:** does a player who gets substituted late
in second-half stoppage time (e.g. 90+3') wrongly resolve to "no" for
full 90, even though they were on the pitch until nearly the final
whistle? As best we've been able to confirm, no — FPL's `minutes` stat
doesn't separately tally stoppage time on top of the normal 90-minute
frame of a match, so a player subbed at 90+3' and a player who plays
every second of stoppage time without being subbed both show
`minutes == 90` in the data. Both resolve YES under our `>= 90` rule.
**This has not been verified against live data** — this sandbox can't
reach the FPL API (see below) — so treat it as the current working
assumption, not confirmed fact. Concrete to-do before real money is on
this market: pull a known match with a documented stoppage-time
substitution and check the actual cached `minutes` value. If it turns
out FPL does report minutes above 90 in that case, the fix is a one-line
threshold change in `resolution.py`'s docstring/logic, not a redesign.

## Market mechanism: parimutuel, not a sportsbook

Explicitly **not** fixed-odds — we are not the house and don't want to
carry the other side of every bet. Mechanism is **parimutuel pooling**:

- Bettors stake into one of two buckets for a given market (e.g. "Haaland
  over/under 5 points in GW12" — a yes bucket and a no bucket).
- The pool per bucket determines the implied odds — there is no admin-set
  price, the crowd's stake distribution *is* the price.
- After the match resolves (using the settlement facts from the data
  pipeline), the losing bucket's stakes are redistributed pro-rata to the
  winning bucket, minus whatever protocol fee we decide on.
- No liquidity provider needed, no house risk, and resolution is
  objective — it comes from real match data, not a model's opinion.

Since both point lines (5 and 10) are fixed in advance rather than
dynamic thresholds, each market is a simple two-sided (yes/no) pool —
there's no open bucket-design question left here the way an earlier
draft of this doc implied.

## Chain: Vara Network

Target chain is **Vara Network** (Gear Protocol-based, Substrate,
actors/programs in Rust, typically via the `sails-rs` framework). Chosen
because Vara is actively courting builders/projects, not because of a
hard technical requirement — worth periodically re-confirming this is
still the right fit as the mechanism gets more concrete, since our actual
needs (oracle input, pooled staking, timed settlement, low fees) aren't
Vara-specific.

No market contract has been built yet — the pooled-stake escrow (a Gear
program holding a market's stakes and paying out by resolution logic,
not a hot wallet) is a later, separate phase once the market mechanism
(bucket design, fee structure, oracle trust model) is settled enough to
encode immutably. See below for what *has* shipped: per-user wallets.

## Wallets: on-site, non-custodial key generation

Every visitor gets a real Vara mainnet keypair generated in their own
browser — no wallet extension required, no server ever sees the key.
`web/src/lib/vara/`:

- `keyring.ts` — `generateWallet()` / `restoreWalletFromMnemonic()`,
  thin wrappers over `@gear-js/api`'s `GearKeyring` (itself a wrapper
  over `@polkadot/keyring` + `@polkadot/util-crypto` — the same sr25519
  machinery the Polkadot.js browser extension uses, confirmed by
  installing the real package and reading its shipped `.d.ts`/`.js`
  rather than guessing). Defaults to `VARA_SS58_FORMAT` (137)
  automatically. Restoring validates the pasted phrase with
  `mnemonicValidate()` (a real BIP39 checksum check) before deriving a
  keypair — **load-bearing, not defensive padding**: `addFromUri` (what
  `fromMnemonic` calls) accepts *any* string and silently derives *some*
  keypair from it via a raw-seed fallback, valid BIP39 or not. Skipping
  this check was caught while testing the restore flow with a garbage
  string: it didn't error, it silently produced a different, empty
  wallet — exactly the failure mode a "restore" feature must not have.
- `api.ts` — a shared `GearApi` connection to `wss://rpc.vara.network`
  (confirmed as the real mainnet endpoint against
  gear-foundation/vara-wallet's own `NETWORK_MAP`, not guessed) and
  `getBalance()`. Converts planck→VARA (1e12 per VARA, also confirmed
  against that same reference tool's `VARA_DECIMALS` rather than
  assumed) via BigInt division, not `Balance.toNumber()` — the latter
  silently breaks past `Number.MAX_SAFE_INTEGER` planck (~9046 VARA),
  which a real account balance can exceed.
- `deviceKey.ts` / `walletCache.ts` — the "browser remembers you"
  convenience layer, *not* the backup. A non-extractable AES-GCM
  `CryptoKey` lives in IndexedDB per browser profile; the mnemonic is
  encrypted with it before touching `localStorage`. Be precise about
  what this buys: it stops a *passive* read of storage (a backup dump,
  a devtools poke) from yielding a usable key, because no API can ever
  extract a non-extractable key's raw bytes back out. It does **not**
  stop an active XSS on this origin, which could just call this
  module's own encrypt/decrypt functions — no client-side scheme can
  defend against that; ordinary web security hygiene is what actually
  carries that risk.
- `walletDownload.ts` — triggers a local `.txt` file download of the
  seed phrase the moment a wallet is created. This is the one real
  backup. It is never stored anywhere retrievable, including by us —
  lose the file with an empty browser cache and the wallet is gone,
  same as any other self-custody wallet.
- `WalletProvider.tsx` — app-wide React context (`useWallet()`). Client-
  only by construction (`"use client"`, every operation touches
  browser-only APIs) — must never be imported into a server component,
  since it would break the static-export prerender (see "Hosting:
  GitHub Pages via Actions" below). On mount, tries to silently restore
  a cached wallet; falls back to showing "Create Wallet" if none exists
  or storage was cleared.

**The custody model, deliberately**: this is a non-custodial,
self-generated wallet, the same shape as any browser extension wallet
(we generate it, the user owns it, we never see the key again once it
leaves creation) — just generated in-page instead of in an extension.
The user is expected to secure their own downloaded seed phrase; this
is not a hosted/managed-key product. The much harder custody problem —
protecting the pool of every bettor's *staked* funds, which does need
real collective protection since it isn't any one person's key — is
explicitly out of scope here and deferred to the market-escrow contract
mentioned above.

**One real, known UI bug found and fixed while building this**:
`Header`'s `backdrop-blur-sm` (for the sticky-nav translucency effect)
makes it a CSS containing block for `position: fixed` descendants — any
modal rendered inside it gets clipped to the header bar's own ~69px
height instead of the viewport, rather than centering on the page.
Confirmed by inspecting the rendered `getBoundingClientRect()`, not
assumed from a screenshot. Fixed by portaling the restore-wallet modal
to `document.body` via `createPortal`, and by replacing the wallet
menu's and "wallet created" notice's full-screen backdrop-div
click-outside pattern (same underlying trap, `position: fixed`) with a
document-level `mousedown` listener instead, which doesn't depend on
any element spanning the viewport at all.

## Demo faucet: `faucet/`

Every new wallet starts at 0 VARA, and buying real VARA is real
friction for someone just trying the product. Gear runs its own
official mainnet faucet (100 VARA per wallet, inside `idea.gear-tech.io`)
-- confirmed by reading its actual backend source
(`gear-tech/gear-js`), not just the announcement -- but that service is
locked to Gear's own origin (Cloudflare-fronted, checks for their edge
headers) and its CAPTCHA key is theirs. Not something to embed or
route around; it exists for Gear's own site, not third-party dApps.

So this is our own small demo faucet instead, holding a dedicated
wallet the project funds separately (not for real financial risk --
"for the sake of demonstration"). The one hard constraint on the whole
design: **a signing key that pays out on request from the public
internet can never be client-side code.** Anything shipped to the
browser is fully readable by anyone who opens dev tools -- there is no
such thing as "hidden" JavaScript. So this needs a real backend, which
this site otherwise doesn't have (it's a static export, see "Hosting:
GitHub Pages via Actions" below).

**`faucet/` is a small, separate Cloudflare Worker**, not part of the
Next.js app:

- `src/index.ts` -- the public entry point. CORS locked to this site's
  origin, method/shape validation, and a coarse per-IP throttle (KV,
  1-hour TTL) as a first-line filter. None of this is the actual
  security boundary -- it's cheap noise reduction before a request
  reaches the part that is.
- `src/FaucetLedger.ts` -- a Durable Object, and the actual point of
  the design. Every claim, from anywhere, is forwarded to the *same
  named instance* (`idFromName("faucet")`), and Cloudflare guarantees
  a single DO instance processes requests strictly one at a time. That
  serialization is what makes two people clicking "Claim" at the same
  moment safe: no concurrent-access window where both could race the
  faucet wallet's on-chain nonce or double-claim the same address.
  It's also *why* the class doesn't need to track its own nonce
  counter -- asking the chain for the current nonce fresh on every
  claim is already race-free once only one request is ever in flight.
  Address claims are canonicalized (`decodeAddress`) before being
  checked against the DO's own storage, so re-encoding the same SS58
  address differently can't claim twice. SQLite-backed Durable Objects
  specifically (the `new_sqlite_classes` migration, not the older
  KV-backed storage class) -- confirmed that variant is available on
  Cloudflare's free plan before choosing this design, not assumed.
  Also enforces a configurable reserve floor (`MIN_RESERVE_VARA`) so
  the faucet can't be drained to dust by a burst of legitimate-looking
  claims, and a `FAUCET_PAUSED` flag as an emergency stop that doesn't
  need a redeploy.

**Where the key actually lives**: `FAUCET_MNEMONIC` is a Cloudflare
Worker secret, set once via `wrangler secret put` directly by whoever
holds it, logged into their own Cloudflare account. It is deliberately
never a GitHub secret and never appears in a CI run --
`.github/workflows/deploy-faucet.yml` deploys the Worker's *code* using
a separate `CLOUDFLARE_API_TOKEN` that can push a new script but has
no way to read or set the wallet's key. Fewer systems that ever see
the plaintext key is strictly safer than one more automated hop, even
a reputable one.

Real limits of this v1, stated plainly rather than implied to be
solved: no CAPTCHA (Gear's own faucet uses Cloudflare Turnstile; this
one relies on per-address-ever + coarse per-IP throttling only, which
is proportionate to "small, funded for a demo" but would need
Turnstile added if this ever needed to withstand real targeted abuse
at scale). CORS-origin checking is a speed bump, not a wall -- a
determined caller can still hit the Worker directly with curl; the
per-address dedup is what actually bounds the damage, not the origin
check.

**One-time setup this depends on** (all outside this repo, and
undocumented anywhere else, so recorded here in full):

1. A Cloudflare account, with a Workers KV namespace created for the
   `IP_THROTTLE` binding (`wrangler kv namespace create IP_THROTTLE`,
   or via the dashboard) -- its id set as the
   `CLOUDFLARE_KV_NAMESPACE_ID` GitHub Actions **variable** (not
   secret; a namespace id isn't sensitive).
2. A Cloudflare API token (Workers Scripts: Edit permission) as the
   `CLOUDFLARE_API_TOKEN` GitHub **secret**, and the account ID as
   `CLOUDFLARE_ACCOUNT_ID`.
3. `wrangler secret put FAUCET_MNEMONIC` run once, directly, by
   whoever holds the faucet wallet's seed phrase -- separate from steps
   1-2, never via CI.
4. Once deployed, the Worker's URL (`wrangler deploy`'s own output, or
   the Cloudflare dashboard) set as the `NEXT_PUBLIC_FAUCET_URL`
   GitHub Actions variable that `deploy-web.yml` bakes into the site
   build. Until this is set, `WalletButton`'s claim section simply
   doesn't render -- a missing faucet is a handled, normal state, not
   a broken one.

## Data source: the unofficial FPL API

FPL has no official public API, but a small set of unauthenticated,
read-only JSON endpoints under `fantasy.premierleague.com/api/` have been
stable for years and are what the whole community-tooling ecosystem
(`vaastav/Fantasy-Premier-League`, `amosbastian/fpl`, etc.) is built on:

- `bootstrap-static/` — all players, teams, gameweeks, current prices
- `fixtures/` — the full fixture list
- `event/{id}/live/` — per-player stats (points, minutes, ...) for one
  specific gameweek, live during play and final afterwards

Important constraint: this API only ever reflects **current** state.
There's no endpoint that hands back "what GW4 looked like" once GW9 has
happened. That means **we have to snapshot it ourselves over time** to
build any history — there is no way to backfill later. This is the whole
reason the pipeline is snapshot/cache-based rather than fetch-on-demand.

### Player photos and team badges

For the frontend: player photos and team badges do **not** need a new
fetch. `bootstrap-static` already carries a stable `code` per player
and per team (a different field from the season-relative `id` used
everywhere else for team lookups), and the pipeline already caches
that snapshot. `data_pipeline/media.py` turns those into CDN URLs:

```python
player.photo_url                                  # None if has_temporary_code
team_badge_url(team_code_for_id(bootstrap, team_id))
```

**Verified against FPL's own production frontend**, not just assumed —
via a one-off GitHub Actions job (GitHub's runners have real internet;
this sandbox doesn't) that fetched fantasy.premierleague.com's live
frontend bundle and read the actual source. Two findings:

1. FPL's frontend keys photo URLs on `elements[].code`, not by parsing
   the `photo` filename field the way this repo (and the wider
   community tooling — vaastav/Fantasy-Premier-League,
   amosbastian/fpl, neither of which actually builds a photo URL
   itself) used to. `code` and the numeric prefix of `photo` are
   identical for every player in the checked snapshot today, but
   `code` is what FPL's own code actually reads, so `Player` and the
   TS `Player`/`BootstrapElement` types now carry `code` (and
   `has_temporary_code`) instead of the raw `photo` string.
2. FPL's frontend actually requests a *different, fresher* path —
   `resources.premierleague.com/premierleague25/photos/players/...` —
   than the one this repo uses. Confirmed the legacy path really is
   stale, not just assumed: a fetched photo came back with
   `last-modified: Fri, 16 Aug 2024`. But the fresher `premierleague25`
   path 403s on every unauthenticated request, including with
   `Referer`/`Origin` spoofed to FPL's own — the response carries
   `access-control-allow-credentials: true`, the signature of a path
   gated behind a logged-in session's cookies, not a header we can
   copy. There's no known way to reach it without a real FPL user's
   session, which an anonymous public site can't obtain or ethically
   fake.

Net effect: the legacy `/premierleague/...` path is not a bug to fix,
it's confirmed to be the only path actually reachable by an
unauthenticated request. Some player photos will stay stale versus
what a logged-in FPL user sees, with no accessible fix from here —
revisit if FPL ever opens the fresher path without requiring login.

Separately, `has_temporary_code` (also on `elements[]`) is true for
brand-new signings FPL doesn't have a real photo for yet — `photo_url`
returns `None`/`null` for those rather than guessing at an unverified
placeholder path on the (also gated) fresher endpoint. The frontend's
`PlayerPhoto` component renders an honest placeholder icon in that
case instead of passing `null` to `next/image`.

## What's built so far: `data_pipeline/`

A small, dependency-light Python package:

- `fpl_client.py` — HTTP wrapper for the three endpoints above (retries,
  timeout, a real User-Agent).
- `cache.py` — writes every fetch as a timestamped JSON snapshot under
  `data/cache/`, plus a `latest.json` per source/gameweek. This *is* our
  history — treat `data/cache/` as an append-only local database, not a
  throwaway cache. It's gitignored (grows unbounded) — back it up
  separately once this is running for real, or point it at a proper store
  later.
- `players.py` — `top_expensive_players()`: the top-N by current price,
  tie-broken by season points then id. `Player.photo_url` gives each
  one's CDN photo URL (see "Player photos and team badges" above).
- `settlement.py` — the *raw* facts for a single gameweek:
  `points_result()` (that gameweek's points, plus `.over(5)` /
  `.over(10)` for the two market lines) and `full90_result()` (minutes
  + played-full-90 boolean). These read whatever snapshot is cached,
  even mid-match — they do not know whether the match is actually over.
- `resolution.py` — the payout-safe layer on top: `resolve_points_threshold()`
  and `resolve_full90()` return `PENDING` / `YES` / `NO`, and never
  return YES/NO until the underlying fixture is confirmed `finished` in
  the cached fixtures data (cross-referenced by player → team → fixture
  for that gameweek). See "Market resolution" below — this is where the
  full-90 / stoppage-time question lives.
- `cli.py` — `fetch-bootstrap` / `fetch-fixtures` / `fetch-live <gw>` to
  populate the cache; `top20` / `points` / `full90` to read the raw
  cached stats; `resolve-points` / `resolve-full90` to get the
  payout-safe PENDING/YES/NO a market should actually act on.

Deliberately **not** built yet: a real database (JSON files are fine at
this scale and are trivially inspectable/diffable), any market or
staking logic, any chain integration.

### Known constraint: sandboxed dev environments may not have internet access

This was built and unit-tested from an environment whose network policy
blocks `fantasy.premierleague.com` outright — confirmed via direct
connection attempts. The client, cache, and settlement logic are all
tested against realistic fixture data in `tests/fixtures/`, but the
`fetch-*` CLI commands have not been run against the live API from this
environment. Run them from somewhere with open egress (a laptop, CI, a
normal server) before trusting live data end-to-end.

## AI agent picks & leaderboard: `data_pipeline/agents.py`, `leaderboard.py`

Five top-tier models, one per lab (OpenAI, Anthropic, Google, xAI,
DeepSeek — via [OpenRouter](https://openrouter.ai)), are each given the
same snapshot of FPL data and asked to predict the same points-threshold
markets `resolution.py` already knows how to settle. A leaderboard tracks
how often each one was right, gameweek over gameweek.

Deliberately narrow, per an explicit scoping decision: this is picks +
leaderboard only. No matchmaking, no assignment of agents to specific
markets, no stakes — every model is asked about the same player pool,
every time, and the leaderboard is just "were they right", not a wagering
mechanism.

- **`agents.py`** — the "ask the models" half.
  - `AGENT_MODELS`: five `AgentModel(slug, name)` entries, one per lab.
    Prefers OpenRouter's self-updating `~lab/model-latest` aliases where
    offered (OpenAI, Anthropic, Google) — these silently re-point to each
    lab's new flagship, so the list doesn't quietly go stale the way a
    dated slug eventually does. xAI and DeepSeek don't offer that alias
    style at time of writing, so those two are pinned to explicit dated
    slugs instead.
  - `build_prompt()` — the exact same prompt for every model: the top-N
    most expensive players (`players.top_expensive_players`), each one's
    opponent for the target gameweek (derived from the cached fixture
    list, including blank/double-gameweek cases), price, and season
    points so far. Asks for a single JSON object back — a `pick` (yes/no)
    and `confidence` per (player, threshold) pair.
  - `call_model()` — one HTTP call to OpenRouter's OpenAI-compatible
    `/chat/completions` endpoint. Raises `OpenRouterError` on any
    failure; never fabricates a fallback reply.
  - `parse_picks()` — defensively parses a model's JSON reply. A
    malformed reply, an out-of-pool player id, an unknown threshold, or
    a non-yes/no pick value is dropped, never guessed at — a model that
    returns garbage just yields fewer picks, never a wrong or invented
    one. Tolerates markdown code fences some models wrap JSON in despite
    being told not to.
  - `generate_picks_for_gameweek()` — orchestrates the above across all
    five models for one gameweek. One model erroring out (bad slug,
    outage, garbled reply) is caught and recorded per-model — it never
    blocks the other four from producing their picks.
  - `save_picks()` / `load_picks()` — persist to (read from)
    `data/agent_picks/gw<N>.json`. This is a committed, versioned record
    (see `.gitignore` — only `data/cache/*` is excluded), not a cache: a
    pick, once made and saved, is never silently regenerated or
    overwritten by a later run (`auto-generate-picks` skips a gameweek
    that already has a saved file unless told `--force`).
- **`leaderboard.py`** — the "were they right" half. Has no resolution
  logic of its own: `score_gameweek()` calls straight into
  `resolution.py`'s `is_gameweek_finished()` / `resolve_points_threshold()`
  — the same payout-safe state machine everything else in this pipeline
  settles against — and refuses to score a gameweek that isn't finished
  yet, for the same reason a market wouldn't pay out early. `
  update_leaderboard()` folds one gameweek's score into
  `data/leaderboard.json`, keyed by gameweek plus a running `totals` per
  model; re-scoring an already-scored gameweek (e.g. after a late
  bonus-points correction) replaces that gameweek's entry and recomputes
  totals from scratch rather than double-counting it.
- **CLI** (`cli.py`): `generate-picks --gw N` / `score-gameweek --gw N`
  target an explicit gameweek by hand. `auto-generate-picks` /
  `auto-score` are what the scheduled workflow actually calls:
  the first targets whichever gameweek's deadline (`events[].deadline_time`
  from bootstrap-static) hasn't passed yet; the second scores every
  gameweek that has saved picks but isn't in the leaderboard yet. Both
  are safe no-ops most runs — nothing to pick yet, nothing newly finished
  to score — so the workflow (`.github/workflows/agent-picks.yml`) just
  runs on a schedule rather than needing to be timed precisely to a
  deadline or a final whistle.

**Security**: `OPENROUTER_API_KEY` is a GitHub Actions secret the repo
owner adds directly (Settings → Secrets and variables → Actions), the
same discipline as the faucet's wallet key above — never pasted into
chat, never committed, used server-side only inside the workflow, never
shipped into the static frontend build.

**Verification discipline**: this sandbox can't reach `openrouter.ai`
directly (same egress restriction as `vara.network` / `gear-tech.io` —
confirmed via a direct blocked connection attempt), so the five model
slugs above were sourced from OpenRouter's own published model
reference rather than tested locally. Before relying on them further,
run `generate-picks` once via the real workflow (GitHub's runners have
open egress) and check each model actually resolved and replied — a
renamed or retired slug shows up as that one model's `error` field, not
a pipeline-wide failure, but is still worth fixing promptly rather than
carrying a permanently-erroring model on the leaderboard.

## Frontend: `web/`

A Next.js 16 app (TypeScript, Tailwind v4, App Router) — the "Overline"
hero design direction from the earlier design-canvas mockup, now as real
code instead of a static mockup. The mockup's images were placeholder
geometric silhouettes because a design canvas can only ever show
*embedded* images (strict sandbox, no external network). A real
Next.js app running in a real browser has no such restriction — that's
the whole reason to move here rather than keep polishing the mockup.

- `src/lib/fpl.ts` — deliberately mirrors `data_pipeline/players.py` /
  `media.py`: `fetchBootstrapStatic()`, `topExpensivePlayers()`,
  `playerPhotoUrl()`, `teamBadgeUrl()`, `teamCodeForId()`. Same names,
  same logic, same verified findings and caveats (see "Player photos
  and team badges" above).
  **This duplication (FPL-parsing logic in both Python and TypeScript)
  is a known, deliberate short-term shortcut** — the frontend currently
  fetches FPL data directly rather than through a backend. Once a
  backend API exists wrapping `data_pipeline`'s settlement/resolution
  logic for actual market data, this file's *fetching* should be
  replaced by calls to that backend, so FPL-parsing lives in one place,
  not two. The pure URL-building functions are harmless to keep either
  way.
Full page, not just the hero:

- `src/components/Header.tsx` — sticky nav: wordmark, Markets / How it
  works links, a "Vara Network" chip, a Connect Wallet button (not
  wired to anything yet — no wallet integration exists).
- `src/components/Hero.tsx` — the pitch: headline, CTA, and (when
  player data loaded) a stacked photo-card preview of a few players.
  Renders correctly with zero players too — the image column doesn't
  reserve space it isn't using, so the fail-soft state doesn't leave a
  blank gap on mobile (an actual bug caught and fixed this pass).
- `src/components/MarketsSection.tsx` — the actual product surface: a
  grid of player cards (photo, position, team badge, name, price) each
  with two market buttons ("Over 5 pts" / "Over 10 pts"). Deliberately
  shows **no fabricated odds or pool sizes** — there's no staking
  backend yet, so every card says "Pool opens at kickoff" rather than
  inventing numbers that would look live but aren't. Renders an honest
  "Markets unavailable" empty state when player data fails to load.
- `src/components/HowItWorks.tsx` — three-step explainer (pick a
  market → stake your side → settled on-chain), static content.
- `src/components/Footer.tsx` — brand recap, nav links, a one-line
  disclaimer.
- `src/components/BrandMark.tsx` — the angular ring mark and the
  network glyph, shared by Header/Footer/Hero (previously duplicated
  across files; consolidated here).
- `src/app/page.tsx` — fetches bootstrap-static server-side once,
  shapes it for both the hero (first 3 players) and the markets grid
  (top 8). **Fails soft**: FPL being unreachable or down renders empty
  states rather than crashing the page — verified in this sandbox,
  where the fetch reliably 403s (same egress block as the Python
  pipeline) and the page still builds and renders correctly throughout.
- Brand tokens (background/foreground/accent colors, the two Google
  Fonts) live in `src/app/globals.css`'s `@theme` block and
  `src/app/layout.tsx` — Big Shoulders (display/headline) + Space
  Grotesk (body), matching the mockup.

Verified in this sandbox: `npm run build`, `npm run lint`, and real
rendered screenshots (desktop + mobile, both the fail-soft empty state
and — with local placeholder images swapped in temporarily to work
around this sandbox's network block, then reverted before committing —
the fully populated state) via a local dev server. That process caught
and fixed two real bugs before they shipped: the mobile empty-state gap
above, and a vertical card stagger in the hero that made one player's
name collide with the card stacked in front of it. Real player photos
themselves could not be verified end-to-end here since FPL is
unreachable — that needs checking from an environment with real
internet before this is trusted in production.

### Hosting: GitHub Pages via Actions

`.github/workflows/deploy-web.yml` builds `web/` as a static export and
publishes it to GitHub Pages on every push that touches `web/`. Chosen
over Vercel (the more natural fit for Next.js) purely because it needed
no new account or credentials to set up from this sandbox — GitHub was
already available, Vercel's API is blocked by the same egress policy
that blocks the FPL API.

This is also the first real end-to-end check of the FPL image URLs:
GitHub's own Actions runners have normal internet access, unlike this
dev sandbox, so a successful deploy run is the confirmation
`src/lib/fpl.ts`'s CDN URL pattern was missing until now (see "Player
photos and team badges" above).

Static export means some real tradeoffs vs. a normal Next.js
deployment, gated behind a `GITHUB_PAGES` env var in `next.config.ts`
so local dev and a plain `npm run build` are unaffected:

- `output: "export"` — no server at runtime, so player/market data is
  fetched once at *build* time, not per request. It only updates on
  the next push (or a manual workflow run) — not truly live.
- `basePath: "/fpl"` — GitHub Pages project sites serve at
  `<owner>.github.io/<repo>/`, not the domain root.
- `images.unoptimized: true` — no server means no image optimization
  API; `next/image` still works, just serves the source CDN URL
  directly rather than a resized/re-encoded one.

None of this is the intended production setup — it's the fastest path
to a real, live, inspectable URL without new infrastructure. Revisit
once real hosting (Vercel, or wherever the eventual backend lives) is
set up for real, since that removes all three tradeoffs above.

The deploy also runs on a schedule (hourly, `.github/workflows/deploy-web.yml`)
so the static snapshot doesn't go stale for days between pushes —
still a snapshot, not truly live, just a fresher one. Started at every
6 hours; tightened to hourly after a real gap surfaced (a full
gameweek finished and stayed showing as "still to play" for over a
day, because nothing had pushed since). FPL has no webhook — polling
on a schedule and trusting each fixture's own `finished` flag is the
only lever available until there's a real backend; hourly just shrinks
the gap between a match ending and the site reflecting it, it doesn't
close it to zero.

**One-time manual step this took**: the workflow's own token can
deploy to Pages once a Pages site exists, but can't create one for the
first time via the API (`configure-pages`'s `enablement: true` still
hit "Resource not accessible by integration" on a repo that had never
had Pages touched). Fixed by the repo owner visiting Settings → Pages
once and setting Source to "GitHub Actions" — after that, every deploy
(push-triggered, scheduled, or manual) works with no further manual
steps.

**Player photos vs. site freshness — two different things.** If a
specific player's photo looks outdated, that's not the scheduled
rebuild's problem to fix. Confirmed by actually reading FPL's own
frontend bundle (see "Player photos and team badges" above):
`fantasy.premierleague.com` itself requests a *fresher* asset than the
one this site can reach — `resources.premierleague.com/premierleague25/...`
— but that path only serves a logged-in user's session, and 403s on
every unauthenticated request we tried (Referer/Origin spoofing
included). The legacy path this site uses is the only one that's
actually publicly reachable, and it's confirmed stale for at least
some players. New signings and youth-team graduates can also go a
while with no real photo at all upstream (`has_temporary_code`),
which we render as an honest placeholder rather than guessing at a
URL. The scheduled rebuild above fixes the *other* kind of "old" — the
static snapshot itself being stale — but not this one; there's
currently no accessible fix for genuinely outdated upstream photos
short of FPL opening the fresher path to anonymous requests.

### Opponent context in the markets grid

Each market card shows who the player's team is playing next — badge
+ short name + home ("vs") or away ("@") — since that's directly
relevant to whether they'll clear a points threshold, not just
decoration.

This is deliberately **per-team, not tied to one shared "current
gameweek"**. The first version picked one gameweek for the whole page
(`bootstrap-static`'s `events[].is_current`, falling back to
`is_next`) and looked up every team's fixture within it — which is a
real bug, not just a stale-photo complaint: `is_current` stays true
for an *entire* gameweek until every match in it has finished, but
teams play on different days within it (Friday through Monday). A team
whose match had already been played kept showing that finished match
as their "opponent" until every other team's match that gameweek also
wrapped up, days later. `nextFixtureForTeam()` fixes this by looking
up each team's own earliest not-yet-finished fixture directly (sorted
by kickoff time) — it self-corrects the moment that team's match ends,
independent of what any other team is doing. Verified against the
exact bug scenario (a team with a finished match earlier in the
current gameweek and a scheduled one next gameweek) with a standalone
test before shipping.

A team with no unplayed fixture in the data at all (end of season, or
next gameweek's fixtures not yet published) resolves to `null` —
shown honestly as "No fixture" rather than guessing.

### Stat count-up animation

The "broadcast graphic" touch requested — every real Premier League
game has these on-screen — built as our own motion-design on top of
real data, not licensed match footage (there's no free/public API for
that, and the Premier League tightly controls broadcast clips). Two
places:

- Each market card gets a Pts / Goals / Assists strip that rolls up
  from 0 to the player's real season-to-date stats the moment the card
  scrolls into view.
- Each Hero card gets a small Pts badge on the photo, same effect.

`total_points`, `goals_scored`, `assists` were already sitting unused
in every `bootstrap-static` element — no new fetch, same as the photo
fields. Added to `Player` in both `data_pipeline/players.py` and
`web/src/lib/fpl.ts`, kept mirrored per the usual convention.

`StatCountUp` (`web/src/components/StatCountUp.tsx`) is a small client
component: an `IntersectionObserver` fires the animation once, the
first time the number scrolls into view (not on every scroll back into
frame), via `requestAnimationFrame` with an ease-out curve. Respects
`prefers-reduced-motion` — jumps straight to the final value via a
lazy `useState` initializer rather than animating, which also avoids
the "setState synchronously in an effect" lint rule (`react-hooks/set-state-in-effect`)
that a naive `useEffect`-based check would trip.

Verified by screenshotting the effect mid-flight (partial numbers,
e.g. 88 pts) against the settled state (the real 210) with mock data
via a local dev server, same pattern as the other UI verifications in
this doc — not just "it compiles."

## Open items (not yet decided)

- **Fee structure** for the parimutuel pool.
- **Oracle trust model**: who/what pushes the settlement facts on-chain,
  and how is that trusted/verified? (This is the actual crux of "off-chain
  data pipeline → on-chain market" and hasn't been designed yet.)
- **AI agent interface**: how do AI models place positions — direct
  wallet/contract calls, an API layer, something else?
- **Regulatory/compliance**: real-money stakes were chosen over play-money
  or testnet tokens. That means gambling licensing, KYC/AML, and
  jurisdiction geofencing (see e.g. Polymarket blocking US users) are real
  workstreams, not afterthoughts, and should run in parallel with — not
  after — the technical build. Not addressed by anything in this repo yet.
- **Vara contract design**: not started. Depends on the mechanism/oracle
  decisions above being settled first.
