#!/usr/bin/env python3
"""
Probe POST /markets/create/quote/ to find which field Panta rejects.

The endpoint answers a bad payload with a deliberately vague
`400 INVALID_MARKET_PARAMS` and the message "check server logs", which is
useless from the outside. The docs also describe the schema by concept more
confidently than by example -- the single cURL they print uses `category:
"crypto"` and a CDN image URL.

So: vary one thing at a time and see which variant Panta accepts. Every attempt
here is free. Quote reserves a session; it does not touch the chain and does not
charge anything.

    python scripts/panta_quote_probe.py

Reads the key from .panta_smoke_key.live or PANTA_API_KEY.
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://live-api.panta.market/api/v1"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KEY_FILE = os.path.join(ROOT, ".panta_smoke_key.live")

USER_AGENT = os.environ.get(
    "PANTA_USER_AGENT", "Overline/0.1 (+https://github.com/yeziR4/fpl)"
)

WALLET = os.environ.get("PANTA_CREATOR_WALLET", "DgRjQ9QvdZRh2MVJHZmwRqeBvEGFZFYSu3PTmLxkwPxg")


def call(method, path, body=None, api_key=None, timeout=40):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Accept", "application/json")
    req.add_header("User-Agent", USER_AGENT)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    if api_key:
        req.add_header("X-Api-Key", api_key)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode(errors="replace")
            return resp.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode(errors="replace")
        try:
            return exc.code, json.loads(raw)
        except json.JSONDecodeError:
            return exc.code, raw
    except Exception as exc:  # noqa: BLE001
        return None, repr(exc)


def base_spec() -> dict:
    now = int(time.time())
    return {
        "wallet": WALLET,
        "question": "Will Erling Haaland score 10 or more FPL points in his next match?",
        "resolutionRule": (
            "Resolves YES if fantasy.premierleague.com credits the player with 10 or "
            "more points for the stated gameweek once all matches are finished."
        ),
        "sourcesOfTruth": ["https://fantasy.premierleague.com/api/bootstrap-static/"],
        "category": "sports",
        "startTime": now + 30 * 3600,
        "endTime": now + 34 * 3600,
        "resolutionTime": now + 40 * 3600,
        "marketType": "breaking",
        "title": "Haaland 10+ points",
        "description": "Resolves from the official FPL API.",
        "imageUrl": "https://placehold.co/1024x1024/png",
        "region": "Global",
    }


def main() -> int:
    api_key = os.environ.get("PANTA_API_KEY")
    if not api_key and os.path.exists(KEY_FILE):
        with open(KEY_FILE, encoding="utf-8") as fh:
            api_key = fh.read().strip()
    if not api_key:
        print("No key. Set PANTA_API_KEY or create %s" % KEY_FILE)
        return 1
    print("wallet: %s" % WALLET)

    # ---------------------------------------------------------- categories
    print("\n=== GET /markets/categories/ ===")
    status, payload = call("GET", "/markets/categories/", api_key=api_key)
    print("HTTP %s" % status)
    print(json.dumps(payload, indent=2)[:1500] if not isinstance(payload, str) else payload[:1500])

    # Grab a real catalog image URL to test whether placehold.co is the issue.
    real_image = None
    _, page = call("GET", "/markets/", api_key=api_key)
    if isinstance(page, dict):
        for item in page.get("items", []) or []:
            images = item.get("images") or []
            if images:
                real_image = images[0]
                break
    print("\nreal catalog image: %s" % real_image)

    # ---------------------------------------------------------- variants
    variants: list[tuple[str, dict]] = []
    variants.append(("A. as-sent (category=sports, placehold image)", base_spec()))

    b = base_spec()
    b.pop("category", None)
    variants.append(("B. no category", b))

    c = base_spec()
    c.pop("region", None)
    c.pop("description", None)
    variants.append(("C. no region, no description", c))

    d = base_spec()
    d["category"] = "crypto"
    variants.append(("D. category=crypto (the docs' own example)", d))

    if real_image:
        e = base_spec()
        e["imageUrl"] = real_image
        variants.append(("E. real catalog image URL", e))

    f = {
        "wallet": WALLET,
        "question": "Will it rain in London tomorrow?",
        "title": "London rain",
        "category": "science",
        "startTime": int(time.time()) + 30 * 3600,
        "endTime": int(time.time()) + 34 * 3600,
        "resolutionTime": int(time.time()) + 40 * 3600,
        "marketType": "breaking",
        "imageUrl": real_image or "https://placehold.co/1024x1024/png",
    }
    variants.append(("F. minimal, mimicking the docs' own cURL", f))

    print("\n=== POST /markets/create/quote/ variants ===")
    for label, spec in variants:
        status, payload = call("POST", "/markets/create/quote/", spec, api_key=api_key)
        verdict = "ACCEPTED" if status == 200 else "rejected"
        print("\n--- %s ---" % label)
        print("  HTTP %s  %s" % (status, verdict))
        if status == 200 and isinstance(payload, dict):
            print("  createId=%s paymentUsdc=%s" % (payload.get("createId"), payload.get("paymentUsdc")))
        else:
            print("  %s" % json.dumps(payload)[:600])

    print("\nEvery attempt above was free: quote reserves a session and never")
    print("touches the chain. The first variant that returns 200 tells us which")
    print("field was wrong.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
