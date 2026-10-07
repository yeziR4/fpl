# Panta spend log

Every non-refundable USDC spent on this project. This is both the expense
evidence and the prior-work disclosure for the Colosseum, Panta, Nigeria and
Solami submissions.

Total spent to date: **20.00 USDC**

---

## 2026-10-07 11:55Z — Saka 7+ points, GW6

| | |
|---|---|
| **marketId** | `C86nbpSX4ntRWvN4HMrdnhzHjHTtLooNtnw6k7hnmx1F` |
| **createId** | `cr_f422454279ff4ce2b604db78b9254fd8` |
| **signature** | `B3KXk2DC5PW9nbyNCP5y4fmutD6uPMD5Z3rfxZV86xgZCTT2PpSr4d3cRQcVms7SZ6ARNxRW83qUKUCbxunZPuT` |
| **creator** | `65YstDRZo7KXqtwFifypnFNiSKh2VGGh8bXNCSqNcyyM` |
| **fee** | 20.00 USDC (breaking market) |
| — of which seeds liquidity | 5.00 USDC |
| — of which is platform revenue | 15.00 USDC |
| **question** | Will Bukayo Saka score 7 or more Fantasy Premier League points in Gameweek 6 (Arsenal v Leeds)? |
| **kickoff** | 2026-10-10T11:30:00Z |
| **resolves** | 2026-10-12T12:00:00Z |
| **image** | `https://resources.premierleague.com/premierleague/photos/players/250x250/p223340.png` |

**Why this market.** First fixture to enter Panta's 72h breaking window
(2026-10-07T11:30Z), so it is legitimately a 20 USDC breaking market rather
than a 50 USDC standard one. Midfielder at the calibrated 7+ line: measured
over every finished gameweek this season, top-20-by-price midfielders clear 7+
in 28.7% of appearances, implying ~71% NO tilt and therefore the full 20%
creator royalty band.

**Notable.** The build step hit Panta's transient failure three times and the
register step once before succeeding. At the original 3-attempt limit this
transaction would have failed. See `panta-signer/lib/panta.ts`.

**Context.** At the time of creation the live Panta catalog contained **zero
primary markets**. Immediately afterwards it contained two: this one, and one
other. This was the first primary market the project created.

---

## Wallet position after this spend

| | |
|---|---|
| USDC | 21.492078 → ~1.49 (pending confirmation below) |
| SOL | 0.029676556 |

## Sessions that were NOT spent

`GET /account/creates/` reports `total: 8, registered: 1`. Seven of those are
create sessions reserved by free `--dry-run` calls and request-shape probes
while reverse-engineering the API. Reserving a session costs nothing and
charges nothing; only `registered` markets have been paid for. Nothing has been
misreported, but the number is worth explaining on sight rather than leaving a
reviewer to guess.
