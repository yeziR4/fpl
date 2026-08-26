import argparse
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from data_pipeline import cache
from data_pipeline.agents import AGENT_MODELS, AgentPick, ModelPicksResult
from data_pipeline.cli import _has_any_real_picks, _next_pick_gameweek, cmd_auto_generate_picks


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


# ---- _has_any_real_picks / cmd_auto_generate_picks retry behaviour -----
#
# Confirmed the hard way, via a real workflow_dispatch run against this
# feature's very first push: OPENROUTER_API_KEY wasn't set yet, every
# model errored, and a naive "skip if the picks file already exists"
# check would have left that gameweek permanently stuck on an
# all-errors file even after the key was added -- see git history for
# the write-up. These tests pin the fix: a save with zero real picks
# must never count as "already generated".


def test_has_any_real_picks_true_when_any_model_has_picks():
    saved = {"models": [{"picks": []}, {"picks": [{"player_id": 1, "threshold": 5, "pick": "yes"}]}]}
    assert _has_any_real_picks(saved) is True


def test_has_any_real_picks_false_when_every_model_errored():
    saved = {"models": [{"picks": [], "error": "boom"}, {"picks": [], "error": "boom"}]}
    assert _has_any_real_picks(saved) is False


def test_has_any_real_picks_false_with_no_models():
    assert _has_any_real_picks({"models": []}) is False


def test_auto_generate_picks_retries_after_a_run_where_every_model_errored(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)

    now = datetime.now(timezone.utc)
    bootstrap = {
        "events": [{"id": 1, "finished": False, "deadline_time": _iso(now + timedelta(days=7))}],
        "elements": [
            {
                "id": 1,
                "web_name": "Player",
                "team": 1,
                "element_type": 4,
                "now_cost": 100,
                "code": 1,
                "has_temporary_code": False,
                "total_points": 0,
                "goals_scored": 0,
                "assists": 0,
            }
        ],
        "teams": [{"id": 1, "short_name": "AAA"}],
    }
    cache.save_bootstrap_static(bootstrap)
    cache.save_fixtures([])

    call_count = {"n": 0}

    def fake_generate(gw, *, n_players=20, thresholds=(5, 10), **kwargs):
        call_count["n"] += 1
        model = AGENT_MODELS[0]
        if call_count["n"] == 1:
            return [ModelPicksResult(model=model, picks=[], error="OPENROUTER_API_KEY is not set")]
        return [
            ModelPicksResult(
                model=model,
                picks=[AgentPick(player_id=1, threshold=5, pick=True, confidence=None)],
                error=None,
            )
        ]

    monkeypatch.setattr("data_pipeline.agents.generate_picks_for_gameweek", fake_generate)

    args = argparse.Namespace(n=1, force=False)
    picks_path = Path("data/agent_picks/gw1.json")

    cmd_auto_generate_picks(args)  # 1st run: no key, every model errors
    assert call_count["n"] == 1
    assert _has_any_real_picks(json.loads(picks_path.read_text())) is False

    cmd_auto_generate_picks(args)  # 2nd run: must retry, not skip
    assert call_count["n"] == 2
    assert _has_any_real_picks(json.loads(picks_path.read_text())) is True

    cmd_auto_generate_picks(args)  # 3rd run: real picks now saved -- skip
    assert call_count["n"] == 2
