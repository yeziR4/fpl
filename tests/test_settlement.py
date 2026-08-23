import json
from pathlib import Path

import pytest

from data_pipeline import cache
from data_pipeline.settlement import (
    PRIMARY_POINTS_THRESHOLD,
    SECONDARY_POINTS_THRESHOLD,
    full90_result,
    points_result,
)

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture()
def populated_cache(tmp_path):
    """A cache dir with GW1 and GW2 live snapshots already 'fetched'."""
    cache_dir = tmp_path / "cache"
    for gw, fixture_name in [(1, "event_live_gw1.json"), (2, "event_live_gw2.json")]:
        payload = json.loads((FIXTURES / fixture_name).read_text())
        cache.save_event_live(gw, payload, cache_dir=cache_dir)
    return cache_dir


def test_points_result_reads_single_gameweek(populated_cache):
    # Haaland (id=1): 12 pts in GW1, 2 pts in GW2 -- these must not be summed.
    gw1 = points_result(1, gw=1, cache_dir=populated_cache)
    gw2 = points_result(1, gw=2, cache_dir=populated_cache)
    assert gw1.points == 12
    assert gw2.points == 2


def test_points_result_over_primary_threshold(populated_cache):
    gw1 = points_result(1, gw=1, cache_dir=populated_cache)  # 12 pts
    gw2 = points_result(1, gw=2, cache_dir=populated_cache)  # 2 pts
    assert gw1.over(PRIMARY_POINTS_THRESHOLD) is True  # 12 >= 5
    assert gw2.over(PRIMARY_POINTS_THRESHOLD) is False  # 2 < 5


def test_points_result_over_secondary_threshold(populated_cache):
    gw1 = points_result(1, gw=1, cache_dir=populated_cache)  # 12 pts
    assert gw1.over(SECONDARY_POINTS_THRESHOLD) is True  # 12 >= 10
    gw2 = points_result(1, gw=2, cache_dir=populated_cache)  # 2 pts
    assert gw2.over(SECONDARY_POINTS_THRESHOLD) is False  # 2 < 10


def test_points_result_none_when_gameweek_not_cached(populated_cache):
    assert points_result(1, gw=99, cache_dir=populated_cache) is None


def test_full90_result_flags_short_appearance(populated_cache):
    gw1 = full90_result(1, gw=1, cache_dir=populated_cache)  # 90 min
    gw2 = full90_result(1, gw=2, cache_dir=populated_cache)  # 74 min
    assert gw1.played_full_90 is True
    assert gw2.played_full_90 is False
    assert gw2.minutes == 74


def test_full90_result_zero_minutes_is_not_full90(populated_cache):
    result = full90_result(3, gw=2, cache_dir=populated_cache)  # 0 min
    assert result.minutes == 0
    assert result.played_full_90 is False


def test_full90_result_none_when_gameweek_not_cached(populated_cache):
    assert full90_result(1, gw=99, cache_dir=populated_cache) is None
