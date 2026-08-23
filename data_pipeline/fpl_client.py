"""Thin wrapper around the unofficial FPL API.

There is no official public API for Fantasy Premier League, but the
same three read-only, unauthenticated JSON endpoints have been stable
for years and are what every community tool (vaastav/Fantasy-Premier-
League, amosbastian/fpl, etc.) is built on:

  * bootstrap-static  -- all players, teams, gameweeks, current prices
  * fixtures          -- the fixture list, per gameweek
  * event/{id}/live    -- live/final stats (points, minutes, ...) for
                          every player in a specific gameweek

This module only talks HTTP and returns parsed JSON. It does not
cache and does not know about markets -- see `cache.py` and
`markets.py` for that.
"""

from __future__ import annotations

import time
from typing import Any

import requests

BASE_URL = "https://fantasy.premierleague.com/api"

# Real people are on the other end of this API. Keep request volume low
# and identify ourselves.
DEFAULT_HEADERS = {
    "User-Agent": "fpl-prediction-market-data-pipeline/0.1 (+https://github.com/yeziR4/fpl)"
}
DEFAULT_TIMEOUT = 15
MAX_RETRIES = 3
RETRY_BACKOFF_SECONDS = 2.0


class FPLClientError(RuntimeError):
    """Raised when the FPL API can't be reached or returns something unexpected."""


def _get_json(path: str, *, session: requests.Session | None = None) -> Any:
    url = f"{BASE_URL}/{path.lstrip('/')}"
    http = session or requests
    last_error: Exception | None = None

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = http.get(url, headers=DEFAULT_HEADERS, timeout=DEFAULT_TIMEOUT)
            response.raise_for_status()
            return response.json()
        except (requests.RequestException, ValueError) as exc:
            last_error = exc
            if attempt < MAX_RETRIES:
                time.sleep(RETRY_BACKOFF_SECONDS * attempt)

    raise FPLClientError(f"Failed to fetch {url} after {MAX_RETRIES} attempts: {last_error}")


def fetch_bootstrap_static(*, session: requests.Session | None = None) -> dict:
    """Players, teams, gameweeks, current prices -- the full current-state snapshot."""
    return _get_json("bootstrap-static/", session=session)


def fetch_fixtures(*, session: requests.Session | None = None) -> list[dict]:
    """The full fixture list, past and future, across all gameweeks."""
    return _get_json("fixtures/", session=session)


def fetch_event_live(event_id: int, *, session: requests.Session | None = None) -> dict:
    """Live/final per-player stats (points, minutes, goals, ...) for one gameweek."""
    return _get_json(f"event/{event_id}/live/", session=session)
