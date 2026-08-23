"""Local JSON snapshot cache.

The FPL API only ever tells you the *current* state -- there is no
endpoint that hands back "GW4's numbers" once GW9 has happened. If we
want a history to price and settle markets against, we have to take
our own snapshots over time and keep them. This module is that
snapshot store: plain timestamped JSON files on disk, nothing fancier
than that, because at this stage we care about correctness and
inspectability over throughput.

Layout under `cache_dir` (default: `data/cache/`):
  bootstrap_static/<ISO8601>.json   -- one per fetch
  bootstrap_static/latest.json      -- symlink-equivalent: a copy of the newest
  event_live/gw<N>/<ISO8601>.json   -- one per fetch for gameweek N
  event_live/gw<N>/latest.json      -- newest snapshot for gameweek N
  fixtures/<ISO8601>.json
  fixtures/latest.json
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_CACHE_DIR = Path("data/cache")


def _timestamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _write_snapshot(directory: Path, payload: object) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    snapshot_path = directory / f"{_timestamp()}.json"
    snapshot_path.write_text(json.dumps(payload, indent=2, sort_keys=True))
    (directory / "latest.json").write_text(json.dumps(payload, indent=2, sort_keys=True))
    return snapshot_path


def save_bootstrap_static(payload: dict, *, cache_dir: Path = DEFAULT_CACHE_DIR) -> Path:
    return _write_snapshot(cache_dir / "bootstrap_static", payload)


def save_fixtures(payload: list, *, cache_dir: Path = DEFAULT_CACHE_DIR) -> Path:
    return _write_snapshot(cache_dir / "fixtures", payload)


def save_event_live(event_id: int, payload: dict, *, cache_dir: Path = DEFAULT_CACHE_DIR) -> Path:
    return _write_snapshot(cache_dir / "event_live" / f"gw{event_id}", payload)


def load_latest_bootstrap_static(*, cache_dir: Path = DEFAULT_CACHE_DIR) -> dict:
    return _load_latest(cache_dir / "bootstrap_static")


def load_latest_fixtures(*, cache_dir: Path = DEFAULT_CACHE_DIR) -> list:
    return _load_latest(cache_dir / "fixtures")


def load_event_live(event_id: int, *, cache_dir: Path = DEFAULT_CACHE_DIR) -> dict:
    return _load_latest(cache_dir / "event_live" / f"gw{event_id}")


def has_event_live(event_id: int, *, cache_dir: Path = DEFAULT_CACHE_DIR) -> bool:
    return (cache_dir / "event_live" / f"gw{event_id}" / "latest.json").exists()


def _load_latest(directory: Path):
    latest_path = directory / "latest.json"
    if not latest_path.exists():
        raise FileNotFoundError(
            f"No cached snapshot at {latest_path}. Run the matching `fetch-*` "
            "CLI command first (from an environment with access to the FPL API)."
        )
    return json.loads(latest_path.read_text())
