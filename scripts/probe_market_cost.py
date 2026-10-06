"""What does a real FPL market cost today, per market type?

The doc rules say standard requires the event >=72h out and breaking requires it
within 72h. Real FPL fixtures sit ~4 days away, which would make every FPL
market a 50 USDC standard -- and we hold 21.49.

So test it rather than assume it: quote the same shape twice, as standard and as
breaking, and read back the fee Panta actually wants. Quote reserves a session
and costs nothing.

DUPLICATE_MARKET caveat: Panta keys an active session on wallet + question, so
each variant needs a DISTINCT question. Using the throwaway wallet keeps the
operator wallet's sessions clean.
"""

import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

BASE = "https://live-api.panta.market/api/v1"
ROOT = Path(__file__).resolve().parent.parent  # repo root, where the key file lives
UA = "Overline/0.1 (+https://github.com/yeziR4/fpl)"
WALLET = "DgRjQ9QvdZRh2MVJHZmwRqeBvEGFZFYSu3PTmLxkwPxg"

key_file = ROOT / ".panta_smoke_key.live"
api_key = key_file.read_text(encoding="utf-8").strip()


def quote(spec):
    body = json.dumps(spec).encode()
    req = urllib.request.Request(BASE + "/markets/create/quote/", data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("User-Agent", UA)
    req.add_header("X-Api-Key", api_key)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, json.loads(resp.read().decode() or "{}")
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode(errors="replace")
        try:
            return exc.code, json.loads(raw)
        except json.JSONDecodeError:
            return exc.code, raw[:300]
    except Exception as exc:  # noqa: BLE001
        return None, repr(exc)


def spec(question, title, start_offset_hours, market_type):
    now = int(time.time())
    start = now + int(start_offset_hours * 3600)
    return {
        "wallet": WALLET,
        "question": question,
        "resolutionRule": (
            "Resolves YES if the official Fantasy Premier League site credits the named "
            "player with the stated points total for the stated gameweek, once every match "
            "in that gameweek is finished and bonus points are final."
        ),
        "sourcesOfTruth": ["https://fantasy.premierleague.com/api/bootstrap-static/"],
        "category": "sports",
        "region": "Global",
        "startTime": start,
        "endTime": start + 4 * 3600,
        "resolutionTime": start + 20 * 3600,
        "marketType": market_type,
        "title": title,
        "imageUrl": "https://placehold.co/1024x1024/png",
    }


def usdc(base):
    try:
        return "%.2f USDC" % (int(base) / 1_000_000)
    except (TypeError, ValueError):
        return str(base)


# ~4 days out: what a real gameweek market looks like from here.
GW_HOURS = 100

variants = [
    ("FPL as STANDARD, ~4d out", spec(
        "Will Erling Haaland score 10 or more FPL points in Gameweek 8?",
        "Haaland 10+ GW8 (standard test)", GW_HOURS, "standard")),
    ("FPL as BREAKING, ~4d out", spec(
        "Will Mohamed Salah score 10 or more FPL points in Gameweek 8?",
        "Salah 10+ GW8 (breaking test)", GW_HOURS, "breaking")),
    ("BREAKING, genuinely ~30h out", spec(
        "Will Cole Palmer score 5 or more FPL points in his next match?",
        "Palmer 5+ (true breaking)", 30, "breaking")),
]

for label, s in variants:
    status, payload = quote(s)
    print("\n--- %s ---" % label)
    print("  HTTP %s" % status)
    if status == 200 and isinstance(payload, dict):
        print("  ACCEPTED   payment=%s  type=%s" % (
            usdc(payload.get("paymentUsdc")), payload.get("marketType")))
        print("  createId=%s" % payload.get("createId"))
    else:
        print("  REJECTED   %s" % json.dumps(payload)[:400])

print("\nNothing was spent: quote only reserves a session.")
