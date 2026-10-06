"""Calibrate the points-threshold lines against the players we would ACTUALLY market.

The first pass averaged over every squad player, half of whom never leave the
bench, which drags every hit rate toward zero and makes every line look too
hard. Markets get built on the expensive, high-ownership names -- the ones the
FPL crowd argues about -- so that is the population to measure.

Reports, per position, among the top N most expensive players and only in
gameweeks where they actually played:

  available%   how often they turned out at all (injury/rotation risk, the NO
               nobody prices in)
  hit@line%    how often they cleared the proposed line when they played

A hit rate near 50% is a balanced market. Near 0% or 100% is a dead one. Panta
pays full creator royalty up to 89% tilt and nothing above 96%.
"""

import json
import urllib.error
import urllib.request
from collections import defaultdict

UA = "Overline/0.1 (+https://github.com/yeziR4/fpl)"
BOOTSTRAP = "https://fantasy.premierleague.com/api/bootstrap-static/"
LIVE = "https://fantasy.premierleague.com/api/event/%d/live/"

POSITIONS = {2: "DEF", 3: "MID", 4: "FWD"}
PROPOSED = {2: 5, 3: 7, 4: 10}
TOP_N = 20
MIN_MINUTES = 60


def get(url):
    req = urllib.request.Request(url)
    req.add_header("User-Agent", UA)
    with urllib.request.urlopen(req, timeout=45) as resp:
        return json.loads(resp.read().decode())


boot = get(BOOTSTRAP)
elements = boot["elements"]
cost = {e["id"]: e.get("now_cost", 0) for e in elements}
etype = {e["id"]: e["element_type"] for e in elements}

# The marquee pool: the most expensive players in each position.
pool = {}
for pos in POSITIONS:
    ranked = sorted(
        (e for e in elements if e["element_type"] == pos),
        key=lambda e: cost[e["id"]],
        reverse=True,
    )[:TOP_N]
    pool[pos] = {e["id"] for e in ranked}

finished = [e["id"] for e in boot["events"] if e.get("finished")]
print("Gameweeks sampled: %s" % finished)
print("Pool: top %d by price per position\n" % TOP_N)

per_player = defaultdict(lambda: defaultdict(list))

for gw in finished:
    try:
        live = get(LIVE % gw)
    except urllib.error.HTTPError as exc:
        print("  gw%s skipped: HTTP %s" % (gw, exc.code))
        continue
    for row in live.get("elements", []):
        pid = row.get("id")
        if pid is None:
            continue
        pos = etype.get(pid)
        if pos not in pool or pid not in pool[pos]:
            continue
        stats = row.get("stats") or {}
        per_player[pos][pid].append((stats.get("total_points", 0), stats.get("minutes", 0)))

print()
for pos in (4, 3, 2):
    line = PROPOSED[pos]
    players = per_player.get(pos, {})
    if not players:
        continue

    all_gw = [row for rows in players.values() for row in rows]
    appeared = [row for row in all_gw if row[1] > 0]
    started = [row for row in all_gw if row[1] >= MIN_MINUTES]

    avail = 100.0 * len(appeared) / len(all_gw) if all_gw else 0.0
    hit_app = (
        100.0 * sum(1 for p, _ in appeared if p >= line) / len(appeared) if appeared else 0.0
    )
    hit_start = (
        100.0 * sum(1 for p, _ in started if p >= line) / len(started) if started else 0.0
    )

    # What NO-tilt that implies: if the crowd is roughly right, the share buying
    # NO is (100 - hit). That is what the royalty curve actually reads.
    no_tilt = 100.0 - hit_app
    if no_tilt <= 89:
        royalty = "20% (full)"
    elif no_tilt <= 92:
        royalty = "10%"
    elif no_tilt <= 95:
        royalty = "5%"
    else:
        royalty = "0%"

    print("=== %s : proposed %d+ ===" % (POSITIONS[pos], line))
    print("  players in pool       %d" % len(players))
    print("  player-gameweeks      %d" % len(all_gw))
    print("  available (played)    %.1f%%   <- the un-priced injury/rotation risk" % avail)
    print("  cleared when appeared %.1f%%" % hit_app)
    print("  cleared when started  %.1f%%" % hit_start)
    print("  implied NO tilt       %.1f%%  -> creator royalty %s" % (no_tilt, royalty))

    curve = []
    for candidate in (2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15):
        pct = (
            100.0 * sum(1 for p, _ in appeared if p >= candidate) / len(appeared)
            if appeared
            else 0.0
        )
        curve.append("%d+:%.0f%%" % (candidate, pct))
    print("  curve (appearances)   %s" % "  ".join(curve))
    print()

print("Read 'implied NO tilt' against the royalty curve: Panta pays the full 20%")
print("of market liquidity up to 89% tilt, then cuts hard. A line the crowd splits")
print("on is worth several times one they agree on -- and remember it is the")
print("crowd's PERCEPTION that sets tilt, not this true rate.")
