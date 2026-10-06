#!/usr/bin/env python3
"""
Panta API smoke test -- free. Touches the API, never the chain, never spends.

Why Python: PowerShell's HTTPS (schannel) and curl.exe are both broken in this
environment. Python's OpenSSL works. The repo's pipeline is Python anyway.

Run from the repo root:

    python scripts/panta_smoke.py                # test key (sandbox fixtures)
    $env:PANTA_KEY_ENV = "live"                  # live key (real mainnet reads)
    python scripts/panta_smoke.py

TWO LOGINS, AND THEY ARE NOT THE SAME
-------------------------------------
  * panta.market (the web app) signs you in by email through Privy. It is
    passwordless and creates a Solana wallet. This login does NOT mint keys.
  * The API takes an email + password at POST /auth/register/ and
    POST /auth/token/, and that account mints pk_test_ / pk_live_ keys.

THREE WAYS IN
-------------
  1. PANTA_API_KEY set in the environment  -> skips auth entirely
  2. An existing .panta_smoke_key.<env>    -> skips auth entirely
  3. Email + password                      -> registers or logs in, mints a key

TEST MODE IS NOT MAINNET
------------------------
A pk_test_ key is accepted, authenticates, and every response comes back
stamped "Test mode: this response uses sandbox fixtures and does not access
Solana mainnet." The catalog is empty, /positions returns a stub wallet, and
nothing you learn about behaviour is real. It validates plumbing and nothing
else, so this script now detects the disclaimer and says so rather than
reporting a green run that proved nothing.

Exit codes: 0 = validated, 1 = failed, 2 = /positions suspect, 3 = sandbox only.
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

# Which key environment to use. Panta's pk_test_ keys serve sandbox fixtures,
# so a "live" run is the only one that says anything about mainnet behaviour.
KEY_ENV = os.environ.get("PANTA_KEY_ENV", "test")
KEY_FILE = os.path.join(ROOT, ".panta_smoke_key.%s" % KEY_ENV)
SANDBOX_MARKER = "Test mode"

# Cloudflare fronts this API and bans the default Python urllib user-agent:
# HTTP 403, error 1010 "browser_signature_banned". The request never reaches
# Panta, so it presents as an auth failure and is not one.
USER_AGENT = os.environ.get(
    "PANTA_USER_AGENT", "Overline/0.1 (+https://github.com/yeziR4/fpl)"
)

OK = "  [ok]"
FAIL = "  [FAIL]"

sandbox_responses = 0


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


def note_sandbox(payload):
    global sandbox_responses
    if isinstance(payload, dict) and SANDBOX_MARKER in str(payload.get("disclaimer", "")):
        sandbox_responses += 1


def show(label, payload):
    note_sandbox(payload)
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
            print("Using the saved key at %s" % KEY_FILE)
            return key
    return None


def authenticate():
    """Register or log in, then mint a key for KEY_ENV. Returns (key, jwt)."""
    print(
        "\nNo saved %s key, so we need API credentials.\n"
        "This is NOT your panta.market email login -- that one is passwordless\n"
        "and cannot mint API keys. This is a separate API account.\n" % KEY_ENV
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
        print("       A different email is the quickest way past an existing account.")
        return None, None

    print(OK + " JWT acquired")

    print("\n[2/6] POST /account/keys/ (env=%s)" % KEY_ENV)
    status, keyresp = call(
        "POST",
        "/account/keys/",
        {"env": KEY_ENV, "name": "overline-%s" % KEY_ENV},
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
    print("Key environment: %s" % KEY_ENV)
    if KEY_ENV == "test":
        print("  (pk_test_ serves SANDBOX FIXTURES and never touches Solana mainnet.")
        print("   Use PANTA_KEY_ENV=live to exercise real behaviour.)")

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
        note_sandbox(markets)
        print(OK + " catalog reachable (%s markets)" % len(rows))
        if not rows:
            print("       Empty catalog. In test mode that is expected; on a live")
            print("       key it would mean we cannot see the real market list.")
    else:
        show("markets response", markets)
        print(FAIL + " could not list markets.")
        return 1

    print("\n[5/6] GET /account/metrics/")
    status, metrics = call("GET", "/account/metrics/", api_key=api_key)
    print("  HTTP %s" % status)
    if status == 200:
        show("metrics -- volumeUsdc / buys are our traction numbers", metrics)
        print(OK + " metrics reachable; log this from day one")
    else:
        print("  (non-fatal) HTTP %s" % status)

    print("\n[6/6] GET /positions/  <-- THE RISK")
    status, pos = call("GET", "/positions/", api_key=api_key)
    print("  HTTP %s" % status)
    show("positions", pos)
    positions_is_stub = isinstance(pos, dict) and str(pos.get("wallet", "")).startswith("TestWallet")

    if status != 200:
        print(FAIL + " /positions did not return 200.")
        print("       A Panta builder reported a verified, attributed buy that")
        print("       /positions never returned. Post this in #dev-chat NOW.")
        return 2

    print(OK + " /positions responds; shape recorded above.")

    # ------------------------------------------------------------ verdict
    if sandbox_responses or positions_is_stub:
        print("\n=== SANDBOX ONLY: this did NOT validate mainnet ===")
        print("Panta stamped %s response(s) with its test-mode disclaimer, and" % sandbox_responses)
        print("/positions returned a stub wallet. Plumbing is proven; BEHAVIOUR IS NOT.")
        print("\nThe /positions question is therefore still OPEN, and it is the one")
        print("that decides whether the $20 smoke market is worth buying.")
        print("\nRe-run against real mainnet reads (still free -- these are GETs):")
        print('    $env:PANTA_KEY_ENV = "live"')
        print("    python scripts/panta_smoke.py")
        return 3

    print("\n=== SMOKE TEST COMPLETE: mainnet plumbing is good ===")
    print("All steps were free. Nothing was spent.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
