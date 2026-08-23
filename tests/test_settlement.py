import shutil
from pathlib import Path

import pytest

from data_pipeline import cache
from data_pipeline.settlement import full90_results, points_tally

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture()
def populated_cache(tmp_path):
    """A cache dir with GW1 and GW2 live snapshots already 'fetched'."""
    cache_dir = tmp_path / "cache"
    for gw, fixture_name in [(1, "event_live_gw1.json"), (2, "event_live_gw2.json")]:
        import json

        payload = json.loads((FIXTURES / fixture_name).read_text())
        cache.save_event_live(gw, payload, cache_dir=cache_dir)
    return cache_dir


def test_points_tally_sums_across_window(populated_cache):
    result = points_tally(1, start_gw=1, window=2, cache_dir=populated_cache)
    assert result.per_gw_points == {1: 12, 2: 2}
    assert result.total == 14
    assert result.is_complete is True


def test_points_tally_incomplete_when_a_gw_missing(populated_cache):
    # window extends to GW3, which was never cached
    result = points_tally(1, start_gw=1, window=3, cache_dir=populated_cache)
    assert result.per_gw_points == {1: 12, 2: 2}
    assert result.is_complete is False


def test_full90_results_flags_short_appearances(populated_cache):
    results = full90_results(1, start_gw=1, window=2, cache_dir=populated_cache)
    assert [r.played_full_90 for r in results] == [True, False]
    assert results[1].minutes == 74


def test_full90_results_zero_minutes_is_not_full90(populated_cache):
    results = full90_results(3, start_gw=1, window=2, cache_dir=populated_cache)
    assert [r.minutes for r in results] == [63, 0]
    assert all(not r.played_full_90 for r in results)


def test_full90_results_skips_uncached_gameweeks(populated_cache):
    results = full90_results(1, start_gw=1, window=5, cache_dir=populated_cache)
    assert len(results) == 2  # only GW1 and GW2 are cached
