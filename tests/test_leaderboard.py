"""Tests for scoring agent forecasts against real outcomes.

Ported from the VARA version. The correctness half kept its intent entirely --
per-pick verdicts, pending handled honestly, never scoring an unfinished
gameweek. The economics half was rebuilt: `staked_vara`/`simulated_pnl_vara`
are gone, `staked_usdc` reflects an intended trade, and `brier` measures
whether the model's stated probability was calibrated.

The new cases worth having are the ones the old design could not express: a
forecast with no side (no edge, so no trade) must count as neither correct nor
wrong, and a saved pick missing its player/threshold must be reported rather
than silently dropped.
"""

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
    12 pts, Salah (id=2) scored 6 pts, both fixtures finished. Id 4 has a
    finished fixture but no cached live snapshot, so it stays PENDING."""
    cache_dir = tmp_path / "cache"
    bootstrap = json.loads((FIXTURES / "bootstrap_static_sample.json").read_text())
    cache.save_bootstrap_static(bootstrap, cache_dir=cache_dir)
    fixtures = json.loads((FIXTURES / "fixtures_sample.json").read_text())
    cache.save_fixtures(fixtures, cache_dir=cache_dir)
    payload = json.loads((FIXTURES / "event_live_gw1.json").read_text())
    cache.save_event_live(1, payload, cache_dir=cache_dir)
    return cache_dir


def _pick(market_id, player_id, threshold, probability, stake=1.0, yes=0.50, no=0.50):
    """A forecast whose side is whatever probability vs these prices implies."""
    return AgentPick(
        market_id=market_id,
        probability=probability,
        stake_usdc=stake,
        player_id=player_id,
        threshold=threshold,
        yes_price=yes,
        no_price=no,
    )


def _save_gw1_picks(picks_dir: Path, *, model_name: str, model_slug: str, picks: list[AgentPick]):
    model = AgentModel(model_slug, model_name)
    save_picks(1, [ModelPicksResult(model=model, picks=picks, error=None)], picks_dir=picks_dir)


# ---- correctness --------------------------------------------------------


def test_score_gameweek_counts_correct_and_wrong(tmp_path, populated_cache):
    picks_dir = tmp_path / "agent_picks"
    _save_gw1_picks(
        picks_dir,
        model_name="Perfect Model",
        model_slug="perfect/model",
        picks=[
            # Haaland: 12 pts -- over 5 YES, over 10 YES. Both correct.
            _pick("m1", 1, 5, 0.9),
            _pick("m2", 1, 10, 0.9),
            # Salah: 6 pts -- over 5 YES (correct), over 10 NO (so a YES pick is wrong).
            _pick("m3", 2, 5, 0.7),
            _pick("m4", 2, 10, 0.7),
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


def test_score_gameweek_includes_per_pick_outcomes(tmp_path, populated_cache):
    picks_dir = tmp_path / "agent_picks"
    _save_gw1_picks(
        picks_dir,
        model_name="Perfect Model",
        model_slug="perfect/model",
        picks=[
            _pick("m1", 1, 5, 0.9),   # correct
            _pick("m2", 2, 10, 0.7),  # wrong (actual NO, picked YES)
            _pick("m3", 4, 5, 0.9),   # no cached live snapshot -> pending
        ],
    )

    summary = score_gameweek(1, cache_dir=populated_cache, picks_dir=picks_dir)
    outcomes = {(p["player_id"], p["threshold"]): p["outcome"] for p in summary["models"][0]["picks"]}
    assert outcomes[(1, 5)] == "correct"
    assert outcomes[(2, 10)] == "wrong"
    assert outcomes[(4, 5)] == "pending"


def test_score_gameweek_raises_if_not_finished(tmp_path, populated_cache):
    picks_dir = tmp_path / "agent_picks"
    _save_gw1_picks(
        picks_dir, model_name="Model", model_slug="some/model", picks=[_pick("m1", 1, 5, 0.9)]
    )
    with pytest.raises(ValueError):
        score_gameweek(3, cache_dir=populated_cache, picks_dir=picks_dir)


# ---- economics: staked_usdc and Brier -----------------------------------


def test_score_gameweek_tracks_staked_usdc_and_brier(tmp_path, populated_cache):
    picks_dir = tmp_path / "agent_picks"
    _save_gw1_picks(
        picks_dir,
        model_name="Bettor",
        model_slug="bettor/model",
        picks=[
            # Haaland over 5 is really YES; a 0.8 forecast against a 0.50 price
            # takes YES, is correct, and scores (0.8 - 1)^2 = 0.04.
            _pick("m1", 1, 5, 0.8, stake=2.0),
            # Salah over 10 is really NO; a 0.7 forecast takes YES, is wrong,
            # and scores (0.7 - 0)^2 = 0.49.
            _pick("m2", 2, 10, 0.7, stake=1.0),
        ],
    )

    model = score_gameweek(1, cache_dir=populated_cache, picks_dir=picks_dir)["models"][0]
    assert model["correct"] == 1
    assert model["wrong"] == 1
    assert model["staked_usdc"] == pytest.approx(3.0)
    assert model["brier"] == pytest.approx((0.04 + 0.49) / 2)
    # Not recomputed from our own numbers -- it is a fact about the chain.
    assert model["realised_pnl_usdc"] is None


def test_pending_picks_dont_count_toward_stake_or_brier(tmp_path, populated_cache):
    picks_dir = tmp_path / "agent_picks"
    _save_gw1_picks(
        picks_dir,
        model_name="Bettor",
        model_slug="bettor/model",
        picks=[_pick("m1", 4, 5, 0.9, stake=4.0)],  # PENDING on our own pipeline
    )

    model = score_gameweek(1, cache_dir=populated_cache, picks_dir=picks_dir)["models"][0]
    assert model["pending"] == 1
    assert model["staked_usdc"] == 0.0
    assert model["brier"] is None


def test_a_forecast_with_no_side_is_neither_correct_nor_wrong(tmp_path, populated_cache):
    """No edge means no trade, so it cannot win or lose -- but it IS a forecast,
    so it still counts toward calibration."""
    picks_dir = tmp_path / "agent_picks"
    _save_gw1_picks(
        picks_dir,
        model_name="Watcher",
        model_slug="watcher/model",
        picks=[_pick("m1", 1, 5, 0.5, yes=0.52, no=0.50)],  # no +EV side at these prices
    )

    model = score_gameweek(1, cache_dir=populated_cache, picks_dir=picks_dir)["models"][0]
    assert (model["correct"], model["wrong"]) == (0, 0)
    assert model["no_trade"] == 1
    assert model["accuracy"] is None
    assert model["staked_usdc"] == 0.0
    # Still a forecast about the world, so it still scores.
    assert model["brier"] == pytest.approx((0.5 - 1) ** 2)


def test_a_pick_missing_its_player_is_reported_not_silently_dropped(tmp_path, populated_cache):
    picks_dir = tmp_path / "agent_picks"
    _save_gw1_picks(
        picks_dir,
        model_name="Old File",
        model_slug="old/model",
        picks=[AgentPick("m1", 0.6, 1.0)],  # no player_id / threshold
    )

    model = score_gameweek(1, cache_dir=populated_cache, picks_dir=picks_dir)["models"][0]
    assert model["unscorable"] == 1
    assert (model["correct"], model["wrong"]) == (0, 0)
    assert model["picks"][0]["outcome"] == "unscorable"


# ---- update_leaderboard -------------------------------------------------


def _summary(gw, models):
    return {"gw": gw, "scored_at": "2026-01-01T00:00:00+00:00", "models": models}


def _model(slug, correct=0, wrong=0, pending=0, staked=0.0, brier_sum=0.0, brier_count=0):
    return {
        "slug": slug,
        "name": slug,
        "correct": correct,
        "wrong": wrong,
        "pending": pending,
        "no_trade": 0,
        "unscorable": 0,
        "staked_usdc": staked,
        "brier": (brier_sum / brier_count) if brier_count else None,
        "_brier_sum": brier_sum,
        "_brier_count": brier_count,
    }


def test_update_leaderboard_accumulates_across_gameweeks(tmp_path):
    path = tmp_path / "leaderboard.json"
    update_leaderboard(_summary(1, [_model("a/model", correct=3, wrong=1)]), leaderboard_path=path)
    update_leaderboard(_summary(2, [_model("a/model", correct=2, wrong=2)]), leaderboard_path=path)

    board = json.loads(path.read_text())
    t = board["totals"]["a/model"]
    assert t["correct"] == 5
    assert t["wrong"] == 3
    assert t["accuracy"] == pytest.approx(5 / 8)


def test_update_leaderboard_brier_is_a_true_mean_not_an_average_of_averages(tmp_path):
    """A gameweek with one forecast must not weigh as much as one with ten."""
    path = tmp_path / "leaderboard.json"
    # GW1: one forecast, squared error 0.9
    update_leaderboard(
        _summary(1, [_model("a/model", correct=1, brier_sum=0.9, brier_count=1)]), leaderboard_path=path
    )
    # GW2: three forecasts, squared error 0.3 each
    update_leaderboard(
        _summary(2, [_model("a/model", correct=3, brier_sum=0.9, brier_count=3)]), leaderboard_path=path
    )

    board = json.loads(path.read_text())
    # (0.9 + 0.9) / (1 + 3) = 0.45, NOT the average of 0.9 and 0.3
    assert board["totals"]["a/model"]["brier"] == pytest.approx(0.45)
    # working sums are not part of the output
    assert "_brier_sum" not in board["totals"]["a/model"]


def test_update_leaderboard_rescoring_a_gameweek_replaces_not_doubles(tmp_path):
    path = tmp_path / "leaderboard.json"
    update_leaderboard(_summary(1, [_model("a/model", correct=1, wrong=3)]), leaderboard_path=path)
    update_leaderboard(_summary(1, [_model("a/model", correct=4, wrong=0)]), leaderboard_path=path)

    board = json.loads(path.read_text())
    assert board["totals"]["a/model"]["correct"] == 4
    assert board["totals"]["a/model"]["wrong"] == 0


def test_update_leaderboard_tolerates_a_gameweek_scored_before_these_fields_existed(tmp_path):
    path = tmp_path / "leaderboard.json"
    old_shape = _summary(1, [{"slug": "a/model", "name": "A", "correct": 1, "wrong": 1, "pending": 0}])
    update_leaderboard(old_shape, leaderboard_path=path)

    t = json.loads(path.read_text())["totals"]["a/model"]
    assert t["staked_usdc"] == 0.0
    assert t["brier"] is None
    assert t["realised_pnl_usdc"] is None
