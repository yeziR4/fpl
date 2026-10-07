#!/usr/bin/env python3
"""Rank market targets per position: hit rate, fixture, and when it goes breaking.

This is the first slice of the generator. For each candidate it answers the four
questions that decide whether a market is worth 20 USDC:

  1. What is the calibrated line for this position?  (FWD 8+ / MID 7+ / DEF 5+)
  2. How often has THIS player cleared it, this season, when he played?
     -> that is the expected YES rate, so 100 - it is the expected NO tilt, and
        the tilt decides the creator royalty band.
  3. Which fixture, and when?  Correlated markets (two players, same match)
     move together, which is worse for tilt.
  4. When does that fixture enter Panta's 72h breaking window?  Before it does,
     the same market prices as a 50 USDC standard one.

Run:
    python scripts/pick_targets.py                 # defenders and forwards
    python scripts/pick_targets.py DEF MID FWD
"""

from __future__ import annotations

import datetime as dt
import json
import sys
import urllib.error
import urllib.request
from collections import defaultdict
from pathlib import Path

UA = "Overline/0.1 (+https://github.com/yeziR4/fpl)"
BOOTSTRAP = "https://fantasy.premierleague.com/api/bootstrap-static/"
FIXTURES = "https://fantasy.premierleague.com/api/fixtures/"
LIVE = "https://fantasy.premierleague.com/api/event/%d/live/"

POS = {"GK": 1, "DEF": 2, "MID": 3, "FWD": 4}
POS_OF = {v: k for k, v in POS.items()}
LINE = {"DEF": 5, "MID": 7, "FWD": 8}
TOP_N = 12

# Measured in calibrate_thresholds.py, as a backstop when a player has too few
# gameweeks to judge individually.
POOL_HIT_RATE = {"DEF": 41.6, "MID": 28.7, "FWD": 20.0}


def get(url):
    req = urllib.request.Request(url)
    req.add_header("User-Agent", UA)
    with urllib.request.urlopen(req, timeout=45) as resp:
        return json.loads(resp.read().decode())


def royalty_band(no_tilt: float) -> str:
    if no_tilt <= 89:
        return "20% full"
    if no_tilt <= 92:
        return "10%"
    if no_tilt <= 95:
        return "5%"
    return "0%"


def main() -> int:
    wanted = [a.upper() for a in sys.argv[1:]] or ["DEF", "FWD"]
    wanted = [w for w in wanted if w in LINE]

    boot = get(BOOTSTRAP)
    fixtures = get(FIXTURES)

    teams = {t["id"]: t["short_name"] for t in boot["teams"]}
    next_event = next((e for e in boot["events"] if e.get("is_next")), None)
    if next_event is None:
        raise SystemExit("no upcoming gameweek found")
    gw = next_event["id"]

    now = dt.datetime.now(dt.timezone.utc)
    print("gameweek     : %s (%s)" % (next_event.get("name"), gw))
    print("now (UTC)    : %s\n" % now.strftime("%Y-%m-%d %H:%M"))

    # Per-player history in finished gameweeks.
    finished = [e["id"] for e in boot["events"] if e.get("finished")]
    hist = defaultdict(list)  # pid -> [(points, minutes)]
    for g in finished:
        try:
            live = get(LIVE % g)
        except urllib.error.HTTPError:
            continue
        for row in live.get("elements", []):
            st = row.get("stats") or {}
            hist[row.get("id")].append((st.get("total_points", 0), st.get("minutes", 0)))

    # Each team's fixture in the upcoming gameweek.
    by_team = {}
    for f in fixtures:
        if f.get("event") != gw or f.get("finished"):
            continue
        kick = f.get("kickoff_time")
        if not kick:
            continue
        ts = dt.datetime.fromisoformat(kick.replace("Z", "+00:00"))
        by_team[f["team_h"]] = (f["team_a"], ts, True)
        by_team[f["team_a"]] = (f["team_h"], ts, False)

    for pos_name in wanted:
        line = LINE[pos_name]
        cands = [e for e in boot["elements"] if e["element_type"] == POS[pos_name]]
        cands.sort(key=lambda e: -float(e.get("selected_by_percent") or 0))
        cands = cands[:TOP_N]

        print("=" * 108)
        print("%s  --  line %d+   (ranked by ownership)" % (pos_name, line))
        print("=" * 108)
        print(
            "%-14s %-4s %-6s %-9s %-22s %-8s %-9s %-7s %s"
            % ("player", "team", "own%", "cleared", "fixture", "kickoff", "breaks", "no-tilt", "royalty")
        )
        print("-" * 108)

        rows = []
        for e in cands:
            pid = e["id"]
            team = teams.get(e["team"], "?")
            opp, ts, home = by_team.get(e["team"], ("?", None, True))
            if ts is None:
                continue

            played = [p for p, m in hist.get(pid, []) if m > 0]
            hit = (
                100.0 * sum(1 for p in played if p >= line) / len(played)
                if played
                else POOL_HIT_RATE[pos_name]
            )
            no_tilt = 100.0 - hit
            hours_out = (ts - now).total_seconds() / 3600
            breaks_in = hours_out - 72
            breaks = "now" if breaks_in <= 0 else "in %.1fh" % breaks_in

            rows.append(
                (
                    e["web_name"],
                    team,
                    float(e.get("selected_by_percent") or 0),
                    hit,
                    "%s%s v %s" % ("", team, teams.get(opp, "?")),
                    ts.strftime("%a %H:%M"),
                    breaks,
                    no_tilt,
                    royalty_band(no_tilt),
                    e.get("code"),
                )
            )

        # Best tilt first: closeness of the clear rate to 50%.
        rows.sort(key=lambda r: abs(r[3] - 50.0))
        for r in rows:
            print(
                "%-14s %-4s %-6.1f %-9s %-22s %-8s %-9s %-7.1f %s"
                % (r[0], r[1], r[2], "%.0f%%" % r[3], r[4], r[5], r[6], r[7], r[8])
            )
        print()
        print("  photo urls (250x250), for the market spec:")
        for r in rows[:4]:
            print(
                "    %-14s https://resources.premierleague.com/premierleague/photos/players/250x250/p%s.png"
                % (r[0], r[9])
            )
        print()

    print("Reading it: 'cleared' is how often that player beat the line in games")
    print("he played, so it is the expected YES rate and 100 minus it is the tilt.")
    print("'breaks' says when the fixture enters the 72h window -- before that the")
    print("same market prices as a 50 USDC standard one.")
    print()
    print("Prefer players on DIFFERENT fixtures: two players in one match resolve")
    print("together, which correlates the markets and weakens both.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
