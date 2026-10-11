# Demo video — shot list

**Target: 2 minutes 30. Hard ceiling 3 minutes.** A judge watches several of
these in a row; the second minute is where they decide.

- **Live demo:** https://fpl-y1ck.vercel.app/
- **Solscan (for the transaction shot):** https://solscan.io/tx/3tumqHQuYHGwTwK6ZsNXHUjc19fRbzj5LE1DUG6PHc4wzFcVuwrWKNfijVNjXVmoE5iuS5uHevY1a4jxMvNRK3vN
  — full signature in `data/human_picks.json`, `@Veeekthorr`'s fill

## Before you hit record

- Browser at **1440×900 or wider**, one window, no other tabs visible
- **Zoom to 90%** so the table fits without horizontal scrolling
- Turn the **theme to Dark** if you are recording on a dark desktop — the page
  animates between themes and a mid-video switch looks like a mistake
- Close Slack/Discord/notifications. One popup ruins a take
- Pre-open the Solscan tab so shot 5 is one click, not a typed URL
- **Say the numbers out loud.** The whole argument is numbers, and a viewer
  following along on a phone cannot read a table at 1080p

---

## The schedule — confirmed, not guessed

```
Sat 11 Oct  15:30 UTC   Haaland's match ends. All three real-world results known.
Sun 12 Oct  12:00 UTC   all three on-chain markets resolve. Panta posts Discord
                        alerts with a confidence and a rationale, and payouts
                        become claimable.
Mon 13 Oct  06:59 UTC   SUBMISSION DEADLINE.

WINDOW: 19 hours between the resolution and the deadline.
```

**The resolution fits in the video.** That was not obvious when this was first
written — our markets resolve at a fixed `resolutionTime` set at creation, a
two-day buffer after the last kickoff so bonus points are final, and it happens
to land 19 hours before the deadline.

**Record in TWO sessions, not one.** The single-session version is stronger and
riskier: if Panta's resolver is slow, wrong, or down, you have nothing.

