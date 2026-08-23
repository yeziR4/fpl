"""Command-line entry points for the data pipeline.

    python -m data_pipeline.cli fetch-bootstrap
    python -m data_pipeline.cli fetch-fixtures
    python -m data_pipeline.cli fetch-live 4
    python -m data_pipeline.cli top20
    python -m data_pipeline.cli points 1 --gw 1
    python -m data_pipeline.cli full90 1 --gw 1

The `fetch-*` commands need outbound access to fantasy.premierleague.com
and must be run from an environment that has it. The rest (`top20`,
`points`, `full90`) only read whatever has already been cached locally
under data/cache/.
"""

from __future__ import annotations

import argparse
import sys

from . import cache
from .players import top_expensive_players
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
