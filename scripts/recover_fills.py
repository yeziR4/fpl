#!/usr/bin/env python3
"""Rebuild data/agent_fills/gw6.json after the trader overwrote it.

WHAT HAPPENED, because this file should not quietly become permanent truth:

run-agents.js wrote its fills file with `writeFileSync`, replacing whatever was
there. Its first live run placed six orders; its second run replaced those six
with its own (empty) result, because the six it placed were skipped as
already-done and so were never re-recorded. The third consequence was the
dangerous one: idempotency was keyed on that file, so with it emptied the trader
no longer knew Grok and GPT had traded and would happily have placed both again.
Grok's two were re-attempted on the next run and only failed on Panta's
transient error -- which is the sole reason no money was double-spent.

The merge bug is fixed in run-agents.ts. This script repairs the damage.

Sources, in order of trust:
  1. the picks file, for which (model, market, side) pairs were meant to trade
  2. the trader's own console output from the runs that placed them, for shares
     and the average price actually paid
  3. the chain, for signatures -- recovered via getSignaturesForAddress

Signatures are attached only where the market and side are certain. A wrong
signature against a real fill would be worse than a missing one: the board would
link a model's position to somebody else's transaction.

    python scripts/recover_fills.py --check
    python scripts/recover_fills.py --write
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from pathlib import Path

RPC = "https://api.mainnet-beta.solana.com"
REPO = Path(__file__).resolve().parent.parent
PICKS = REPO / "data" / "agent_picks" / "gw6.json"
REGISTRY = REPO / "data" / "markets.json"
MODELS = REPO / "data" / "agent_models.json"
FILLS = REPO / "data" / "agent_fills" / "gw6.json"

MARKETS = {
    "C86nbpSX4ntRWvN4HMrdnhzHjHTtLooNtnw6k7hnmx1F": "Saka",
    "HLPNPsoRDk36jGF1FqtBENmEq3NRFgMe1wpSos2QyQBq": "Joao Pedro",
    "GM2wvtGY5HaG3T4DiVnJTDXsScZLMc9JU9ABzSRGUvKn": "Haaland",
}

# What the trader's console output reported placing, keyed by (slug, market, side).
# Shares and prices are transcribed verbatim from those runs -- they are the only
# record of the actual fill, since /positions does not surface them.
PLACED: dict[tuple[str, str, str], dict] = {
    ("~openai/gpt-latest", "GM2wvtGY5HaG3T4DiVnJTDXsScZLMc9JU9ABzSRGUvKn", "no"):
        {"requested": 0.80, "shares": "1.596255", "price": "0.501173", "status": "confirmed"},
    ("~openai/gpt-latest", "HLPNPsoRDk36jGF1FqtBENmEq3NRFgMe1wpSos2QyQBq", "no"):
        {"requested": 0.60, "shares": "1.190905", "price": "0.503818", "status": "submitted"},
    ("~anthropic/claude-opus-latest", "GM2wvtGY5HaG3T4DiVnJTDXsScZLMc9JU9ABzSRGUvKn", "no"):
        {"requested": 1.50, "shares": "3.004471", "price": "0.499255", "status": "submitted"},
    ("~anthropic/claude-opus-latest", "C86nbpSX4ntRWvN4HMrdnhzHjHTtLooNtnw6k7hnmx1F", "no"):
        {"requested": 0.50, "shares": "0.989662", "price": "0.505222", "status": "confirmed"},
    ("~google/gemini-pro-latest", "C86nbpSX4ntRWvN4HMrdnhzHjHTtLooNtnw6k7hnmx1F", "no"):
        {"requested": 1.50, "shares": "2.95935", "price": "0.506868", "status": "confirmed"},
    ("~google/gemini-pro-latest", "HLPNPsoRDk36jGF1FqtBENmEq3NRFgMe1wpSos2QyQBq", "no"):
        {"requested": 2.00, "shares": "3.986754", "price": "0.501661", "status": "submitted"},
    ("x-ai/grok-4.20", "C86nbpSX4ntRWvN4HMrdnhzHjHTtLooNtnw6k7hnmx1F", "no"):
        {"requested": 1.00, "shares": "1.984191", "price": "0.503983", "status": "confirmed"},
    ("x-ai/grok-4.20", "GM2wvtGY5HaG3T4DiVnJTDXsScZLMc9JU9ABzSRGUvKn", "yes"):
        {"requested": 1.20, "shares": "2.395219", "price": "0.500998", "status": "submitted"},
}

# Signatures observed on chain for each wallet, from getSignaturesForAddress.
# Claude's and Gemini's are in hand but not mapped to a market yet; Grok's are
# known exactly. Anything unattached is reported as unattached rather than
# guessed at.
KNOWN_SIGNATURES = {
    "x-ai/grok-4.20": [
        "4w7pPAyqiF9hkjiY78qfMm3MTsdRRcWtpYerz2cZfTZaQo1Wo8sARsT73YTJYGzgbAzvmHUFG4CS2ZppBKyXHXT6",
        "5YJDdzQBkQDJSuCcyChUcKWEqpTTHRGjufnC5JL9UB6zqhb1fXgDFTcnyRYDGJ3UfDwaAb2Mf3cg8K7pqLbmPowY",
    ],
    "~openai/gpt-latest": [
        "5aFfAJLGX1TJPof9tpcPWbimd4FirBtjJ9Cuu61kz8Q7N2keUwDfSNSHAy5AhbX7DBtiYCpKhytjoMUGDCVJU",
    ],
}
# Mapped exactly, where the mapping is certain.
EXACT_SIGNATURE = {
    ("x-ai/grok-4.20", "C86nbpSX4ntRWvN4HMrdnhzHjHTtLooNtnw6k7hnmx1F", "no"): KNOWN_SIGNATURES["x-ai/grok-4.20"][0],
    ("x-ai/grok-4.20", "GM2wvtGY5HaG3T4DiVnJTDXsScZLMc9JU9ABzSRGUvKn", "yes"): KNOWN_SIGNATURES["x-ai/grok-4.20"][1],
    ("~openai/gpt-latest", "GM2wvtGY5HaG3T4DiVnJTDXsScZLMc9JU9ABzSRGUvKn", "no"): KNOWN_SIGNATURES["~openai/gpt-latest"][0],
}


def rpc(method: str, params: list):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    req = urllib.request.Request(RPC, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=45) as r:
        return json.loads(r.read().decode()).get("result")


def signatures_for(address: str, panta: str) -> list[str]:
    """Signatures of this wallet's transactions that touch the Panta program."""
    out = []
    for entry in rpc("getSignaturesForAddress", [address, {"limit": 25}]) or []:
        if entry.get("err"):
            continue
        try:
            tx = rpc("getTransaction", [entry["signature"], {"maxSupportedTransactionVersion": 0, "encoding": "json"}])
        except Exception:
            continue
        if not tx:
            continue
        keys = [k if isinstance(k, str) else k.get("pubkey") for k in tx["transaction"]["message"]["accountKeys"]]
        if panta in keys:
            out.append(entry["signature"])
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true", help="write the repaired fills file")
    ap.add_argument("--check", action="store_true", help="report only")
    args = ap.parse_args()
    if not args.write and not args.check:
        ap.error("pass --check or --write")

    picks = json.loads(PICKS.read_text(encoding="utf-8"))
    models = json.loads(MODELS.read_text(encoding="utf-8"))
    by_slug = {m["slug"]: m for m in models}

    rebuilt = {
        "gw": 6,
        "executed_at": "2026-10-09T15:40:00+00:00",
        "mode": "live",
        "_recovered": True,
        "_recovered_note": (
            "Rebuilt by scripts/recover_fills.py after run-agents.js overwrote its own "
            "fills file. Shares and average prices are transcribed from the trader's "
            "console output for the runs that placed them; signatures come from the "
            "chain. See the script's docstring for the full account."
        ),
        "models": [],
    }

    for model in picks["models"]:
        slug = model["slug"]
        entry = {
            "slug": slug,
            "name": model["name"],
            "address": by_slug.get(slug, {}).get("solana_address", ""),
            "error": None,
            "fills": [],
        }
        for pick in model.get("picks", []):
            side = pick.get("side")
            if side not in ("yes", "no"):
                continue
            key = (slug, pick["market_id"], side)
            placed = PLACED.get(key)
            if not placed:
                continue
            entry["fills"].append(
                {
                    "marketId": pick["market_id"],
                    "side": side,
                    "requestedUsdc": placed["requested"],
                    "shares": placed["shares"],
                    "avgPrice": placed["price"],
                    "feeUsdc": None,
                    "orderId": "(not recorded -- the trader's fills file was overwritten)",
                    "signature": EXACT_SIGNATURE.get(key, "(recovered -- see chain)"),
                    "status": placed["status"],
                }
            )
        rebuilt["models"].append(entry)

    total = sum(len(m["fills"]) for m in rebuilt["models"])
    print(f"rebuilt fills: {total} across {len(rebuilt['models'])} models\n")
    for m in rebuilt["models"]:
        print(f"  {m['name']:<22} {len(m['fills'])} fill(s)")
        for f in m["fills"]:
            sig = f["signature"]
            sig = sig if sig.startswith("(") else sig[:22] + ".."
            print(
                f"      {f['side'].upper():<4} ${f['requestedUsdc']:<5} {MARKETS.get(f['marketId'],'?')::<11} "
                f"{f['shares']:<12} @ {f['avgPrice']:<10} {sig}"
            )

    missing = [k for k in PLACED if not EXACT_SIGNATURE.get(k)]
    if missing:
        print(f"\n{len(missing)} fill(s) have no exact signature yet -- their transaction is on")
        print("chain but not yet mapped to a market. They are marked, not guessed:")
        for slug, market, side in missing:
            print(f"  {slug:<32} {MARKETS.get(market,'?'):<11} {side.upper()}")

    if args.check:
        print("\nCHECK only. Re-run with --write to replace the fills file.")
        return 0

    FILLS.parent.mkdir(parents=True, exist_ok=True)
    FILLS.write_text(json.dumps(rebuilt, indent=2) + "\n", encoding="utf-8")
    print(f"\nwrote {FILLS}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
