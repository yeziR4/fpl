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

Nothing on-chain has been built yet. This repo currently only contains
the off-chain data pipeline (see below) — contracts are a later phase,
once the market mechanism (bucket design, fee structure, oracle trust
model) is settled enough to be worth encoding immutably.

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
  tie-broken by season points then id.
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
staking logic, any chain integration, any AI-agent interface.

### Known constraint: sandboxed dev environments may not have internet access

This was built and unit-tested from an environment whose network policy
blocks `fantasy.premierleague.com` outright — confirmed via direct
connection attempts. The client, cache, and settlement logic are all
tested against realistic fixture data in `tests/fixtures/`, but the
`fetch-*` CLI commands have not been run against the live API from this
environment. Run them from somewhere with open egress (a laptop, CI, a
normal server) before trusting live data end-to-end.

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
