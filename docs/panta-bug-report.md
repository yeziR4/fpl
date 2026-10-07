# Bug report for the Panta API dev team

Three findings from building an integrator against `live-api.panta.market`
between 2026-10-06 and 2026-10-07, in the order they matter. The first is the
one that will cost other integrators transactions.

---

# 1. `INVALID_MARKET_PARAMS` on roughly half of all write requests

## Impact

Every integrator that calls these endpoints once, without retrying, will fail
about half the time. During a **single successful market creation** we needed
three attempts on `build` and two on `register`. During a **single successful
primary buy** we needed three attempts on `quote` and three on `build`. Only
because the client retries does either flow complete.

This is the highest-value thing to fix, because the failure mode is silent: the
error looks like the caller sent something wrong.

## What we see

```
HTTP 400
{ "code": "INVALID_MARKET_PARAMS" }
```

On the create steps the message names the step and nothing else:

```
HTTP 400
{ "code": "INVALID_MARKET_PARAMS",
  "message": "unexpected create quote failure — check server logs" }

HTTP 400
{ "code": "INVALID_MARKET_PARAMS",
  "message": "unexpected create build failure — check server logs" }
```

## The discriminator, and why we are confident it is not our payload

**Real validation errors carry a `fields` object. This one never does.**

```
missing category      -> { "code": "INVALID_MARKET_PARAMS",
                           "message": "category: This field is required.",
                           "fields": { "category": ["This field is required."] } }

missing resolutionRule-> { "code": "INVALID_MARKET_PARAMS",
                           "message": "resolutionRule: This field is required.; sourcesOfTruth: This field is required.",
                           "fields": { "resolutionRule": [...], "sourcesOfTruth": [...] } }

the transient one     -> { "code": "INVALID_MARKET_PARAMS" }     <-- no fields
```

So `code == "INVALID_MARKET_PARAMS" && !fields` is a reliable client-side test
for "retry this" versus "fix your payload".

## Endpoints affected

| Endpoint | Observed |
|---|---|
| `POST /markets/create/quote/` | yes |
| `POST /markets/create/build/` | yes |
| `POST /markets/register/` | yes |
| `POST /primaryorderquote/` | yes |
| `POST /primaryorderbuild/` | yes |

## Evidence that the identical payload both fails and succeeds

**Run A — seven consecutive identical-shape requests, all failed:**

```
Image acceptance test 0 (Saka 110x140)   -> HTTP 400  INVALID_MARKET_PARAMS, no fields
Image acceptance test 1 (Saka 250x250)   -> HTTP 400  INVALID_MARKET_PARAMS, no fields
Image acceptance test 2 (Haaland 110x140)-> HTTP 400  INVALID_MARKET_PARAMS, no fields
Image acceptance test 3 (Haaland 250x250)-> HTTP 400  INVALID_MARKET_PARAMS, no fields
Image acceptance test 4 (Gabriel 110x140)-> HTTP 400  INVALID_MARKET_PARAMS, no fields
Image acceptance test 5 (Gabriel 250x250)-> HTTP 400  INVALID_MARKET_PARAMS, no fields
Image acceptance test 6 (placehold 1024) -> HTTP 400  INVALID_MARKET_PARAMS, no fields
```

**Run B — the same shapes, seconds later, on a retry loop:**

```
control: placehold.co (previously accepted)
  try 1: HTTP 400  code=INVALID_MARKET_PARAMS fields=False   x-ratelimit-remaining=22
  try 2: HTTP 400  code=INVALID_MARKET_PARAMS fields=False   x-ratelimit-remaining=21
  try 3: HTTP 200  ACCEPTED                                  x-ratelimit-remaining=20

Saka 250x250 PL photo
  try 1: HTTP 400  code=INVALID_MARKET_PARAMS fields=False   x-ratelimit-remaining=22
  try 2: HTTP 200  ACCEPTED                                  x-ratelimit-remaining=21
```

The 7-in-a-row failure is not what "roughly half" predicts, so the behaviour is
either bursty or correlated with something on your side (a rolling deploy, a
cold cache, a lock).

We also saw the same payload fail on one attempt and succeed on the next, and a
*different* valid payload do the exact reverse — which rules out
payload-dependent validation.

## Exact reproduction

Save this as `payload.json` (this is the exact body that was sent for the
market creation that ultimately succeeded; note the timestamps are unix
**seconds**, which is what the API takes):

```json
{
  "wallet": "<any valid Solana address>",
  "question": "Will Bukayo Saka score 7 or more Fantasy Premier League points in Gameweek 6 (Arsenal v Leeds)?",
  "resolutionRule": "Resolves YES if the official Fantasy Premier League site credits Bukayo Saka with 7 or more points for Gameweek 6, once every match in that gameweek is marked finished and bonus points are final. Resolves NO otherwise.",
  "sourcesOfTruth": [
    "https://fantasy.premierleague.com/api/bootstrap-static/",
    "https://fantasy.premierleague.com/api/event/6/live/"
  ],
  "category": "sports",
  "region": "Global",
  "startTime": 1791631800,
  "endTime": 1791639000,
  "resolutionTime": 1791806400,
  "marketType": "breaking",
  "title": "Saka 7+ points, GW6",
  "imageUrl": "https://resources.premierleague.com/premierleague/photos/players/250x250/p223340.png"
}
```

