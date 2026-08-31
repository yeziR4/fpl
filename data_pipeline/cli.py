"""Command-line entry points for the data pipeline.

    python -m data_pipeline.cli fetch-bootstrap
    python -m data_pipeline.cli fetch-fixtures
    python -m data_pipeline.cli fetch-live 4
    python -m data_pipeline.cli top20
    python -m data_pipeline.cli points 1 --gw 1
    python -m data_pipeline.cli full90 1 --gw 1
    python -m data_pipeline.cli resolve-points 1 --gw 1 --threshold 5
    python -m data_pipeline.cli resolve-full90 1 --gw 1
    python -m data_pipeline.cli gw-status 1
    python -m data_pipeline.cli resolve-gameweek --gw 1
    python -m data_pipeline.cli generate-picks --gw 1
    python -m data_pipeline.cli score-gameweek --gw 1
    python -m data_pipeline.cli auto-generate-picks
    python -m data_pipeline.cli auto-score
    python -m data_pipeline.cli settle-gameweek --gw 1
    python -m data_pipeline.cli auto-settle

The `fetch-*` commands need outbound access to fantasy.premierleague.com
and must be run from an environment that has it. The rest only read
whatever has already been cached locally under data/cache/.

`points` / `full90` show the raw stat for a gameweek as soon as *any*
snapshot is cached for it, even mid-match -- useful for sanity-checking
the pipeline. `resolve-points` / `resolve-full90` are what a market
should actually call to decide a payout: they return PENDING until the
underlying fixture is confirmed finished, never a premature YES/NO off
a partial or provisional snapshot. See data_pipeline/resolution.py.

`generate-picks` / `score-gameweek` target an explicit gameweek and
need OPENROUTER_API_KEY set for the former. `auto-generate-picks` /
`auto-score` are what a scheduled job should call instead: the first
targets whichever gameweek's deadline hasn't passed yet and skips if
that gameweek's picks already exist (pass --force to regenerate); the
second scores every gameweek that has saved picks but isn't in the
leaderboard yet, and only once resolution.py says it's actually safe
to. See data_pipeline/agents.py and data_pipeline/leaderboard.py.

`settle-gameweek` / `auto-settle` are the real-money counterpart to
score-gameweek/auto-score: for every (player, threshold) market any
agent was asked to pick for a gameweek (the settlement candidate set --
a superset of whatever the site's markets grid ever actually showed),
resolve its outcome and POST it to that market's own /settle endpoint
on the faucet Worker, which pays winners out pro-rata from the real
staked pool. Both need FAUCET_URL and SETTLEMENT_API_KEY set in the
environment. Unlike auto-score, auto-settle keeps no local bookkeeping
of what's already been settled -- the Worker's own per-market
settlement state is authoritative and already idempotent (re-settling
an already-settled market is a no-op, never a double payout), so it's
safe to call this on every finished gameweek on every scheduled run.
See faucet/src/MarketLedger.ts's settle handler for the payout math.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone

from . import cache
from .players import top_expensive_players
from .resolution import (
    MarketOutcome,
    is_gameweek_finished,
    resolve_full90,
    resolve_gameweek_points_markets,
    resolve_points_threshold,
)
from .settlement import (
    PRIMARY_POINTS_THRESHOLD,
    SECONDARY_POINTS_THRESHOLD,
    full90_result,
    points_result,
)


def cmd_fetch_bootstrap(_args: argparse.Namespace) -> None:
    from .fpl_client import fetch_bootstrap_static

    payload = fetch_bootstrap_static()
    path = cache.save_bootstrap_static(payload)
    print(f"Saved bootstrap-static snapshot -> {path}")


def cmd_fetch_fixtures(_args: argparse.Namespace) -> None:
    from .fpl_client import fetch_fixtures

    payload = fetch_fixtures()
    path = cache.save_fixtures(payload)
    print(f"Saved fixtures snapshot -> {path}")


def cmd_fetch_live(args: argparse.Namespace) -> None:
    from .fpl_client import fetch_event_live

    payload = fetch_event_live(args.gw)
    path = cache.save_event_live(args.gw, payload)
    print(f"Saved GW{args.gw} live snapshot -> {path}")


def cmd_top20(args: argparse.Namespace) -> None:
    bootstrap = cache.load_latest_bootstrap_static()
    players = top_expensive_players(bootstrap, n=args.n)
    for rank, player in enumerate(players, start=1):
        print(f"{rank:>2}. {player.web_name:<20} £{player.price_millions:.1f}m  id={player.id}")


def cmd_points(args: argparse.Namespace) -> None:
    result = points_result(args.player_id, args.gw)
    if result is None:
        print(f"GW{args.gw} not yet cached for player {args.player_id}")
        return
    over_primary = "YES" if result.over(PRIMARY_POINTS_THRESHOLD) else "no"
    over_secondary = "YES" if result.over(SECONDARY_POINTS_THRESHOLD) else "no"
    print(f"Player {args.player_id}, GW{args.gw}: {result.points} pts")
    print(f"  over {PRIMARY_POINTS_THRESHOLD} (primary):   {over_primary}")
    print(f"  over {SECONDARY_POINTS_THRESHOLD} (secondary): {over_secondary}")


def cmd_full90(args: argparse.Namespace) -> None:
    result = full90_result(args.player_id, args.gw)
    if result is None:
        print(f"GW{args.gw} not yet cached for player {args.player_id}")
        return
    outcome = "YES" if result.played_full_90 else "no"
    print(f"Player {args.player_id}, GW{args.gw}: {result.minutes} min -> full 90: {outcome}")


def cmd_resolve_points(args: argparse.Namespace) -> None:
    outcome = resolve_points_threshold(args.player_id, args.gw, args.threshold)
    print(f"Player {args.player_id}, GW{args.gw}, over {args.threshold}: {outcome.value}")


def cmd_resolve_full90(args: argparse.Namespace) -> None:
    outcome = resolve_full90(args.player_id, args.gw)
    print(f"Player {args.player_id}, GW{args.gw}, full 90: {outcome.value}")


def cmd_gw_status(args: argparse.Namespace) -> None:
    finished = is_gameweek_finished(args.gw)
    print(f"GW{args.gw}: {'finished -- ready to resolve points markets' if finished else 'not finished yet'}")


def cmd_resolve_gameweek(args: argparse.Namespace) -> None:
    bootstrap = cache.load_latest_bootstrap_static()
    players = top_expensive_players(bootstrap, n=args.n)
    finished = is_gameweek_finished(args.gw)
    print(f"GW{args.gw}: {'finished -- resolving' if finished else 'not finished yet -- everything below is PENDING'}")
    outcomes = resolve_gameweek_points_markets([p.id for p in players], args.gw)
    for player in players:
        primary = outcomes[(player.id, PRIMARY_POINTS_THRESHOLD)].value
        secondary = outcomes[(player.id, SECONDARY_POINTS_THRESHOLD)].value
        print(f"  {player.web_name:<20} over {PRIMARY_POINTS_THRESHOLD}: {primary:<8} over {SECONDARY_POINTS_THRESHOLD}: {secondary}")


def cmd_generate_picks(args: argparse.Namespace) -> None:
    from .agents import generate_picks_for_gameweek, save_picks

    results = generate_picks_for_gameweek(args.gw, n_players=args.n)
    path = save_picks(args.gw, results)
    for r in results:
        status = f"{len(r.picks)} picks" if not r.error else f"ERROR: {r.error}"
        print(f"  {r.model.name:<24} {status}")
    print(f"Saved -> {path}")


def cmd_score_gameweek(args: argparse.Namespace) -> None:
    from .leaderboard import score_gameweek, update_leaderboard

    summary = score_gameweek(args.gw)
    path = update_leaderboard(summary)
    for m in summary["models"]:
        acc = f"{m['accuracy']:.0%}" if m["accuracy"] is not None else "n/a"
        print(f"  {m['name']:<24} correct={m['correct']} wrong={m['wrong']} pending={m['pending']} acc={acc}")
    print(f"Updated leaderboard -> {path}")


def _next_pick_gameweek(bootstrap: dict) -> int | None:
    """The gameweek whose deadline hasn't passed yet -- what
    `auto-generate-picks` should target. None if there isn't one (no
    events data cached, or every known gameweek is already finished or
    past its deadline)."""
    now = datetime.now(timezone.utc)
    upcoming = []
    for event in bootstrap.get("events", []):
        if event.get("finished"):
            continue
        deadline = event.get("deadline_time")
        if not deadline:
            continue
        if datetime.fromisoformat(deadline.replace("Z", "+00:00")) > now:
            upcoming.append(event)
    if not upcoming:
        return None
    return min(upcoming, key=lambda e: e["id"])["id"]


def _has_any_real_picks(saved: dict) -> bool:
    """False if every model in a saved picks file errored out (e.g. a run
    with OPENROUTER_API_KEY missing or every model transiently down) --
    that's not a real generation to protect from being overwritten, it's
    a failed attempt that should be retried on the next run."""
    return any(model.get("picks") for model in saved.get("models", []))


def cmd_auto_generate_picks(args: argparse.Namespace) -> None:
    from .agents import PICKS_DIR, generate_picks_for_gameweek, load_picks, save_picks

    bootstrap = cache.load_latest_bootstrap_static()
    gw = _next_pick_gameweek(bootstrap)
    if gw is None:
        print("No upcoming gameweek with an open deadline -- nothing to pick.")
        return

    picks_path = PICKS_DIR / f"gw{gw}.json"
    if picks_path.exists() and not args.force:
        if _has_any_real_picks(load_picks(gw, picks_dir=PICKS_DIR)):
            print(f"GW{gw} picks already exist at {picks_path} -- skipping (pass --force to regenerate).")
            return
        print(f"GW{gw} picks exist at {picks_path} but every model errored last time -- retrying.")

    print(f"Generating agent picks for GW{gw}...")
    results = generate_picks_for_gameweek(gw, n_players=args.n)
    path = save_picks(gw, results)
    for r in results:
        status = f"{len(r.picks)} picks" if not r.error else f"ERROR: {r.error}"
        print(f"  {r.model.name:<24} {status}")
    print(f"Saved -> {path}")


def cmd_auto_score(args: argparse.Namespace) -> None:
    from .agents import PICKS_DIR
    from .leaderboard import LEADERBOARD_PATH, score_gameweek, update_leaderboard

    if LEADERBOARD_PATH.exists():
        board = json.loads(LEADERBOARD_PATH.read_text())
        scored_gws = {int(g) for g in board.get("gameweeks", {})}
    else:
        scored_gws = set()

    available = (
        sorted(int(p.stem.removeprefix("gw")) for p in PICKS_DIR.glob("gw*.json"))
        if PICKS_DIR.exists()
        else []
    )
    to_score = [gw for gw in available if gw not in scored_gws and is_gameweek_finished(gw)]
    if not to_score:
        print("No finished gameweeks with unscored picks.")
        return

    for gw in to_score:
        print(f"Scoring GW{gw}...")
        summary = score_gameweek(gw)
        update_leaderboard(summary)
        for m in summary["models"]:
            acc = f"{m['accuracy']:.0%}" if m["accuracy"] is not None else "n/a"
            print(f"  {m['name']:<24} correct={m['correct']} wrong={m['wrong']} pending={m['pending']} acc={acc}")
    print(f"Updated leaderboard -> {LEADERBOARD_PATH}")


def _markets_for_gw(saved: dict) -> list[tuple[int, int]]:
    """Every (player_id, threshold) pair any agent was asked to pick for
    a gameweek -- the settlement candidate set. A superset of whatever
    the site's markets grid actually showed (agents are asked about
    more players than the frontend's top-N market cards render), which
    is exactly what's wanted: settling a market nobody ever staked on
    is a costless no-op (see MarketLedger's settle handler), so being
    generous about which markets to check risks nothing.
    """
    markets: set[tuple[int, int]] = set()
    for model in saved.get("models", []):
        for pick in model.get("picks", []):
            markets.add((pick["player_id"], pick["threshold"]))
    return sorted(markets)


def _settle_gameweek(gw: int) -> None:
    import os

    import requests

    from .agents import PICKS_DIR, load_picks

    faucet_url = os.environ.get("FAUCET_URL", "").strip().rstrip("/")
    settlement_key = os.environ.get("SETTLEMENT_API_KEY", "").strip()
    if not faucet_url or not settlement_key:
        print(
            f"GW{gw}: FAUCET_URL and/or SETTLEMENT_API_KEY not set in the environment -- "
            "can't settle without them.",
            file=sys.stderr,
        )
        return

    saved = load_picks(gw, picks_dir=PICKS_DIR)
    markets = _markets_for_gw(saved)
    print(f"GW{gw}: settling {len(markets)} candidate market(s)...")
    for player_id, threshold in markets:
        outcome = resolve_points_threshold(player_id, gw, threshold)
        if outcome == MarketOutcome.PENDING:
            # Shouldn't happen -- the caller already checked
            # is_gameweek_finished(gw) -- but never send a PENDING
            # outcome to the Worker; /settle only accepts yes/no.
            print(f"  player={player_id} over {threshold}: still PENDING, skipping")
            continue

        url = f"{faucet_url}/markets/{player_id}/{gw}/{threshold}/settle"
        try:
            resp = requests.post(
                url,
                json={"outcome": outcome.value},
                headers={"authorization": f"Bearer {settlement_key}"},
                # Generous: each call can involve one or more real,
                # sequentially-broadcast on-chain transfers (see
                # MarketLedger's settle handler) -- a market with
                # several winners genuinely can take a while.
                timeout=180,
            )
            body = resp.json()
        except Exception as exc:  # network error, timeout, bad JSON, ...
            print(f"  player={player_id} over {threshold}: ERROR {exc}")
            continue

        if resp.status_code >= 400:
            print(f"  player={player_id} over {threshold}: {outcome.value} -- error: {body.get('error', resp.status_code)}")
            continue

        payouts = body.get("payouts", [])
        paid = sum(1 for p in payouts if p.get("ok"))
        print(
            f"  player={player_id} over {threshold}: {outcome.value} -- "
            f"{body.get('status')}, {paid}/{len(payouts)} payout(s) sent"
        )


def cmd_settle_gameweek(args: argparse.Namespace) -> None:
    if not is_gameweek_finished(args.gw):
        print(f"GW{args.gw} isn't finished yet -- can't settle a pending result.")
        return
    _settle_gameweek(args.gw)


def cmd_auto_settle(_args: argparse.Namespace) -> None:
    from .agents import PICKS_DIR

    available = (
        sorted(int(p.stem.removeprefix("gw")) for p in PICKS_DIR.glob("gw*.json"))
        if PICKS_DIR.exists()
        else []
    )
    finished = [gw for gw in available if is_gameweek_finished(gw)]
    if not finished:
        print("No finished gameweeks to settle.")
        return
    for gw in finished:
        _settle_gameweek(gw)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="data_pipeline", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("fetch-bootstrap", help="Fetch and cache the current bootstrap-static snapshot").set_defaults(
        func=cmd_fetch_bootstrap
    )
    sub.add_parser("fetch-fixtures", help="Fetch and cache the current fixture list").set_defaults(
        func=cmd_fetch_fixtures
    )

    fetch_live = sub.add_parser("fetch-live", help="Fetch and cache one gameweek's live stats")
    fetch_live.add_argument("gw", type=int, help="Gameweek number")
    fetch_live.set_defaults(func=cmd_fetch_live)

    top20 = sub.add_parser("top20", help="List the most expensive players from the cached snapshot")
    top20.add_argument("--n", type=int, default=20)
    top20.set_defaults(func=cmd_top20)

    points = sub.add_parser("points", help="Points result (+ over-5/over-10 verdicts) for a player in one gameweek")
    points.add_argument("player_id", type=int)
    points.add_argument("--gw", type=int, required=True)
    points.set_defaults(func=cmd_points)

    full90 = sub.add_parser("full90", help="Full-90-minutes outcome for a player in one gameweek")
    full90.add_argument("player_id", type=int)
    full90.add_argument("--gw", type=int, required=True)
    full90.set_defaults(func=cmd_full90)

    resolve_points = sub.add_parser(
        "resolve-points", help="Payout-safe outcome (PENDING/YES/NO) for the points-threshold market"
    )
    resolve_points.add_argument("player_id", type=int)
    resolve_points.add_argument("--gw", type=int, required=True)
    resolve_points.add_argument("--threshold", type=int, required=True)
    resolve_points.set_defaults(func=cmd_resolve_points)

    resolve_full90_parser = sub.add_parser(
        "resolve-full90", help="Payout-safe outcome (PENDING/YES/NO) for the full-90 market"
    )
    resolve_full90_parser.add_argument("player_id", type=int)
    resolve_full90_parser.add_argument("--gw", type=int, required=True)
    resolve_full90_parser.set_defaults(func=cmd_resolve_full90)

    gw_status = sub.add_parser("gw-status", help="Whether every fixture in a gameweek has finished")
    gw_status.add_argument("gw", type=int)
    gw_status.set_defaults(func=cmd_gw_status)

    resolve_gameweek = sub.add_parser(
        "resolve-gameweek", help="Resolve the points market for every top-N player in one gameweek at once"
    )
    resolve_gameweek.add_argument("--gw", type=int, required=True)
    resolve_gameweek.add_argument("--n", type=int, default=20)
    resolve_gameweek.set_defaults(func=cmd_resolve_gameweek)

    generate_picks = sub.add_parser(
        "generate-picks", help="Ask the configured OpenRouter models for picks on one gameweek's player pool"
    )
    generate_picks.add_argument("--gw", type=int, required=True)
    generate_picks.add_argument("--n", type=int, default=20)
    generate_picks.set_defaults(func=cmd_generate_picks)

    score_gameweek_parser = sub.add_parser(
        "score-gameweek", help="Score one gameweek's saved agent picks against resolved outcomes"
    )
    score_gameweek_parser.add_argument("--gw", type=int, required=True)
    score_gameweek_parser.set_defaults(func=cmd_score_gameweek)

    auto_generate_picks = sub.add_parser(
        "auto-generate-picks",
        help="Generate picks for whichever gameweek's deadline hasn't passed yet (skips if already generated)",
    )
    auto_generate_picks.add_argument("--n", type=int, default=20)
    auto_generate_picks.add_argument(
        "--force", action="store_true", help="Regenerate even if picks already exist for that gameweek"
    )
    auto_generate_picks.set_defaults(func=cmd_auto_generate_picks)

    auto_score = sub.add_parser(
        "auto-score", help="Score every finished gameweek that has saved picks but isn't in the leaderboard yet"
    )
    auto_score.set_defaults(func=cmd_auto_score)

    settle_gameweek = sub.add_parser(
        "settle-gameweek",
        help="Resolve and pay out every candidate market for one finished gameweek "
        "(needs FAUCET_URL and SETTLEMENT_API_KEY in the environment)",
    )
    settle_gameweek.add_argument("--gw", type=int, required=True)
    settle_gameweek.set_defaults(func=cmd_settle_gameweek)

    auto_settle = sub.add_parser(
        "auto-settle",
        help="Settle every finished gameweek that has saved picks -- safe to call repeatedly, "
        "settlement itself is idempotent per market",
    )
    auto_settle.set_defaults(func=cmd_auto_settle)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        args.func(args)
    except Exception as exc:  # surface cache/network errors cleanly, not a traceback
        print(f"error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
