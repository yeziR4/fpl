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

The `fetch-*` commands need outbound access to fantasy.premierleague.com
and must be run from an environment that has it. The rest only read
whatever has already been cached locally under data/cache/.

`points` / `full90` show the raw stat for a gameweek as soon as *any*
snapshot is cached for it, even mid-match -- useful for sanity-checking
the pipeline. `resolve-points` / `resolve-full90` are what a market
should actually call to decide a payout: they return PENDING until the
underlying fixture is confirmed finished, never a premature YES/NO off
a partial or provisional snapshot. See data_pipeline/resolution.py.
"""

from __future__ import annotations

import argparse
import sys

from . import cache
from .players import top_expensive_players
from .resolution import (
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