Then loop it and count:

```bash
for i in $(seq 1 12); do
  curl -s -w "  <- HTTP %{http_code}\n" \
    -X POST https://live-api.panta.market/api/v1/markets/create/quote/ \
    -H "X-Api-Key: $PANTA_API_KEY" \
    -H "Content-Type: application/json" \
    -d @payload.json
done
```

Note: each success reserves a create session, and the API keys an active session
on **wallet + question**, so a repeated identical run will start returning
`DUPLICATE_MARKET`. Vary the `question` string per iteration, or use a fresh
`wallet`, to isolate the transient failure from the duplicate check.

The same loop against `/primaryorderquote/` needs `marketId`, `side`,
`amountUsdc` (a decimal string, minimum `"0.10"`) instead.

## Rate-limit context

Observed on every authenticated response:

```
x-ratelimit-limit: 30
x-ratelimit-remaining: 22, 21, 20 ...
x-ratelimit-reset: 2026-10-07T11:01:18Z
```

We stay well inside that, so this does not look like rate limiting — but it is
worth ruling out, and it is the other reason `retryable: false` matters.

## What would help integrators

1. **Retry it server-side.** A transient internal failure is not the caller's
   fault and should not reach them.
2. **Or return a distinct, documented code** — `TRANSIENT_RETRY` or similar —
   and stop reusing `INVALID_MARKET_PARAMS` for it. Right now a real payload
   error and a server hiccup are the same HTTP status and the same `code`, and
   the only thing separating them is an undocumented `fields` field.
3. **Or return 5xx.** A 400 tells every HTTP-aware client "do not retry".
4. **Document `fields` as the validation discriminator** either way, because it
   is currently the only way an integrator can tell the two apart.

---

# 2. `/positions` — a counter-example to the reported lag

For the record, since a builder reported a verified, attributed buy that never
appeared in `/positions` and it went unanswered:

**We could not reproduce it.** After a primary buy (`orderId
ord_f7f65b2cd8144bcbac9db642adb5024e`, signature
`3KHV45gkH9QddtU5wqdh6DJ2yNUVt8egaPm2ag7hiFjSgz6M871uaCDBnXP8HZZjASqjjf4JY5QaeejPa6RRqcBQ`),
`GET /positions/?wallet=...` returned the position **inside two seconds**, and
the response was identical when polled again at t+11s, t+21s, t+31s and t+62s.

```
t+ 2s  positions=2  primaryContributed=0.10  value=5.100015
t+62s  positions=2  primaryContributed=0.10  value=5.100015
```

Either that was a different failure mode, or it has since been fixed.

**Small note:** `GET /positions/` called without `wallet` returns
`INVALID_MARKET_PARAMS` — a market-params code on a positions endpoint. The
behaviour is right (`fields.wallet` says exactly what is missing) but the code
name is likely to mislead.

---

# 3. Smaller findings

**`GET /markets/categories/` returns 404.** The docs list a "Categories"
endpoint under Markets catalog; calling it returns
`{"code": "MARKET_NOT_FOUND", "message": "market not found"}`. We used it to
pick a valid `category` and had to guess `"sports"` instead
(`"crypto"` and `"science"` appear in the live catalog).

**Volume field is inconsistent between endpoints.** The catalog list returns
`volumeUsdc` as a decimal string (`"0.00"`); the market detail for a
newly-created market returned `null`. Both were read within a minute of each
other for the same market.

**The market image does not render on the site.** `GET /markets/{id}/` returns
`images: ["https://resources.premierleague.com/premierleague/photos/players/250x250/p223340.png"]`
and your own Discord bot renders it correctly, but the market page shows the
"Event image" label with nothing beneath it. That CDN serves the file to any
referer and any origin (verified: HTTP 200, 345664 bytes, 500x500), so it does
not look like hotlink blocking. Possibly the ~1024x1024 guidance, or a cache.

**A Panta Intelligence blurb was factually wrong.** For our market on
`C86nbpSX4ntRWvN4HMrdnhzHjHTtLooNtnw6k7hnmx1F` it states *"Arsenal against
**newly promoted** Leeds United"*. Leeds were promoted for the 2025/26 season,
so 2026/27 is their second consecutive season in the league. It is a confident,
sourced, wrong claim — and if the same model family backs the Resolution Agent,
that is worth a look before it resolves someone's market.

**One question, not a bug.** For a match-anchored market, should `endTime` be
kickoff or full time? We set it to kickoff + 2h for our first market, and the
site says *"All trading stops here"* — which means traders can act on in-play
information (watch the player score, then buy YES). We are switching to
`endTime` = kickoff for subsequent markets. If full-time is the intended design,
it would be worth saying so explicitly, because it is exploitable.
