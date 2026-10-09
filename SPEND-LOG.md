# Panta spend log

Every non-refundable USDC spent on this project, plus the SOL that market creation
consumes as account rent. This is both the expense evidence and the prior-work
disclosure for the Colosseum, Panta, Nigeria and Solami submissions.

**Total spent: 60.00 USDC** and **~0.067 SOL** of rent across three markets.

---

## The live markets

All three are on Solana mainnet, created by this project, and were tradable by
anyone from the moment they registered.

| Market | marketId | Kickoff | Fee |
|---|---|---|---|
| Saka 7+ points, GW6 | `C86nbpSX4ntRWvN4HMrdnhzHjHTtLooNtnw6k7hnmx1F` | 10 Oct 11:30Z | 20.00 |
| João Pedro 8+ points, GW6 | `HLPNPsoRDk36jGF1FqtBENmEq3NRFgMe1wpSos2QyQBq` | 10 Oct 14:00Z | 20.00 |
| Haaland 8+ points, GW6 | `GM2wvtGY5HaG3T4DiVnJTDXsScZLMc9JU9ABzSRGUvKn` | 11 Oct 15:30Z | 20.00 |

Each is a **breaking** market at the calibrated line for its position, created
inside Panta's 72h window so it cost 20 USDC rather than the 50 USDC a standard
market costs.

---

## 2026-10-07 11:55Z — Saka 7+ points, GW6

| | |
|---|---|
| **createId** | `cr_f422454279ff4ce2b604db78b9254fd8` |
| **signature** | `B3KXk2DC5PW9nbyNCP5y4fmutD6uPMD5Z3rfxZV86xgZCTT2PpSr4d3cRQcVms7SZ6ARNxRW83qUKUCbxunZPuT` |
| **fee** | 20.00 USDC (5.00 seeds liquidity, 15.00 platform revenue) |
| **question** | Will Bukayo Saka score 7 or more Fantasy Premier League points in Gameweek 6 (Arsenal v Leeds)? |
| **creator** | `65YstDRZo7KXqtwFifypnFNiSKh2VGGh8bXNCSqNcyyM` |

**Why this market.** The first fixture to enter Panta's 72h breaking window, so
it was legitimately a 20 USDC market rather than a 50 USDC one. Midfielder at
the calibrated 7+ line: measured over every finished gameweek this season,
top-20-by-price midfielders clear 7+ in 28.7% of appearances, implying ~71% NO
tilt and therefore the full 20% creator royalty band.

**Notable.** The build step hit Panta's transient failure three times and the
register step once before succeeding. At the original 3-attempt limit this
transaction would have failed.

**Also notable, and wrong.** Its `endTime` was set to full time rather than
kickoff, so trading on it runs during the match. That is a fairness hole in the
spec and it cannot be changed on a market that already exists. Markets 2 and 3
open their window an hour before kickoff and close it AT kickoff, so trading
stops before the whistle.

**Context.** At the time of creation the live Panta catalog contained **zero
primary markets**. This was the first one this project created.

---

## 2026-10-09 14:03Z — João Pedro 8+ points, GW6

| | |
|---|---|
| **createId** | `cr_5f45b662246e469d9765f2eac2688286` |
| **signature** | `5ej5GyLihbtXG5o2PuQHZue1QG6WXmbqm9sFjza9HoU5KMPYhbUH277wNDvzfTXsw4bp9ndggkYAc6xjJeW4Q3K3` |
| **fee** | 20.00 USDC |
| **question** | Will João Pedro score 8 or more Fantasy Premier League points in Gameweek 6 (Chelsea v Bournemouth)? |
| **trading window** | 10 Oct 13:00Z → 14:00Z (closes at kickoff) |

## 2026-10-09 14:03Z — Haaland 8+ points, GW6

| | |
|---|---|
| **createId** | `cr_b1a013b3dcf0420281470ab567dff856` |
| **signature** | `3UoBD1jB3XYHdUjbxSGitAGKx35wM8LmPk6M46H7dkchRwPkoQDjGKXCPcSfkFJSi1QzNLBG3P9RkqdT7XM57Tvk` |
| **fee** | 20.00 USDC |
| **question** | Will Erling Haaland score 8 or more Fantasy Premier League points in Gameweek 6 (Liverpool v Manchester City)? |
| **trading window** | 11 Oct 14:30Z → 15:30Z (closes at kickoff) |

Both needed six attempts on the `quote` step and up to four on `build` — the
transient failure struck five times consecutively. Without the retry logic both
would have failed outright.

Both were recorded automatically in `data/markets.json` by the creation step,
which is what lets a saved forecast be scored: `resolution.py` settles on
(player, threshold) and Panta has no field for either.

---

## The first trade

**2026-10-07** — 0.10 USDC YES on the Saka market, to prove the buy path.

| | |
|---|---|
| **orderId** | `ord_f7f65b2cd8144bcbac9db642adb5024e` |
| **signature** | `3KHV45gkH9QddtU5wqdh6DJ2yNUVt8egaPm2ag7hiFjSgz6M871uaCDBnXP8HZZjASqjjf4JY5QaeejPa6RRqcBQ` |
| **shares** | 0.199966 at 0.500085 |

`/positions` returned it **within two seconds** and it was identical when polled
at t+2s through t+62s. A Panta builder had reported a verified, attributed buy
that never appeared there and it went unanswered; it does not reproduce.

---

## Where the money is now

| | |
|---|---|
| Operator | 1.394334 USDC, 0.007230820 SOL |
| 5 agent wallets | 5.00 USDC each, 0.0021 SOL each |

## Sessions that were NOT spent

`GET /account/creates/` reports more creates than registered markets. The
difference is create sessions reserved by free `--dry-run` calls and
request-shape probes while reverse-engineering the API. Reserving a session
costs nothing and charges nothing; only `registered` markets have been paid for.
Nothing has been misreported, but the number is worth explaining on sight rather
than leaving a reviewer to guess.
