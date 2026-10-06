#!/usr/bin/env python3
"""
Panta API smoke test -- free. Touches the API, never the chain, never spends.

Why Python: PowerShell's HTTPS (schannel) and curl.exe are both broken in this
environment. Python's OpenSSL works. The repo's pipeline is Python anyway.

Run from the repo root (cmd.exe):

    set PANTA_KEY_ENV=live
    set PANTA_WALLET=<a Solana address>
    python scripts\\panta_smoke.py

or in PowerShell:

    $env:PANTA_KEY_ENV = "live"
    $env:PANTA_WALLET  = "<a Solana address>"
    python scripts/panta_smoke.py

TWO LOGINS, AND THEY ARE NOT THE SAME
-------------------------------------
  * panta.market (the web app) signs you in by email through Privy. It is
    passwordless and creates a Solana wallet. This login does NOT mint keys.
  * The API takes an email + password at POST /auth/register/ and
    POST /auth/token/, and that account mints pk_test_ / pk_live_ keys.

TEST MODE IS NOT MAINNET
------------------------
A pk_test_ key is accepted, authenticates, and stamps every response with a
"Test mode ... does not access Solana mainnet" disclaimer. The catalog is a
stub, /positions returns a hardcoded wallet, and nothing about behaviour is
real. This script detects that and says so instead of reporting a false green.

WHAT THIS SCRIPT CANNOT TELL YOU
--------------------------------
/positions returns a 400 "wallet: This field is required" when called bare, so
the endpoint is only exercised when PANTA_WALLET names a real address. And even
then, a wallet with no position returns an empty list -- which neither confirms
nor refutes the bug a Panta builder reported, where a verified, attributed buy
never appeared. Closing that needs a wallet that actually holds a buy.

Exit codes: 0 = validated, 1 = failed, 2 = positions errored, 3 = sandbox only.
"""

from __future__ import annotations

import getpass
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://live-api.panta.market/api/v1"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Which key environment to use. pk_test_ serves sandbox fixtures, so only a
# "live" run says anything about mainnet behaviour.
KEY_ENV = os.environ.get("PANTA_KEY_ENV", "test")
KEY_FILE = os.path.join(ROOT, ".panta_smoke_key.%s" % KEY_ENV)
SANDBOX_MARKER = "Test mode"

# /positions requires a wallet. Without one we skip the step rather than
# reporting a failure that is really a missing argument.
WALLET = os.environ.get("PANTA_WALLET", "").strip()

# Cloudflare fronts this API and bans the default Python urllib user-agent:
# HTTP 403, error 1010 "browser_signature_banned". The request never reaches
# Panta, so it presents as an auth failure and is not one.
USER_AGENT = os.environ.get(
    "PANTA_USER_AGENT", "Overline/0.1 (+https://github.com/yeziR4/fpl)"
)

OK = "  [ok]"
FAIL = "  [FAIL]"
SKIP = "  [skip]"

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


def show(label, payload, limit=3000):
    note_sandbox(payload)
    print("\n--- %s ---" % label)
    if isinstance(payload, str):
        print(payload[:limit])
    else:
        print(json.dumps(payload, indent=2)[:limit])


def pick(d, *names):
    if not isinstance(d, dict):
        return None
    for n in names:
        if d.get(n):
            return d[n]
    return None


def code_of(payload):
    return payload.get("code") if isinstance(payload, dict) else None


