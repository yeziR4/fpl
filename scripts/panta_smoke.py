#!/usr/bin/env python3
"""
Panta API smoke test -- free. Touches the API, never the chain, never spends.

Why Python: PowerShell's HTTPS (schannel) and curl.exe are both broken in this
environment. Python's OpenSSL works. The repo's pipeline is Python anyway.

Run from the repo root:

    python scripts/panta_smoke.py

TWO LOGINS, AND THEY ARE NOT THE SAME
-------------------------------------
Panta has a web app and an API, and they authenticate differently:

  * panta.market (the web app) signs you in by email through Privy. It is
    passwordless and it creates a Solana wallet for you. This login does NOT
    mint API keys.
  * The API takes an email + password at POST /auth/register/ and
    POST /auth/token/, and that account is what mints pk_test_ / pk_live_ keys.

If you have only ever clicked the email link on panta.market, you have no API
password -- that is expected, not a mistake. Register an API account below.

THREE WAYS IN
-------------
  1. PANTA_API_KEY set in the environment  -> skips auth entirely (fastest)
  2. An existing .panta_smoke_key          -> skips auth entirely
  3. Email + password                      -> registers or logs in, mints a key

Exit codes: 0 = plumbing works, 1 = something failed, 2 = /positions suspect.
"""

from __future__ import annotations

import getpass
import json
import os
import sys
import urllib.error
import urllib.request

BASE = "https://live-api.panta.market/api/v1"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KEY_FILE = os.path.join(ROOT, ".panta_smoke_key")

# Panta's API sits behind Cloudflare, which bans the default Python urllib
# user-agent outright: HTTP 403, error 1010 "browser_signature_banned",
# retryable false. The request never reaches Panta, so it presents as an auth
# failure and is not one. Identify honestly and the block lifts.
USER_AGENT = os.environ.get(
    "PANTA_USER_AGENT", "Overline/0.1 (+https://github.com/yeziR4/fpl)"
)

OK = "  [ok]"
FAIL = "  [FAIL]"


def call(method, path, body=None, api_key=None, bearer=None, timeout=40):
    """Return (status, parsed_json_or_text). Never raises for HTTP errors."""
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Accept", "application/json")
    req.add_header("User-Agent", USER_AGENT)
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
        print(payload[:3000])
    else:
        print(json.dumps(payload, indent=2)[:3000])


def pick(d, *names):
    if not isinstance(d, dict):
        return None
    for n in names:
        if d.get(n):
            return d[n]
    return None


def code_of(payload):
    return payload.get("code") if isinstance(payload, dict) else None


# ------------------------------------------------------------------ auth


def existing_key():
    key = os.environ.get("PANTA_API_KEY")
    if key:
        print("Using PANTA_API_KEY from the environment.")
        return key
    if os.path.exists(KEY_FILE):
        with open(KEY_FILE, encoding="utf-8") as fh:
            key = fh.read().strip()
        if key:
            print("Using the key saved at %s" % KEY_FILE)
            return key
    return None


def authenticate():
    """Register or log in, then mint a pk_test_ key. Returns (key, jwt)."""
    print(
        "\nNo API key found, so we need API credentials.\n"
        "This is NOT your panta.market email login -- that one is passwordless\n"
        "and cannot mint API keys. This is a separate API account.\n"
    )
    email = os.environ.get("PANTA_EMAIL") or input("API account email: ").strip()
    password = os.environ.get("PANTA_PASSWORD") or getpass.getpass("API account password: ")

    print("\n[1/6] POST /auth/register/")
    status, reg = call(
        "POST",
        "/auth/register/",
        {"email": email, "password": password, "name": "Overline"},
    )
    print("  HTTP %s" % status)
    access = pick(reg, "access")

    if not access:
        reason = code_of(reg)
        print("  register returned no JWT (code=%s); trying login instead" % reason)
        print("\n[1b/6] POST /auth/token/")
        status, reg = call("POST", "/auth/token/", {"email": email, "password": password})
        print("  HTTP %s" % status)
        access = pick(reg, "access")

    if not access:
        show("last auth response", reg)
        print(FAIL + " could not authenticate.")
        print("       If the account already exists, the password must match the one")
        print("       it was created with. A fresh email is the quickest way past this.")
        return None, None

    print(OK + " JWT acquired")

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
        show("key response", keyresp)
        print(FAIL + " no key returned.")
        return None, None

    with open(KEY_FILE, "w", encoding="utf-8") as fh:
        fh.write(api_key + "\n")
    print(OK + " key minted and saved to %s (shown only once)" % KEY_FILE)
    return api_key, access


# ------------------------------------------------------------------ main


def main() -> int:
    api_key = existing_key()
    if api_key is None:
        api_key, _ = authenticate()
        if api_key is None:
            return 1

    print("\n[3/6] GET /account/")
    status, acct = call("GET", "/account/", api_key=api_key)
    print("  HTTP %s" % status)
    show("account", acct)
    if status != 200:
        print(FAIL + " the key does not authenticate. Delete %s and re-run." % KEY_FILE)
        return 1
    if isinstance(acct, dict) and acct.get("canCreateMarkets") is False:
        print(FAIL + " canCreateMarkets is FALSE -- raise it in #dev-chat today.")
        return 1
    print(OK + " key authenticates; canCreateMarkets is not false")

    print("\n[4/6] GET /markets/")
    status, markets = call("GET", "/markets/", api_key=api_key)
    print("  HTTP %s" % status)
    if status == 200:
        rows = markets if isinstance(markets, list) else markets.get("markets", [])
        print(OK + " catalog reachable (%s markets)" % len(rows))
    else:
        show("markets response", markets)
        print(FAIL + " could not list markets.")
        return 1

    print("\n[5/6] GET /account/metrics/")
    status, metrics = call("GET", "/account/metrics/", api_key=api_key)
    print("  HTTP %s" % status)
    if status == 200:
        show("metrics -- volumeUsdcBase is our traction number", metrics)
        print(OK + " metrics reachable; log this from day one")
    else:
        print("  (non-fatal) HTTP %s" % status)

    print("\n[6/6] GET /positions/  <-- THE RISK")
    status, pos = call("GET", "/positions/", api_key=api_key)
    print("  HTTP %s" % status)
    show("positions", pos)
    if status == 200:
        print(OK + " /positions responds; shape recorded above.")
    else:
        print(FAIL + " /positions did not return 200.")
        print("       A Panta builder reported a verified, attributed buy that")
        print("       /positions never returned. Post this in #dev-chat NOW,")
        print("       before we spend the $20.")
        return 2

    print("\n=== SMOKE TEST COMPLETE: plumbing is good ===")
    print("All steps were free. Nothing was spent.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
