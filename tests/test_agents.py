import json
from pathlib import Path

import pytest

from data_pipeline import cache
from data_pipeline.agents import (
    AgentModel,
    ModelPicksResult,
    OpenRouterError,
    build_prompt,
    call_model,
    generate_picks_for_gameweek,
    load_picks,
    parse_picks,
    save_picks,
)
from data_pipeline.players import top_expensive_players

FIXTURES = Path(__file__).parent / "fixtures"


def load_bootstrap():
    return json.loads((FIXTURES / "bootstrap_static_sample.json").read_text())


def load_fixtures():
    return json.loads((FIXTURES / "fixtures_sample.json").read_text())


@pytest.fixture()
def populated_cache(tmp_path):
    cache_dir = tmp_path / "cache"
    cache.save_bootstrap_static(load_bootstrap(), cache_dir=cache_dir)
    cache.save_fixtures(load_fixtures(), cache_dir=cache_dir)
    return cache_dir


# ---- build_prompt -----------------------------------------------------


def test_build_prompt_lists_every_player_and_threshold():
    players = top_expensive_players(load_bootstrap(), n=3)
    prompt = build_prompt(players, load_bootstrap(), load_fixtures(), gw=1, thresholds=(5, 10))
    assert "id=1 Haaland" in prompt
    assert "id=2 Salah" in prompt
    assert "id=3 Palmer" in prompt
    assert "Thresholds to judge for every player: 5, 10" in prompt
    assert "3 players x 2 thresholds = 6 entries total" in prompt


def test_build_prompt_shows_opponent_for_a_fixture_team():
    # Haaland's team (11) plays team 99 in GW1 (see fixtures_sample.json).
    # Team 99 isn't itself in the sample bootstrap's team list, so it
    # falls back to "?" -- this is exercising the fixture-lookup path,
    # not the team-name lookup, so that fallback is expected here.
    players = top_expensive_players(load_bootstrap(), n=1)
    prompt = build_prompt(players, load_bootstrap(), load_fixtures(), gw=1)
    assert "vs ?" in prompt or "@ ?" in prompt


def test_build_prompt_flags_blank_gameweek():
    # Palmer's team (6) has no fixture in the sample data for GW1.
    players = [p for p in top_expensive_players(load_bootstrap(), n=3) if p.web_name == "Palmer"]
    prompt = build_prompt(players, load_bootstrap(), load_fixtures(), gw=1)
    assert "no fixture (blank gameweek)" in prompt


# ---- parse_picks --------------------------------------------------------


def test_parse_picks_happy_path():
    raw = json.dumps(
        {
            "picks": [
                {"player_id": 1, "threshold": 5, "pick": "yes", "confidence": 0.8},
                {"player_id": 1, "threshold": 10, "pick": "no", "confidence": 0.4},
            ]
        }
    )
    picks = parse_picks(raw, valid_player_ids={1, 2}, valid_thresholds={5, 10})
    assert len(picks) == 2
    assert picks[0].player_id == 1 and picks[0].threshold == 5 and picks[0].pick is True
    assert picks[0].confidence == 0.8
    assert picks[1].pick is False


def test_parse_picks_strips_markdown_code_fences():
    raw = "```json\n" + json.dumps({"picks": [{"player_id": 1, "threshold": 5, "pick": "yes"}]}) + "\n```"
    picks = parse_picks(raw, valid_player_ids={1}, valid_thresholds={5})
    assert len(picks) == 1


def test_parse_picks_drops_entries_for_players_outside_the_pool():
    raw = json.dumps({"picks": [{"player_id": 999, "threshold": 5, "pick": "yes"}]})
    picks = parse_picks(raw, valid_player_ids={1}, valid_thresholds={5})
    assert picks == []


def test_parse_picks_drops_entries_with_unknown_threshold():
    raw = json.dumps({"picks": [{"player_id": 1, "threshold": 7, "pick": "yes"}]})
    picks = parse_picks(raw, valid_player_ids={1}, valid_thresholds={5, 10})
    assert picks == []


def test_parse_picks_drops_entries_with_a_bad_pick_value():
    raw = json.dumps({"picks": [{"player_id": 1, "threshold": 5, "pick": "maybe"}]})
    picks = parse_picks(raw, valid_player_ids={1}, valid_thresholds={5})
    assert picks == []


def test_parse_picks_ignores_out_of_range_confidence():
    raw = json.dumps({"picks": [{"player_id": 1, "threshold": 5, "pick": "yes", "confidence": 5}]})
    picks = parse_picks(raw, valid_player_ids={1}, valid_thresholds={5})
    assert picks[0].confidence is None


