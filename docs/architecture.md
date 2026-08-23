# Architecture & decisions

This doc exists so future sessions (human or AI) don't have to re-derive
context from a chat log. It's a living document — update it when a
decision below changes, and add to it as new layers get designed.

## The idea

A prediction market on Fantasy Premier League outcomes. Both AI models and
humans can take positions. Two seed markets, more layers later:

1. **Points tally** — how many FPL points a player scores over a
   gameweek window. Two variants on the same underlying number:
   - **Primary market**: next 5 gameweeks
   - **Secondary market**: next 10 gameweeks
2. **Full 90** — yes/no, did the player play all 90 minutes, evaluated
   per gameweek.

**Player pool (v0):** the 20 most expensive players by current FPL
price, for both markets. Expensive players are the ones with public
attention and an audience willing to have an opinion — narrows scope
enough to ship something, without pretending it's the final scope.
Expected to expand (more players, more stat types, maybe assists/
clean-sheets/cards) once the mechanism is proven.

## Market mechanism: parimutuel, not a sportsbook

Explicitly **not** fixed-odds — we are not the house and don't want to
carry the other side of every bet. Mechanism is **parimutuel pooling**:

- Bettors stake into buckets for a given market (e.g. "Haaland scores
  0–5 / 6–10 / 11+ points over GW10–14").
- The pool per bucket determines the implied odds — there is no admin-set
  price, the crowd's stake distribution *is* the price.
- After the window resolves (using the settlement facts from the data
  pipeline), the losing buckets' stakes are redistributed pro-rata to the
  winning bucket, minus whatever protocol fee we decide on.
- No liquidity provider needed, no house risk, and resolution is
  objective — it comes from real match data, not a model's opinion.

**Open question, not yet decided:** how buckets are defined for the
points-tally market (fixed thresholds set in advance vs. a continuous/
pari-mutuel-over-a-distribution design) still needs to be worked out. The
data pipeline is deliberately decoupled from this choice — it just
produces "player X scored N points over gameweeks [a, b)", and whatever
bucket scheme we land on consumes that number.

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
- `settlement.py` — the facts markets actually resolve against:
  `points_tally()` (sum of points over a gameweek window, flagged
  `is_complete` iff every gameweek in the window has been cached) and
  `full90_results()` (per-gameweek minutes + played-full-90 boolean).
- `cli.py` — `fetch-bootstrap` / `fetch-fixtures` / `fetch-live <gw>` to
  populate the cache, `top20` / `tally` / `full90` to read it back.

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

- **Bucket/threshold design** for the points-tally market.
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