**Session 1 — today, after 17:30 UTC (after Haaland's match).**
Shots 1–6 in full. Every real-world result is known by then and the page shows
them. This version stands alone and is submittable as-is.

**Session 2 — tomorrow, after 12:00 UTC.**
A 45-second addendum: the Discord alert, the claimable payout, the settled page.
Append it. Do not re-record session 1.

**Submit by 04:59 UTC on 13 Oct**, leaving two hours of buffer. A submission at
06:58 is a submission that did not happen.

### The addendum (record only if the markets actually resolve)

**On screen:** the Panta Discord alert, then the Panta market page showing the
position and the claim button.

> *"And this settled an hour ago. Panta's resolver read the official FPL data and
> posted its verdict with a confidence and a reason. The winning side is paid out
> of the losing side's stake, on chain — and nobody had to trust us for any of it."*

**If it has not resolved by Monday morning**, say so and move on:

> *"The markets resolve at noon UTC today. Everything else you have seen is final
> — sixteen positions on chain and three results from the official data."*

**Never imply a settlement that has not happened.** A judge who checks will find
it, and the honest version is a stronger submission anyway.

---

## Shot list

### 1 · Cold open — the claim (0:00–0:15)

**On screen:** the page, scrolled to the masthead.

> *"Five AI models and six people priced the same football match with real money.
> The models split. The people agreed unanimously — and their agreement cost them
> the odds. This is all on-chain, so you can check every word."*

**Do not** open with "Hi, I'm…" or a logo. Open with the claim.

---

### 2 · What this is (0:15–0:35)

**On screen:** scroll slowly from the masthead to the stat strip — *16 positions,
$30.10 committed, 10 human calls*.

> *"Every gameweek, five frontier models — GPT, Claude, Gemini, Grok, DeepSeek —
> each get their own Solana wallet and five dollars. Same prompt, same markets,
> same live prices. They state a probability and a reason, then trade. Then
> anyone can do the same in public."*

**Key line, say it plainly:** *"We don't take bets. The betting happens on Panta.
This page is where the evidence lives."*

---

### 3 · The board (0:35–1:05)

**On screen:** the participant table. Point at the columns.

> *"One row per participant. Nine of the ten model positions are NO. Every one of
> the ten human calls is YES."*

**Click `@Veeekthorr`.** The row expands.

> *"This is the part you cannot get anywhere else. Here is what he said, in his
> words, before the match: 'Haaland 8+ easy, guy's inevitable.' Here is what he
> paid. And here is the transaction."*

**Scroll so the expanded row and its transaction link are both visible.**

---

### 4 · Prove it is real (1:05–1:25)

**On screen:** click the Solscan link on the expanded row.

> *"That is Solana mainnet. His wallet, his position, settled by Panta against the
> official FPL data."*

**Then switch back and expand one model row** — Claude, say.

> *"Same for the models. Claude said 33% against a market price of 50, put a
> dollar-fifty behind it, and left the reasoning on the record."*

**This shot is the whole credibility of the submission.** Do not skip it and do
not rush it.

---

### 5 · The finding (1:25–2:05)

**This is the part that wins or loses it. Slow down.**

**On screen:** the Haaland market card, or the six prices if you have them in a
terminal. If not, put them on a slide — the numbers matter more than the UI here.

> *"Here is what happened as the six human orders went in. Watch the price."*

Read the numbers, slowly:

```
0.5015  →  0.5065  →  0.5114  →  0.5163  →  0.5211  →  0.5259
```

> *"It climbs with every order. Eighteen dollars of YES hitting a thin pool is
> real price impact. The first caller got a better price than the sixth for saying
> exactly the same thing — and none of them could have known that when they
> typed it."*

> *"Which means: if they are right, they risk nineteen dollars to make three
> eighty. If the models are right, the models risk three eighty to make nineteen.
> Six people agreed with each other, and their agreement is what cost them."*

**Final line of the section, and land it:**

> *"In a prediction market, everyone on your side is a competitor, not an ally.
> A poll would have read six-out-of-six as a signal. The market charged them
> for it."*

---

### 6 · How Panta is used (2:05–2:25)

**On screen:** the markets section, or a Panta market page.

> *"Everything runs through the Panta API: creating the markets, reading the
> price, quoting and building the transaction, submitting the broadcast
> signature, and verifying it. The models sign with their own keys and broadcast
> on our own RPC — Panta never holds a key."*

**Include one concrete technical detail.** It signals you actually built it:

> *"One thing worth knowing if you build on this: creating a market returns an
> assembled transaction, but buying returns bare instructions you have to compile
> yourself. That asymmetry cost us a day."*

---

### 7 · Close (2:25–2:35)

**On screen:** the masthead, or a settled market if you have one.

> *"This is a measurement instrument, not a betting site. Next gameweek: more
> markets, more models, and human callers staking their own money — which turns
> the weakest part of this into the strongest."*

**Stop talking. Let the page sit for two seconds before you cut.** Ending on a
hard cut mid-sentence makes it feel unfinished.

---

## Things that will go wrong

| | |
|---|---|
| **The reason text is cut off** | Widen the window or zoom to 80%. The expanded row has a `max-w-4xl` on the reasoning |
| **A row will not expand** | You clicked the signature link. Click the row's name area instead |
| **Solscan is slow** | Pre-load that tab before recording and switch to it, rather than clicking live |
| **You fluff a number** | Start the shot again. Do not "correct" it verbally — a viewer cannot tell a correction from a second number |
| **The build changes under you** | Rebuild or redeploy **before** recording, then do not touch the repo until it is uploaded |

## Do not do

- Do not explain the theme toggle, the pipeline ranking, or the coming-up table.
  They are not the argument. **Two minutes of focus beats six of completeness.**
- Do not say "as you can see" while the thing is not visible
- **Do not claim the humans were wrong.** Haaland had not resolved when this was
  written. Say what the odds became, not who won
- Do not describe the project as a product. It is a study with real money in it,
  and that framing is more interesting and more defensible
