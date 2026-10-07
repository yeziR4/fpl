#!/usr/bin/env python3
"""Find the auth scheme Solami's RPC wants, then read a real balance with it.

rpc.solami.dev/solana returns 401 {"message":"unauthorized"} with no auth. What
is not documented publicly is WHICH header or parameter carries the token, so
try the plausible ones and report which wins. Then prove it with a real call.

Reads the token from the environment or from .env.local. Never prints it.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENDPOINT = "https://rpc.solami.dev/solana"
ADDRESS = "65YstDRZo7KXqtwFifypnFNiSKh2VGGh8bXNCSqNcyyM"
UA = "Overline/0.1 (+https://github.com/yeziR4/fpl)"


def load_token() -> str | None:
    token = os.environ.get("SOLAMI_RPC_TOKEN")
    if token:
        return token.strip()
    env_file = ROOT / ".env.local"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("SOLAMI_RPC_TOKEN="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    return None


def call(token, scheme):
    """scheme: (header_name, prefix) | ('query', param) | ('none', None)"""
    url = ENDPOINT
    headers = {"Content-Type": "application/json", "User-Agent": UA}
    if scheme[0] == "header":
        _, name, prefix = scheme
        headers[name] = (prefix or "") + token
    elif scheme[0] == "query":
        url = "%s?%s=%s" % (ENDPOINT, scheme[1], urllib.parse.quote(token))

    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "getHealth", "params": []}).encode()
    req = urllib.request.Request(url, data=body, method="POST")
    for k, v in headers.items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            return resp.status, resp.read().decode(errors="replace")[:160]
    except urllib.error.HTTPError as exc:
        return exc.code, (exc.read().decode(errors="replace")[:160] or "(empty)")
    except Exception as exc:  # noqa: BLE001
        return None, repr(exc)


import urllib.parse  # noqa: E402  (used by call)

token = load_token()
if not token:
    raise SystemExit("No SOLAMI_RPC_TOKEN in the environment or .env.local")
print("token loaded: %s...%s (%d chars)\n" % (token[:6], token[-4:], len(token)))

SCHEMES = [
    ("header", "X-Api-Key", ""),
    ("header", "Authorization", "Bearer "),
    ("header", "X-Api-Token", ""),
    ("header", "X-Solami-Token", ""),
    ("header", "X-Token", ""),
    ("query", "api_token"),
    ("query", "api_key"),
    ("query", "token"),
]

winner = None
for scheme in SCHEMES:
    label = scheme[1] if scheme[0] == "query" else "%s: %s" % (scheme[1], (scheme[2] or "") + token[:10] + "...")
    status, body = call(token, scheme)
    ok = status == 200 and "result" in body
    print("%-42s HTTP %-5s %s%s" % (label, status, body.replace("\n", " ")[:60], "   <-- WORKS" if ok else ""))
    if ok and winner is None:
        winner = scheme

if winner is None:
    print("\nNo scheme worked. Baseline with no auth, for comparison:")
    print("  %s" % (call(token, ("header", "X-Nothing", ""))[0],))
    raise SystemExit(1)

print("\n=== winner: %s ===" % (winner[1] if winner[0] == "query" else winner[1]))

# Prove it with real reads.
def rpc(method, params):
    headers = {"Content-Type": "application/json", "User-Agent": UA}
    url = ENDPOINT
    if winner[0] == "header":
        headers[winner[1]] = (winner[2] or "") + token
    else:
        url = "%s?%s=%s" % (ENDPOINT, winner[1], urllib.parse.quote(token))
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    req = urllib.request.Request(url, data=body, method="POST")
    for k, v in headers.items():
        req.add_header(k, v)
    with urllib.request.urlopen(req, timeout=25) as resp:
        return json.loads(resp.read().decode() or "{}")


print("\ngetBalance via Solami ->")
res = rpc("getBalance", [ADDRESS]).get("result", {})
lamports = res.get("value") if isinstance(res, dict) else res
print("  %s lamports = %.9f SOL" % (lamports, lamports / 1_000_000_000))

USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
res = rpc("getTokenAccountsByOwner", [ADDRESS, {"mint": USDC}, {"encoding": "jsonParsed"}]).get("result", {})
for acct in res.get("value", []):
    amt = acct["account"]["data"]["parsed"]["info"]["tokenAmount"]
    print("  USDC = %s" % amt.get("uiAmountString"))

print("\nIf those two reads came back, Solami is genuinely carrying our data now.")
