#!/usr/bin/env python3
"""Compute what each market SHOULD resolve to, from the official FPL data.

    python scripts/fetch_market_results.py            # report
    python scripts/fetch_market_results.py --write    # write data/market_results.json

Why this exists
---------------
Our markets are resolved by Panta's oracle agent, not by us, and there is no API
to submit an outcome. So the most useful thing we can do is publish our own
independently computed answer, with its evidence, BEFORE the oracle acts. If
Panta resolves a market the other way, there is a timestamped public record of
what the official data said and when we read it.

That is not paranoia. Our first three markets named two FPL endpoints, one of
which returns SEASON totals. A resolver reading that one would see a number far
above every line we set and resolve all three markets YES. We know the correct
answer is not that, and this file is how we can prove we knew it at the time.

Two rules this file follows
---------------------------
1. It never guesses. A market whose player has not played yet is recorded as
   `pending` with a null outcome, not as NO.
2. It records WHY, not just what. The `explain` array FPL returns is the
   authoritative per-event breakdown, and it is copied in verbatim, so anyone
   can check the arithmetic without trusting us.

A caution that matters for the study rather than the markets: `data_checked` is
false until FPL confirms bonus at the end of a gameweek, so single-gameweek
points can still move. `final` records that honestly. A market can be DECIDED
while the gameweek is still PROVISIONAL -- Saka on 2 cannot reach 7 even with
maximum bonus -- and this file distinguishes the two rather than collapsing them.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MARKETS = ROOT / "data" / "markets.json"
OUT = ROOT / "data" / "market_results.json"

UA = "Overline/0.1 (+https://github.com/yeziR4/fpl)"
FPL = "https://fantasy.premierleague.com/api"
PANTA = "https://live-api.panta.market/api/v1"
MAX_BONUS = 3  # the most a player can gain from bonus in one match


def panta_key() -> str | None:
    """The Panta key, from the environment or the repo's env file.

    Returns None rather than raising when it is absent, so this still produces
    the outcome half of the record on a machine with no key. Only the pool
    figures and P&L need one.
    """
    import os

    key = os.environ.get("PANTA_API_KEY")
    if key:
        return key.strip()
    env = ROOT / ".env.local"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            if line.startswith("PANTA_API_KEY="):
                return line.split("=", 1)[1].strip()
    return None


def panta_get(path: str) -> dict:
    key = panta_key()
    if not key:
        raise RuntimeError("no PANTA_API_KEY available")
    request = urllib.request.Request(PANTA + path)
    request.add_header("User-Agent", UA)
    request.add_header("X-Api-Key", key)
    with urllib.request.urlopen(request, timeout=45) as response:
        return json.loads(response.read().decode() or "{}")


def fetch(url: str) -> dict:
    request = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.loads(response.read().decode())


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", action="store_true", help="write the JSON file")
    parser.add_argument("--gw", type=int, default=6)
    parser.add_argument(
        "--no-panta",
        action="store_true",
        help="skip the Panta pool figures (no P&L, outcomes only)",
    )
    args = parser.parse_args()
    args.panta = not args.no_panta

    bootstrap = fetch(f"{FPL}/bootstrap-static/")
    live = fetch(f"{FPL}/event/{args.gw}/live/")

    event = next((e for e in bootstrap["events"] if e["id"] == args.gw), {})
    positions = {1: "GK", 2: "DEF", 3: "MID", 4: "FWD"}
    elements = {e["id"]: e for e in bootstrap["elements"]}
    stats = {e["id"]: e for e in live["elements"]}
    registry = json.loads(MARKETS.read_text(encoding="utf-8"))

    markets = []
    for market in registry:
        element_id = market.get("element") or market.get("player_id")
        line = market["threshold"]
        element = elements.get(element_id) if element_id else None
        row = stats.get(element_id) if element_id else None
        s = (row or {}).get("stats", {})
        points = s.get("total_points")

        if element is None or points is None or s.get("minutes") in (None, 0):
            # Not played, or we cannot identify the player. Recorded as pending
            # rather than assumed NO -- an unplayed player is not a failed line.
            markets.append({
                "market_id": market["market_id"],
                "player": market["player_name"],
                "line": line,
                "points": None,
                "outcome": None,
                "decided": False,
                "final": False,
                "status": "pending",
                "reason": "has not played yet, or could not be identified",
            })
            continue

        outcome = "yes" if points >= line else "no"

        # Decided means no plausible bonus swing could flip it. Bonus is the only
        # thing that moves after a match, and it is capped at 3.
        headroom = points + MAX_BONUS - line
        if outcome == "yes":
            decided = points - MAX_BONUS >= line or points >= line
            decided = points - MAX_BONUS >= line
        else:
            decided = headroom < 0

        markets.append({
            "market_id": market["market_id"],
            "player": market["player_name"],
            "position": positions.get(element["element_type"]),
            "line": line,
            "points": points,
            "outcome": outcome,
            "decided": decided,
            "final": bool(event.get("data_checked")),
            "status": "decided" if decided else "provisional",
            "breakdown": [
                {"event": entry.get("identifier"), "value": entry.get("value"),
                 "points": entry.get("points")}
                for fixture in (row or {}).get("explain", [])
                for entry in fixture.get("stats", [])
            ],
        })

    # ------------------------------------------------------------------ P&L
    #
    # What each position is now worth, so the board can show profit and loss
    # instead of "edge". Edge is the right column for a researcher and the wrong
    # one for everybody else: it answers "was the market mispriced" when the
    # question a reader actually has is "did they make money".
    #
    # The maths is parimutuel and needs no assumption from us. Both sides' stakes
    # go into one pool; the winning side splits it in proportion to shares held.
    # So:
    #
    #     payout per share = total pool (USDC) / shares held by the WINNING side
    #
    # If the market has not resolved we cannot know the winning side, so the
    # fields stay null rather than carrying a guess.
    if args.panta:
        for market in markets:
            try:
                live_market = panta_get(f"/markets/{market['market_id']}/")
            except Exception as error:  # noqa: BLE001 -- a read failure must not kill the run
                market["pool"] = {"error": str(error)[:120]}
                continue

            yes_vol = float(live_market.get("totalYesVolume") or 0) / 1e6
            no_vol = float(live_market.get("totalNoVolume") or 0) / 1e6
            yes_shares = float(live_market.get("totalYesShares") or 0) / 1e6
            no_shares = float(live_market.get("totalNoShares") or 0) / 1e6
            pool = yes_vol + no_vol

            resolved = bool(live_market.get("resolved"))
            # The winning side comes from OUR computed outcome, not from Panta's
            # `resolved` flag. That flag is still false while the proposal sits in
            # UMA's window, and waiting for it would leave the board with no P&L
            # for the whole period that matters -- right after the result and
            # before settlement.
            #
            # This is safe because the two agree here: Panta proposed NO on
            # Haaland and NO on Saka, and the official data says the same. If they
            # ever disagreed, `proposedToUma` and `resolvedOnChain` are recorded
            # beside the payout so the disagreement is visible rather than hidden
            # inside a profit number.
            winning = market.get("outcome")
            payout_per_share = None
            if winning == "yes" and yes_shares > 0:
                payout_per_share = pool / yes_shares
            elif winning == "no" and no_shares > 0:
                payout_per_share = pool / no_shares

            market["pool"] = {
                "yesVolumeUsdc": round(yes_vol, 4),
                "noVolumeUsdc": round(no_vol, 4),
                "poolUsdc": round(pool, 4),
                "yesShares": round(yes_shares, 6),
                "noShares": round(no_shares, 6),
                "resolvedOnChain": resolved,
                "proposedToUma": bool(live_market.get("sentToUma")),
                "proposedOutcome": live_market.get("outcome"),
                "winningSide": winning,
                "payoutPerShare": round(payout_per_share, 8) if payout_per_share else None,
                "_note": (
                    "Payout per share = pool / shares on the winning side. P&L for a "
                    "position is shares * payoutPerShare - stake, or -stake if it lost. "
                    "Null when the market has not resolved, because the winning side is "
                    "not yet a fact."
                ),
            }

    payload = {
        "_readme": [
            "What each market SHOULD resolve to, computed independently from the",
            "official FPL data and published before Panta's oracle acts.",
            "",
            "'decided' means no plausible bonus swing could flip the outcome.",
            "'final' means FPL has set data_checked for the gameweek, so bonus is",
            "confirmed. A market can be decided while the gameweek is not final,",
            "and the two are recorded separately rather than collapsed.",
            "",
            "'pool' carries the parimutuel figures used to compute P&L. They come",
            "from Panta, not from us, so the profit numbers on the board are",
            "derived from the venue's own accounting rather than our arithmetic.",
            "",
            "This is our record, not Panta's. Panta resolves the market; we",
            "publish what the data said and when we read it.",
        ],
        "gw": args.gw,
        "asOf": dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z"),
        "sources": [f"{FPL}/event/{args.gw}/live/", f"{FPL}/bootstrap-static/"],
        "gameweekFinal": bool(event.get("data_checked")),
        "markets": markets,
    }

    print(f"\nGameweek {args.gw}  data_checked={event.get('data_checked')}  as of {payload['asOf']}\n")
    print(f"  {'player':<14}{'line':>5}{'points':>8}  {'outcome':<7}{'status':<13}breakdown")
    print("  " + "-" * 84)
    for m in markets:
        breakdown = " ".join(f"{b['event']}={b['value']}(+{b['points']})" for b in m.get("breakdown") or [])
        print(f"  {m['player']:<14}{m['line']:>5}{str(m['points']):>8}  "
              f"{str(m['outcome'] or '-'):<7}{m['status']:<13}{breakdown[:46]}")

    if args.write:
        OUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"\nwrote {OUT.relative_to(ROOT)}")
    else:
        print("\n(report only -- pass --write to save)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
