from datetime import datetime, timedelta, timezone

from data_pipeline.cli import _next_pick_gameweek


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def test_next_pick_gameweek_picks_the_earliest_open_deadline():
    now = datetime.now(timezone.utc)
    bootstrap = {
        "events": [
            {"id": 1, "finished": True, "deadline_time": _iso(now - timedelta(days=7))},
            {"id": 3, "finished": False, "deadline_time": _iso(now + timedelta(days=14))},
            {"id": 2, "finished": False, "deadline_time": _iso(now + timedelta(days=7))},
        ]
    }
    assert _next_pick_gameweek(bootstrap) == 2


def test_next_pick_gameweek_ignores_finished_events_even_with_a_future_deadline():
    # Shouldn't happen in real FPL data, but a finished gameweek is
    # never a pick target regardless of what its deadline_time says.
    now = datetime.now(timezone.utc)
    bootstrap = {"events": [{"id": 1, "finished": True, "deadline_time": _iso(now + timedelta(days=1))}]}
    assert _next_pick_gameweek(bootstrap) is None


def test_next_pick_gameweek_none_when_every_deadline_has_passed():
    now = datetime.now(timezone.utc)
    bootstrap = {"events": [{"id": 1, "finished": False, "deadline_time": _iso(now - timedelta(hours=1))}]}
    assert _next_pick_gameweek(bootstrap) is None


def test_next_pick_gameweek_none_without_events_data():
    assert _next_pick_gameweek({}) is None
