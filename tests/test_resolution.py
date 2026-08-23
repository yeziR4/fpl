import json
from pathlib import Path

import pytest

from data_pipeline import cache
from data_pipeline.resolution import (
    FixtureStatus,
    MarketOutcome,
    fixture_status_for_player,
    resolve_full90,
    resolve_points_threshold,
)

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture()
def populated_cache(tmp_path):
    """A cache dir with bootstrap, fixtures, and GW1+GW2 live snapshots.

    Player teams (from bootstrap_static_sample.json): Haaland(1)=11,
    Salah(2)=10, Palmer(3)=6, Saka(4)=1.

    Fixture setup deliberately covers every resolution state:
      - Haaland's team: fixture finished at GW1, still in progress at GW2.
      - Salah's team: fixture finished at GW1, live snapshot cached too.
      - Saka's team: fixture finished at GW1, but no live snapshot was
        ever cached for Saka -- "finished match, data not fetched yet".
      - Palmer's team: no fixture entry at all -- "blank gameweek".
    """
    cache_dir = tmp_path / "cache"
    bootstrap = json.loads((FIXTURES / "bootstrap_static_sample.json").read_text())
    cache.save_bootstrap_static(bootstrap, cache_dir=cache_dir)
    fixtures = json.loads((FIXTURES / "fixtures_sample.json").read_text())
    cache.save_fixtures(fixtures, cache_dir=cache_dir)
    for gw, fixture_name in [(1, "event_live_gw1.json"), (2, "event_live_gw2.json")]:
        payload = json.loads((FIXTURES / fixture_name).read_text())
        cache.save_event_live(gw, payload, cache_dir=cache_dir)
    return cache_dir


def test_fixture_status_finished(populated_cache):
    assert fixture_status_for_player(1, gw=1, cache_dir=populated_cache) == FixtureStatus.FINISHED


def test_fixture_status_in_progress(populated_cache):
    assert fixture_status_for_player(1, gw=2, cache_dir=populated_cache) == FixtureStatus.IN_PROGRESS


def test_fixture_status_not_found_for_blank_gameweek(populated_cache):
    # Palmer's team has no fixture entry at all for GW1.
    assert fixture_status_for_player(3, gw=1, cache_dir=populated_cache) == FixtureStatus.NOT_FOUND


def test_resolve_full90_yes_once_finished(populated_cache):
    assert resolve_full90(1, gw=1, cache_dir=populated_cache) == MarketOutcome.YES


def test_resolve_full90_pending_while_fixture_in_progress(populated_cache):
    # A GW2 live snapshot exists for Haaland (74 min) but the fixture
    # isn't finished -- must not resolve off a partial snapshot.
    assert resolve_full90(1, gw=2, cache_dir=populated_cache) == MarketOutcome.PENDING


def test_resolve_full90_pending_when_finished_but_not_yet_fetched(populated_cache):
    # Saka's fixture is finished, but no live snapshot was ever cached
    # for him -- pending on our own pipeline, not a NO.
    assert resolve_full90(4, gw=1, cache_dir=populated_cache) == MarketOutcome.PENDING


def test_resolve_full90_pending_for_blank_gameweek(populated_cache):
    assert resolve_full90(3, gw=1, cache_dir=populated_cache) == MarketOutcome.PENDING


def test_resolve_points_threshold_yes_and_no(populated_cache):
    # Haaland: 12 pts in GW1, finished fixture.
    assert resolve_points_threshold(1, gw=1, threshold=5, cache_dir=populated_cache) == MarketOutcome.YES
    assert resolve_points_threshold(1, gw=1, threshold=10, cache_dir=populated_cache) == MarketOutcome.YES


def test_resolve_points_threshold_no_when_under(populated_cache):
    # Salah: 6 pts in GW1 -- clears the primary (5) line but not secondary (10).
    assert resolve_points_threshold(2, gw=1, threshold=5, cache_dir=populated_cache) == MarketOutcome.YES
    assert resolve_points_threshold(2, gw=1, threshold=10, cache_dir=populated_cache) == MarketOutcome.NO