def test_parse_picks_returns_empty_on_garbage():
    assert parse_picks("not json at all", valid_player_ids={1}, valid_thresholds={5}) == []
    assert parse_picks("{}", valid_player_ids={1}, valid_thresholds={5}) == []
    assert parse_picks(json.dumps({"picks": "nope"}), valid_player_ids={1}, valid_thresholds={5}) == []
    assert parse_picks(json.dumps({"picks": ["nope"]}), valid_player_ids={1}, valid_thresholds={5}) == []


# ---- call_model / generate_picks_for_gameweek (network stubbed) --------


class _FakeResponse:
    def __init__(self, status_code=200, body=None):
        self.status_code = status_code
        self._body = body or {}

    def raise_for_status(self):
        if self.status_code >= 400:
            import requests

            raise requests.HTTPError(f"{self.status_code} error")

    def json(self):
        return self._body


class _FakeSession:
    """Stands in for requests.Session -- one canned response per call,
    or a per-model function so different models can behave differently
    in the same test."""

    def __init__(self, responder):
        self._responder = responder
        self.calls = []

    def post(self, url, *, headers, json, timeout):
        self.calls.append({"url": url, "headers": headers, "json": json, "timeout": timeout})
        return self._responder(json["model"])


def _content_response(text: str) -> _FakeResponse:
    return _FakeResponse(200, {"choices": [{"message": {"content": text}}]})


def test_call_model_returns_message_content(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    session = _FakeSession(lambda model: _content_response("hello"))
    model = AgentModel("some/model", "Some Model")
    assert call_model(model, "prompt", session=session) == "hello"
    assert session.calls[0]["headers"]["Authorization"] == "Bearer test-key"
    assert session.calls[0]["json"]["model"] == "some/model"


def test_call_model_raises_without_api_key(monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    model = AgentModel("some/model", "Some Model")
    with pytest.raises(OpenRouterError):
        call_model(model, "prompt", session=_FakeSession(lambda model: _content_response("x")))


def test_call_model_raises_on_http_error(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    session = _FakeSession(lambda model: _FakeResponse(500, {}))
    model = AgentModel("some/model", "Some Model")
    with pytest.raises(OpenRouterError):
        call_model(model, "prompt", session=session)


def test_call_model_raises_on_unexpected_shape(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    session = _FakeSession(lambda model: _FakeResponse(200, {"nope": "not what we expected"}))
    model = AgentModel("some/model", "Some Model")
    with pytest.raises(OpenRouterError):
        call_model(model, "prompt", session=session)


def test_generate_picks_for_gameweek_one_model_failing_doesnt_block_others(monkeypatch, populated_cache):
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")

    good = AgentModel("good/model", "Good Model")
    bad = AgentModel("bad/model", "Bad Model")

    def responder(model_slug):
        if model_slug == "bad/model":
            return _FakeResponse(500, {})
        return _content_response(json.dumps({"picks": [{"player_id": 1, "threshold": 5, "pick": "yes"}]}))

    session = _FakeSession(responder)
    results = generate_picks_for_gameweek(
        1, n_players=3, thresholds=(5,), cache_dir=populated_cache, models=(good, bad), session=session
    )

    by_slug = {r.model.slug: r for r in results}
    assert by_slug["good/model"].error is None
    assert len(by_slug["good/model"].picks) == 1
    assert by_slug["bad/model"].error is not None
    assert by_slug["bad/model"].picks == []


def test_generate_picks_for_gameweek_malformed_reply_yields_no_picks_and_an_error(
    monkeypatch, populated_cache
):
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    model = AgentModel("some/model", "Some Model")
    session = _FakeSession(lambda model: _content_response("garbage, not json"))
    results = generate_picks_for_gameweek(
        1, n_players=3, thresholds=(5,), cache_dir=populated_cache, models=(model,), session=session
    )
    assert results[0].picks == []
    assert results[0].error is not None


# ---- save_picks / load_picks --------------------------------------------


def test_save_and_load_picks_round_trip(tmp_path):
    picks_dir = tmp_path / "agent_picks"
    model = AgentModel("some/model", "Some Model")
    from data_pipeline.agents import AgentPick

    results = [
        ModelPicksResult(
            model=model,
            picks=[AgentPick(player_id=1, threshold=5, pick=True, confidence=0.9)],
            error=None,
        )
    ]
    path = save_picks(4, results, picks_dir=picks_dir)
    assert path == picks_dir / "gw4.json"

    loaded = load_picks(4, picks_dir=picks_dir)
    assert loaded["gw"] == 4
    assert loaded["models"][0]["slug"] == "some/model"
    assert loaded["models"][0]["picks"] == [
        {"player_id": 1, "threshold": 5, "pick": "yes", "confidence": 0.9}
    ]


def test_load_picks_raises_when_missing(tmp_path):
    with pytest.raises(FileNotFoundError):
        load_picks(999, picks_dir=tmp_path / "agent_picks")
