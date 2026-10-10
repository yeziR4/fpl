# Overline — submission

**Colosseum Crypto World's Fair · Panta API Sidetrack**

- **Live demo:** https://fpl-y1ck.vercel.app/
- **Repository:** https://github.com/yeziR4/fpl (branch `solana-panta-port`)
- **Demo video:** _[link — to be recorded]_
- **Colosseum submission:** _[link — to be added]_

---

## What it is, in one sentence

Five frontier AI models and a set of public forecasters priced the same three
Fantasy Premier League markets with real money, their reasoning recorded before
kickoff and every position settled on chain through Panta.

## The problem

**Forecasts are scored after the fact, which makes it easy to remember being
right.** An AI benchmark normally measures an answer in a vacuum: no cost to
being wrong, no price to beat, no consequence that survives the scoring. That
makes calibration — the thing that actually distinguishes a forecast from a
confident guess — unmeasurable.

Prediction markets already solve the scoring problem. What they do not do is
record what a participant *believed* before the outcome was known, in a way that
can be compared across participants. A price tells you what the crowd concluded.
It does not tell you who disagreed, or why, or how sure they were.

## The solution

**Every participant gets their own wallet, real money, and the live market
price in front of them.**

- Each of five frontier models is given an identical prompt: the same markets,
  the same pool prices, the same player data, and the same $5 bankroll.
- Each states a **probability** and a **reason**, then trades **its own Solana
  wallet** on Panta. A model's P&L is therefore a fact about the chain rather
  than a row in our own ledger — on an earlier version of this project it *was*
  a row in our own ledger, and the difference matters.
- Public forecasters are recorded the same way, from what they say openly.
- Nothing is settled by us. Panta resolves against the official FPL data and
  pays out on chain.

The page is where the evidence lives; **the betting happens on Panta**. We do
not take bets and we do not run a book.

## How the Panta API is integrated

The full quote → build → sign → broadcast → verify flow, plus market creation.

| Step | Endpoint | Notes |
|---|---|---|
| Create market | `POST /marketquote/` → `/marketbuild/` → `/marketregister/` | Two of the three live markets are *breaking* markets, created by this project |
| Read the price | `POST /primaryorderquote/` | **The only way to read a price.** Every price field on the market object is null, and `primaryVolume` reads `0.0` |
| Trade | `POST /primaryorderquote/` → `/primaryorderbuild/` → `/primaryordersubmit/` → `/primaryorderverify/` | Signed locally, broadcast on our own Solana RPC, then registered |
| Positions | `GET /positions/` | See the caveat below |

Three integration findings we hit and worked around, offered as feedback:

1. **`create` returns an assembled `VersionedTransaction`; `buy` returns bare
   instructions the client must compile.** That asymmetry is the single biggest
   trap in the API, and it is not documented as a difference.
2. **Read paths disagree with the chain.** `/account/trades/` recorded four
   trades where the agent balances prove ten executed, and `/positions/`
   returns nothing for a wallet that *bought* (it works for the wallet that
   *created* the market). We treat wallet balances as ground truth.
3. **`INVALID_MARKET_PARAMS` is transient roughly half the time** — with no
   `fields`, on well-formed requests, sometimes five calls in a row. We retry it
   with backoff, and distinguish it from the genuine error of the same name by
   the absence of `fields`.

## What was built during the hackathon

- A typed Panta client with transient-failure retry and rate-limit backoff.
- A market generator that scores candidate player/line combinations on how
  evenly the crowd would split — because Panta's creator royalty scales with
  tilt, so a line everybody agrees on pays nothing and a line nobody has a view
  on never trades. Three markets were created from it.
- Five isolated agent wallets, one per lab, each with its own bankroll.
- A forecasting harness that gives five models an identical prompt and records
  probability, reasoning, and the price at decision time.
- A trader that places those forecasts as real positions, with idempotency.
- A wallet-per-human onboarding path for public forecasters.
- The research page itself.

## Traction

Real, verifiable, and small enough to check in full:

- **47 replies** to the launch post from public forecasters.
- **10 human calls** recorded verbatim, from 10 named accounts.
- **6 of those funded and placed on chain** at $3.00 each, with a wallet per
  person and a transaction per position.
- **16 positions on chain** in total — 10 from the five models, 6 from humans.
- **$30.10 of capital committed** across three live markets on Solana mainnet.

## The finding, which we did not expect

On the Haaland market the two groups ended up on **opposite sides of the same
parimutuel pool**:

```
AGENTS   NO   $3.80    (Claude $1.50, Gemini $1.50, GPT $0.80)
AGENTS   YES  $1.20    (Grok)
HUMANS   YES $18.00    (six callers at $3.00)
```

**Ten human calls. All ten were YES.** Nine of the ten agent positions were NO.

And then this, which the chain recorded as the orders went in:

```
first human call    5.981804 shares @ 0.501520
second              5.923219 shares @ 0.506481
third               5.866322 shares @ 0.511393
fourth              5.811034 shares @ 0.516259
fifth               5.757280 shares @ 0.521079
sixth               5.704991 shares @ 0.525855
```

**The price rose with every order.** Eighteen dollars of YES hitting a thin pool
is real price impact, so the first caller got a materially better price than the
sixth for saying exactly the same thing — and none of them could have known that
when they typed it.

Which produces the asymmetry that is the actual result:

```
if YES wins   risk $19.20 to collect $23.00   =  +$3.80    (+19.8%)
if NO wins    risk  $3.80 to collect $23.00   = +$19.20    (+505%)
```

**Six people independently reached the same conclusion, and by doing so they
turned a coin flip into a bet that pays 20% when right.** In a parimutuel pool
every additional person on your side is a competitor, not an ally. A poll would
have read their agreement as a signal — six out of six say Haaland scores. The
market charged them for it.

That is the case for prediction-market infrastructure over a poll, and it is a
result about *markets*, not about AI. It only appeared because real money was
behind the calls.

## Honest limitations

Stated because the submission is worth less without them, and because the rules
disqualify fabricated results — a claim we can only make safely by not making
false ones.

- **The human side was staked by us, not by them.** Every model risks its own
  bankroll; the human callers risked nothing to make their calls. A forecast with
  no cost behind it is weaker evidence than one with money on it, and the page
  says so where a reader will see it.
- **The human callers gave a side, not a probability.** So they can be scored on
  direction and not on calibration. The next round asks for confidence.
- **One gameweek of data.** The unanimity above is one observation. It is a
  hypothesis for the next round, not a finding about human judgement.
- **We are the custodian of the human wallets.** Losing a key would cost a named
  person their winnings, and the code says so at every step that touches them.
- **One market named the wrong oracle source.** Our first three markets named two
  FPL endpoints; one of them returns *season* totals, and an agent reading it
  would have resolved every market YES. Later markets name the gameweek endpoint
  alone and say "the gameweek figure, not season totals" in the resolution rule.

## Why it is worth continuing past the hackathon

The mechanic generalises and the audience already showed up. Each gameweek is a
repeating head-to-head with a running score that nobody has to maintain, because
the chain settles it. The next rounds add more markets, more models as they ship,
and human callers who stake their own money — which turns the weakest part of
this submission into the strongest.

Prediction markets are usually experienced as a destination. This is what they
look like as a **measurement instrument**: a way to find out what a model
actually believes, at a price, with consequences.
