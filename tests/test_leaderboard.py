import json
from pathlib import Path

import pytest

from data_pipeline import cache
from data_pipeline.agents import AgentModel, AgentPick, ModelPicksResult, save_picks
from data_pipeline.leaderboard import score_gameweek, update_leaderboard

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture()
def populated_cache(tmp_path):
    """Same GW1-finished setup as test_resolution.py: Haaland (id=1) scored
    12 pts, Salah (id=2) scored 6 pts, both fixtures finished."""
    cache_dir = tmp_path / "cache"
    bootstrap = json.loads((FIXTURES / "bootstrap_static_sample.json").read_text())
    cache.save_bootstrap_static(bootstrap, cache_dir=cache_dir)
    fixtures = json.loads((FIXTURES / "fixtures_sample.json").read_text())
    cache.save_fixtures(fixtures, cache_dir=cache_dir)
    payload = json.loads((FIXTURES / "event_live_gw1.json").read_text())
    cache.save_event_live(1, payload, cache_dir=cache_dir)
    return cache_dir


def _save_gw1_picks(picks_dir: Path, *, model_name: str, model_slug: str, picks: list[AgentPick]):
    model = AgentModel(model_slug, model_name)
    save_picks(1, [ModelPicksResult(model=model, picks=picks, error=None)], picks_dir=picks_dir)


def test_score_gameweek_counts_correct_and_wrong(tmp_path, populated_cache):
    picks_dir = tmp_path / "agent_picks"
    _save_gw1_picks(
        picks_dir,
        model_name="Perfect Model",
        model_slug="perfect/model",
        picks=[
            # Haaland: 12 pts -- over 5 YES, over 10 YES. Both picks correct.
            AgentPick(player_id=1, threshold=5, pick=True, confidence=None),
            AgentPick(player_id=1, threshold=10, pick=True, confidence=None),
            # Salah: 6 pts -- over 5 YES, over 10 NO.
            AgentPick(player_id=2, threshold=5, pick=True, confidence=None),  # correct
            AgentPick(player_id=2, threshold=10, pick=True, confidence=None),  # wrong (actual: NO)
        ],
    )

    summary = score_gameweek(1, cache_dir=populated_cache, picks_dir=picks_dir)
    assert summary["gw"] == 1
    model = summary["models"][0]
    assert model["slug"] == "perfect/model"
    assert model["correct"] == 3
    assert model["wrong"] == 1
    assert model["pending"] == 0
    assert model["accuracy"] == pytest.approx(0.75)


def test_score_gameweek_raises_if_not_finished(tmp_path, populated_cache):
    picks_dir = tmp_path / "agent_picks"
    _save_gw1_picks(
        picks_dir,
        model_name="Model",
        model_slug="some/model",
        picks=[AgentPick(player_id=1, threshold=5, pick=True, confidence=None)],
    )
    with pytest.raises(ValueError):
        score_gameweek(3, cache_dir=populated_cache, picks_dir=picks_dir)


def test_update_leaderboard_accumulates_across_gameweeks(tmp_path):
    leaderboard_path = tmp_path / "leaderboard.json"

    gw1_summary = {
        "gw": 1,
        "scored_at": "2026-01-01T00:00:00+00:00",
        "models": [{"slug": "a/model", "name": "A Model", "correct": 3, "wrong": 1, "pending": 0, "accuracy": 0.75}],
    }
    gw2_summary = {
        "gw": 2,
        "scored_at": "2026-01-08T00:00:00+00:00",
        "models": [{"slug": "a/model", "name": "A Model", "correct": 1, "wrong": 3, "pending": 0, "accuracy": 0.25}],
    }

    update_leaderboard(gw1_summary, leaderboard_path=leaderboard_path)
    path = update_leaderboard(gw2_summary, leaderboard_path=leaderboard_path)

    board = json.loads(path.read_text())
    assert set(board["gameweeks"].keys()) == {"1", "2"}
    totals = board["totals"]["a/model"]
    assert totals["correct"] == 4
    assert totals["wrong"] == 4
    assert totals["pending"] == 0
    assert totals["accuracy"] == pytest.approx(0.5)


def test_update_leaderboard_rescoring_a_gameweek_replaces_not_doubles(tmp_path):
    leaderboard_path = tmp_path / "leaderboard.json"
    summary_v1 = {
        "gw": 1,
        "scored_at": "2026-01-01T00:00:00+00:00",
        "models": [{"slug": "a/model", "name": "A Model", "correct": 1, "wrong": 1, "pending": 0, "accuracy": 0.5}],
    }
    summary_v2 = {
        "gw": 1,
        "scored_at": "2026-01-01T01:00:00+00:00",
        "models": [{"slug": "a/model", "name": "A Model", "correct": 2, "wrong": 0, "pending": 0, "accuracy": 1.0}],
    }
    update_leaderboard(summary_v1, leaderboard_path=leaderboard_path)
    path = update_leaderboard(summary_v2, leaderboard_path=leaderboard_path)

    board = json.loads(path.read_text())
    assert len(board["gameweeks"]) == 1
    assert board["totals"]["a/model"]["correct"] == 2
    assert board["totals"]["a/model"]["wrong"] == 0
