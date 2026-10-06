#!/usr/bin/env python3
"""
Panta API smoke test -- free. Touches the API, never the chain, never spends.

Why Python: PowerShell's HTTPS (schannel) and curl.exe are both broken in this
environment. Python's OpenSSL works. The repo's pipeline is Python anyway.

Run from the repo root:

    python scripts/panta_smoke.py

Reads PANTA_EMAIL / PANTA_PASSWORD from the environment, or prompts.
Mints a pk_test_ key and saves it to .panta_smoke_key (gitignored) because the
API shows the secret exactly once.

Exit codes: 0 = plumbing works, 1 = something failed, 2 = /positions suspect.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

BASE = "https://live-api.panta.market/api/v1"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KEY_FILE = os.path.join(ROOT, ".panta_smoke_key")

PASS_MARK = "  [ok]"
FAIL_MARK = "  [FAIL]"


def call(method, path, body=None, api_key=None, bearer=None, timeout=40):
    """Return (status, parsed_json_or_text). Never raises for HTTP errors."""
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Accept", "application/json")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    if api_key:
        req.add_header("X-Api-Key", api_key)
    if bearer:
        req.add_header("Authorization", "Bearer " + bearer)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode(errors="replace")
            try:
                return resp.status, json.loads(raw) if raw else {}
            except json.JSONDecodeError:
                return resp.status, raw
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode(errors="replace")
        try:
            return exc.code, json.loads(raw)
        except json.JSONDecodeError:
            return exc.code, raw
    except Exception as exc:  # noqa: BLE001 - we want the raw reason
        return None, repr(exc)


def show(label, payload):
    print("\n--- %s ---" % label)
    if isinstance(payload, str):
        print(payload[:4000])
    else:
        print(json.dumps(payload, indent=2)[:4000])


def pick(d, *names):
    """First present key from names, on a dict."""
    if not isinstance(d, dict):
        return None
    for n in names:
        if d.get(n):
            return d[n]
    return None


def main() -> int:
    email = os.environ.get("PANTA_EMAIL") or input("Panta email: ").strip()
    password = os.environ.get("PANTA_PASSWORD")
    if not password:
        import getpass

        password = getpass.getpass("Panta password: ")

    # ---------------------------------------------------------- 1. register
    print("\n[1/6] POST /auth/register/")
    status, reg = call(
        "POST",
        "/auth/register/",
        {"email": email, "password": password, "name": "Overline"},
    )
    print("  HTTP %s" % status)
    access = pick(reg, "access", "token", "jwt")

    if status in (409, 400) or not access:
        print("  register did not return a JWT; trying /auth/login/")
        status, reg = call("POST", "/auth/login/", {"email": email, "password": password})
        print("  HTTP %s" % status)
        access = pick(reg, "access", "token", "jwt")

    if not access:
        show("register/login response (inspect field names)", reg)
        print(FAIL_MARK + " no JWT. Look at the fields above and tell Claude.")
        return 1
    print(PASS_MARK + " JWT acquired")

    # ------------------------------------------------------------- 2. mint key
    print("\n[2/6] POST /account/keys/ (env=test)")
    status, keyresp = call(
        "POST",
        "/account/keys/",
        {"env": "test", "name": "overline-smoke"},
        bearer=access,
    )
    print("  HTTP %s" % status)
    api_key = pick(keyresp, "secret", "key", "apiKey", "plaintext")
    if not api_key:
        show("key response (inspect field names)", keyresp)
        print(FAIL_MARK + " no key returned.")
        return 1
    with open(KEY_FILE, "w", encoding="utf-8") as fh:
        fh.write(api_key + "\n")
    print(PASS_MARK + " key minted, saved to %s" % KEY_FILE)

    # --------------------------------------------------------------- 3. whoami
    print("\n[3/6] GET /account/")
    status, acct = call("GET", "/account/", api_key=api_key)
    print("  HTTP %s" % status)
    show("account", acct)
    if status != 200:
        print(FAIL_MARK + " the key does not authenticate.")
        return 1
    if isinstance(acct, dict) and acct.get("canCreateMarkets") is False:
        print(FAIL_MARK + " canCreateMarkets is FALSE -- raise it in #dev-chat today.")
        return 1
    print(PASS_MARK + " key authenticates, canCreateMarkets is not false")

    # --------------------------------------------------------------- 4. markets
    print("\n[4/6] GET /markets/")
    status, markets = call("GET", "/markets/", api_key=api_key)
    print("  HTTP %s" % status)
    if status == 200:
        n = len(markets) if isinstance(markets, list) else len(markets.get("markets", []))
        print(PASS_MARK + " catalog reachable (%s markets)" % n)
    else:
        show("markets response", markets)
        print(FAIL_MARK + " could not list markets.")
        return 1

    # ---------------------------------------------------- 5. team/event markets
    print("\n[5/6] GET /account/metrics/")
    status, metrics = call("GET", "/account/metrics/", api_key=api_key)
    print("  HTTP %s" % status)
    if status == 200:
        show("metrics (volumeUsdcBase is our traction number)", metrics)
        print(PASS_MARK + " metrics reachable -- log this from day one")
    else:
        print("  (non-fatal) metrics not reachable: %s" % status)

    # ---------------------------------------------------------- 6. POSITIONS
    print("\n[6/6] GET /positions/  <-- THE RISK")
    status, pos = call("GET", "/positions/", api_key=api_key)
    print("  HTTP %s" % status)
    show("positions", pos)
    if status == 200:
        print(PASS_MARK + " /positions responds. Shape recorded above.")
    else:
        print(FAIL_MARK + " /positions did not return 200.")
        print("       A builder reported a verified buy that /positions never returned.")
        print("       Post this response in #dev-chat NOW, before we spend the $20.")
        return 2

    print("\n=== SMOKE TEST COMPLETE: plumbing is good ===")
    print("All six steps were free. Nothing was spent.")
    print("Next: the $20 Breaking market, and /positions must return that buy.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