def count_rows(payload):
    """Best-effort row count across the shapes a list endpoint might use.

    Earlier this script assumed the key was "markets" and reported "0 markets"
    without ever printing the payload -- so a wrong guess looked like an empty
    catalog. Always show the raw body before trusting any count.
    """
    if isinstance(payload, list):
        return len(payload)
    if not isinstance(payload, dict):
        return None
    for key in ("items", "markets", "results", "data", "positions", "rows"):
        value = payload.get(key)
        if isinstance(value, list):
            return len(value)
    return None


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
    live = not (isinstance(acct, dict) and SANDBOX_MARKER in str(acct.get("disclaimer", "")))
    print(OK + " key authenticates; canCreateMarkets is not false; live=%s" % live)

    # -------------------------------------------------------------- markets
    # The catalog shape is undocumented, so print it raw for all three filters
    # rather than trusting a guessed key name.
    print("\n[4/6] GET /markets/ (raw, all filters)")
    total_seen = 0
    for label, path in (
        ("bare", "/markets/"),
        ("status=primary", "/markets/?status=primary"),
        ("status=secondary", "/markets/?status=secondary"),
    ):
        status, payload = call("GET", path, api_key=api_key)
        print("\n  %s -> HTTP %s" % (label, status))
        if status == 200:
            note_sandbox(payload)
            rows = count_rows(payload)
            total_seen += rows or 0
            print("  parsed rows: %s" % ("?" if rows is None else rows))
            show("markets raw [%s]" % label, payload, limit=1200)
        else:
            show("markets error [%s]" % label, payload, limit=400)

    if total_seen == 0:
        print("\n" + FAIL + " every filter returned zero rows.")
        print("       If live=True above and the raw bodies really are empty, we")
        print("       cannot discover markets -- that breaks the whole supply pitch.")
        print("       If the raw bodies are NOT empty, this script's parsing is wrong")
        print("       and the payload above is the truth.")

    # -------------------------------------------------------------- metrics
    print("\n[5/6] GET /account/metrics/")
    status, metrics = call("GET", "/account/metrics/", api_key=api_key)
    print("  HTTP %s" % status)
    if status == 200:
        show("metrics -- volumeUsdc / buys are our traction numbers", metrics, limit=1500)
        print(OK + " metrics reachable; log this from day one")
    else:
        print("  (non-fatal) HTTP %s" % status)

    # ------------------------------------------------------------ positions
    print("\n[6/6] GET /positions/")
    positions_verified = False
    if not WALLET:
        print(SKIP + " PANTA_WALLET is not set, so /positions was not exercised.")
        print("       The endpoint returns 400 'wallet: This field is required' when")
        print("       called bare. Set it to a real Solana address to test it:")
        print("           set PANTA_WALLET=<solana address>   (cmd)")
        print("           $env:PANTA_WALLET = \"<solana address>\"   (powershell)")
        print("       Note: a wallet holding no position returns an empty list, which")
        print("       neither confirms nor refutes the reported bug. Closing that")
        print("       needs a wallet that actually holds a buy.")
    else:
        path = "/positions/?wallet=%s" % urllib.parse.quote(WALLET)
        status, pos = call("GET", path, api_key=api_key)
        print("  HTTP %s" % status)
        show("positions for %s" % WALLET, pos, limit=2000)
        if status == 200:
            positions_verified = True
            rows = count_rows(pos)
            print(OK + " /positions responded (%s rows)" % ("?" if rows is None else rows))
            if rows == 0:
                print("       Empty. Expected for a wallet with no buys -- and")
                print("       inconclusive for the reported bug.")
        else:
            print(FAIL + " /positions errored for a supplied wallet.")
            print("       If the wallet address is valid, this IS worth posting in")
            print("       #dev-chat with the exact response above.")
            return 2

    # -------------------------------------------------------------- verdict
    if sandbox_responses:
        print("\n=== SANDBOX ONLY: this did NOT validate mainnet ===")
        print("Panta stamped %s response(s) with its test-mode disclaimer." % sandbox_responses)
        print('Re-run with:  set PANTA_KEY_ENV=live')
        return 3

    print("\n=== SMOKE TEST COMPLETE ===")
    print("Live mode confirmed (no test-mode disclaimer). Nothing was spent.")
    print("  markets discovered : %s" % ("yes" if total_seen else "NO -- see above"))
    print("  positions exercised: %s" % ("yes" if positions_verified else "no (no wallet given)"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
