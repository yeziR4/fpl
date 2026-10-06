#!/usr/bin/env python3
"""
Check a Solana wallet's SOL and USDC balances.

Written because the first attempt through rpc.solami.dev came back with an empty
body, so this tries several endpoints and reports which one answered. That
matters beyond convenience: Solami is supposed to be the app's data path, and if
its RPC needs auth we need to know now rather than on demo day.

    python scripts/check_wallet.py [address]
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request

DEFAULT_ADDRESS = "65YstDRZo7KXqtwFifypnFNiSKh2VGGh8bXNCSqNcyyM"
USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
LAMPORTS_PER_SOL = 1_000_000_000

ENDPOINTS = [
    ("solami", "https://rpc.solami.dev"),
    ("public mainnet", "https://api.mainnet-beta.solana.com"),
]

USER_AGENT = "Overline/0.1 (+https://github.com/yeziR4/fpl)"


def rpc(url: str, method: str, params: list, timeout: int = 30):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Accept", "application/json")
    req.add_header("User-Agent", USER_AGENT)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode(errors="replace")
        if not raw.strip():
            return None, "empty response body"
        payload = json.loads(raw)
        if "error" in payload:
            return None, "RPC error: %s" % json.dumps(payload["error"])[:200]
        return payload.get("result"), None
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")[:200]
        return None, "HTTP %s %s" % (exc.code, detail)
    except Exception as exc:  # noqa: BLE001
        return None, repr(exc)


def main() -> int:
    address = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_ADDRESS
    print("address: %s" % address)
    print("usdc mint: %s\n" % USDC_MINT)

    for label, url in ENDPOINTS:
        print("=== %s (%s) ===" % (label, url))

        # getBalance returns { context, value } -- the number is under `value`.
        # An earlier version treated the whole object as lamports and printed
        # the dict, which is how you misread a balance report.
        balance, err = rpc(url, "getBalance", [address])
        if err:
            print("  getBalance   FAILED: %s" % err)
            print("  (an empty body usually means the endpoint wants auth, or is")
            print("   not a plain JSON-RPC path)")
            print()
            continue
        lamports = balance.get("value") if isinstance(balance, dict) else balance
        sol = lamports / LAMPORTS_PER_SOL if isinstance(lamports, int) else None
        if sol is None:
            print("  SOL          unreadable: %s" % json.dumps(balance)[:200])
        elif sol == 0:
            print("  SOL          0.000000000  (no SOL -- gas and rent will fail)")
        else:
            print("  SOL          %.9f" % sol)

        tokens, terr = rpc(
            url,
            "getTokenAccountsByOwner",
            [address, {"mint": USDC_MINT}, {"encoding": "jsonParsed"}],
        )
        if terr:
            print("  USDC         FAILED: %s" % terr)
        else:
            total = 0.0
            accounts = (tokens or {}).get("value", []) or []
            for acct in accounts:
                try:
                    amount = acct["account"]["data"]["parsed"]["info"]["tokenAmount"]
                    total += float(amount.get("uiAmountString") or 0)
                    print(
                        "  USDC acct    %s  %s"
                        % (acct.get("pubkey", "?")[:12] + "...", amount.get("uiAmountString"))
                    )
                except (KeyError, TypeError, ValueError):
                    print("  USDC acct    (unparsable)")
            if not accounts:
                print("  USDC         0.00  (no token account for this mint)")
            else:
                print("  USDC TOTAL   %.6f" % total)

        print("\n  -> %s answered. Use this endpoint.\n" % label)
        return 0

    print("No endpoint answered. If both failed, check connectivity before")
    print("assuming the wallet is empty -- an unreachable RPC and a zero balance")
    print("look identical from here.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
