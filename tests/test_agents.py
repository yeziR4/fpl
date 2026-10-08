"""Tests for the retargeted agent pipeline.

Ported from the VARA version. The parser and prompt tests kept their intent --
tolerate a sloppy reply, never invent a pick -- and gained coverage for the two
things the new prompt asks for that the old one did not: a stated probability
(with the side derived from it) and a rationale.

What is deliberately NOT tested here any more: simulated stake sizing and
decimal-odds payout maths. That machinery is gone; a forecast now becomes a
real order on Panta, and its economics are the pool's rather than ours.
"""

import json
from pathlib import Path

import pytest

from data_pipeline import cache
from data_pipeline.agents import (
    AGENT_BANKROLL_USDC,
    AgentModel,
    AgentPick,
    LiveMarket,
    ModelPicksResult,
    OpenRouterError,
    PicksParseError,
    apply_bankroll_cap,
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


def market(market_id="m1", player_id=1, yes=0.55, no=0.47) -> LiveMarket:
    return LiveMarket(
        market_id=market_id,
        question="Will the player score 7 or more points?",
        yes_price=yes,
        no_price=no,
        player_id=player_id,
        threshold=7,
    )


# ---- AgentModel / pricing-free surface ---------------------------------


def test_agent_model_no_longer_carries_a_vara_address():
    m = AgentModel("a/b", "B")
    assert m.solana_address == ""
    assert not hasattr(m, "address")


def test_bankroll_is_usdc():
    assert AGENT_BANKROLL_USDC == 5.0


# ---- build_prompt ------------------------------------------------------


def test_build_prompt_shows_every_market_with_its_real_pool_price():
    markets = [market("m1", 1, yes=0.55, no=0.47), market("m2", 2, yes=0.30, no=0.72)]
    players = top_expensive_players(load_bootstrap(), n=3)
    prompt = build_prompt(markets, players, load_bootstrap(), load_fixtures(), gw=1)

    assert "m1" in prompt and "m2" in prompt
    assert "YES 0.550, NO 0.470" in prompt
    assert "YES 0.300, NO 0.720" in prompt
    # The question text, not just the id.
    assert "score 7 or more points" in prompt


def test_build_prompt_says_the_price_is_not_the_models_to_set():
    """The rule the old build enforced; on Panta it is a fact about the pool."""
    players = top_expensive_players(load_bootstrap(), n=1)
    prompt = build_prompt([market()], players, load_bootstrap(), load_fixtures(), gw=1)
    assert "THE PRICE IS NOT YOURS TO SET" in prompt


def test_build_prompt_asks_for_a_probability_and_a_reason():
    players = top_expensive_players(load_bootstrap(), n=1)
    prompt = build_prompt([market()], players, load_bootstrap(), load_fixtures(), gw=1)
    assert '"probability"' in prompt
    assert '"reasoning"' in prompt
    assert '"stake_usdc"' in prompt


def test_build_prompt_states_the_bankroll_and_allows_forecasting_nothing():
    players = top_expensive_players(load_bootstrap(), n=1)
    prompt = build_prompt([market()], players, load_bootstrap(), load_fixtures(), gw=1)
    assert f"${AGENT_BANKROLL_USDC:.2f}" in prompt
    assert '{"picks": []}' in prompt
    assert "There is no penalty for" in prompt


def test_build_prompt_includes_player_context_for_a_market_that_has_one():
    players = top_expensive_players(load_bootstrap(), n=3)
    prompt = build_prompt([market("m1", 1)], players, load_bootstrap(), load_fixtures(), gw=1)
    # Haaland (id 1) is the sample's most expensive player.
    assert "Haaland" in prompt
    assert "pts so far this season" in prompt


def test_build_prompt_flags_blank_gameweek():
    # Palmer's team (6) has no fixture in the sample data for GW1.
    players = [p for p in top_expensive_players(load_bootstrap(), n=3) if p.web_name == "Palmer"]
    prompt = build_prompt([market("m1", 3)], players, load_bootstrap(), load_fixtures(), gw=1)
    assert "no fixture (blank gameweek)" in prompt


def test_build_prompt_handles_a_market_with_no_player_attached():
    players = top_expensive_players(load_bootstrap(), n=1)
    orphan = LiveMarket("m1", "Some other market", 0.5, 0.5, player_id=None)
    prompt = build_prompt([orphan], players, load_bootstrap(), load_fixtures(), gw=1)
    assert "Some other market" in prompt


# ---- side and edge derivation ------------------------------------------


def test_side_is_derived_so_a_forecast_cannot_contradict_itself():
    assert AgentPick("m1", 0.70, 1.0, yes_price=0.50, no_price=0.50).side == "yes"
    assert AgentPick("m1", 0.25, 1.0, yes_price=0.50, no_price=0.50).side == "no"


def test_side_flips_when_the_obvious_side_is_too_expensive():
    # Believes YES at 0.55 but YES costs 0.80 -- the value is on NO.
    p = AgentPick("m1", 0.55, 1.0, yes_price=0.80, no_price=0.20)
    assert p.side == "no"
    assert p.edge == pytest.approx(0.25)


def test_no_trade_when_neither_side_beats_its_price():
    p = AgentPick("m1", 0.50, 1.0, yes_price=0.52, no_price=0.50)
    assert p.side is None
    assert p.edge is None
    assert p.side_price is None


def test_edge_is_unknown_before_prices_are_attached():
    p = AgentPick("m1", 0.70, 1.0)
    assert p.side is None
    assert p.edge is None


def test_implied_yes_normalises_past_a_spread():
    # 0.52 + 0.50 = 1.02, so the pool's own YES is 0.52/1.02, not 0.52.
    m = LiveMarket("m1", "q", 0.52, 0.50)
    assert m.implied_yes == pytest.approx(0.52 / 1.02)


# ---- parse_picks --------------------------------------------------------


def test_parse_picks_happy_path():
    raw = json.dumps(
        {
            "picks": [
                {
                    "market_id": "m1",
                    "probability": 0.62,
                    "stake_usdc": 2.5,
                    "reasoning": "Home fixture, weak opponent.",
                },
                {"market_id": "m2", "probability": 0.3, "stake_usdc": 1.0},
            ]
        }
    )
    picks = parse_picks(raw, valid_market_ids={"m1", "m2"})
    assert len(picks) == 2
    assert picks[0].market_id == "m1"
    assert picks[0].probability == 0.62
    assert picks[0].stake_usdc == 2.5
    assert picks[0].reasoning == "Home fixture, weak opponent."
    # reasoning is optional
    assert picks[1].reasoning == ""


def test_parse_picks_strips_markdown_code_fences():
    raw = "```json\n" + json.dumps({"picks": [{"market_id": "m1", "probability": 0.5, "stake_usdc": 1}]}) + "\n```"
    assert len(parse_picks(raw, valid_market_ids={"m1"})) == 1


def test_parse_picks_recovers_json_wrapped_in_commentary():
    # Confirmed for real: ~google/gemini-pro-latest's first live reply prefaced
    # its JSON with prose despite the prompt asking for JSON only, and the
    # leading-fence check alone does not catch that.
    raw = (
        "Sure, here are my forecasts for this gameweek:\n\n"
        + json.dumps({"picks": [{"market_id": "m1", "probability": 0.5, "stake_usdc": 1}]})
        + "\n\nLet me know if you want more detail."
    )
    assert len(parse_picks(raw, valid_market_ids={"m1"})) == 1


def test_parse_picks_drops_entries_for_unknown_markets():
    raw = json.dumps({"picks": [{"market_id": "nope", "probability": 0.9, "stake_usdc": 3}]})
    assert parse_picks(raw, valid_market_ids={"m1"}) == []


@pytest.mark.parametrize("probability", [-0.1, 1.4, "0.5", None, True])
def test_parse_picks_rejects_a_probability_that_is_not_a_real_one(probability):
    raw = json.dumps(
        {"picks": [{"market_id": "m1", "probability": probability, "stake_usdc": 1}]}
    )
    assert parse_picks(raw, valid_market_ids={"m1"}) == []


@pytest.mark.parametrize("stake", [0, -1, None, "2", True])
def test_parse_picks_treats_a_non_positive_stake_as_a_pass_not_an_error(stake):
    raw = json.dumps({"picks": [{"market_id": "m1", "probability": 0.6, "stake_usdc": stake}]})
    assert parse_picks(raw, valid_market_ids={"m1"}) == []


def test_parse_picks_truncates_an_overlong_reason():
    raw = json.dumps(
        {"picks": [{"market_id": "m1", "probability": 0.6, "stake_usdc": 1, "reasoning": "x" * 900}]}
    )
    (pick,) = parse_picks(raw, valid_market_ids={"m1"})
    assert len(pick.reasoning) == 280


def test_parse_picks_raises_when_no_json_object_is_found():
    with pytest.raises(PicksParseError):
        parse_picks("I would rather not answer.", valid_market_ids={"m1"})


def test_parse_picks_raises_when_the_picks_key_is_missing_or_wrong_shape():
    with pytest.raises(PicksParseError):
        parse_picks('{"thoughts": "no"}', valid_market_ids={"m1"})
    with pytest.raises(PicksParseError):
        parse_picks('{"picks": "m1"}', valid_market_ids={"m1"})


def test_parse_picks_empty_or_all_invalid_entries_is_not_an_error():
    assert parse_picks('{"picks": []}', valid_market_ids={"m1"}) == []
    assert parse_picks('{"picks": [{"garbage": 1}]}', valid_market_ids={"m1"}) == []


# ---- apply_bankroll_cap -------------------------------------------------


def test_bankroll_cap_leaves_a_within_budget_model_alone():
    picks = [AgentPick("m1", 0.6, 1.0), AgentPick("m2", 0.4, 1.5)]
    assert apply_bankroll_cap(picks, 5.0) == picks


def test_bankroll_cap_trims_proportionally_so_no_model_outstakes_the_others():
    picks = [AgentPick("m1", 0.6, 4.0), AgentPick("m2", 0.4, 4.0)]
    capped = apply_bankroll_cap(picks, 5.0)
    assert [p.stake_usdc for p in capped] == [2.5, 2.5]
    assert sum(p.stake_usdc for p in capped) == pytest.approx(5.0)
    # the forecast itself is untouched -- only the size is trimmed
    assert [p.probability for p in capped] == [0.6, 0.4]


def test_bankroll_cap_on_nothing_is_nothing():
    assert apply_bankroll_cap([], 5.0) == []


# ---- call_model ---------------------------------------------------------


def test_call_model_raises_rather_than_returning_a_fabricated_reply(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")

    class Boom:
        def post(self, *a, **k):
            raise RuntimeError("network down")

    import requests

    def raise_request(*a, **k):
        raise requests.RequestException("network down")

    monkeypatch.setattr(requests, "post", raise_request)
    with pytest.raises(OpenRouterError):
        call_model(AgentModel("a/b", "B"), "prompt")


def test_call_model_without_a_key_says_so(monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    with pytest.raises(OpenRouterError, match="OPENROUTER_API_KEY"):
        call_model(AgentModel("a/b", "B"), "prompt")


# ---- generate_picks_for_gameweek (network stubbed) ----------------------


def _patch_call_model(monkeypatch, replies):
    """replies: slug -> raw string, or an Exception to raise."""
    calls = []

    def fake(model, prompt, *, session=None):
        calls.append(model.slug)
        reply = replies[model.slug]
        if isinstance(reply, Exception):
            raise reply
        return reply

    monkeypatch.setattr("data_pipeline.agents.call_model", fake)
    return calls


def test_generate_picks_attaches_the_decision_time_price(populated_cache, monkeypatch):
    good = json.dumps({"picks": [{"market_id": "m1", "probability": 0.7, "stake_usdc": 2}]})
    _patch_call_model(monkeypatch, {"a/b": good})
    markets = [market("m1", 1, yes=0.55, no=0.47)]

    results = generate_picks_for_gameweek(
        1, markets=markets, cache_dir=populated_cache, models=(AgentModel("a/b", "B"),)
    )

    (result,) = results
    assert result.error is None
    assert result.raw_reply == good
    assert result.decided_at
    (pick,) = result.picks
    assert pick.yes_price == 0.55 and pick.no_price == 0.47
    assert pick.side == "yes"
    assert pick.edge == pytest.approx(0.7 - 0.55)


def test_generate_picks_one_model_failing_doesnt_block_others(populated_cache, monkeypatch):
    good = json.dumps({"picks": [{"market_id": "m1", "probability": 0.7, "stake_usdc": 2}]})
    _patch_call_model(monkeypatch, {"bad/one": OpenRouterError("down"), "good/one": good})

    results = generate_picks_for_gameweek(
        1,
        markets=[market("m1", 1)],
        cache_dir=populated_cache,
        models=(AgentModel("bad/one", "Bad"), AgentModel("good/one", "Good")),
    )

    by_slug = {r.model.slug: r for r in results}
    assert by_slug["bad/one"].error == "down"
    assert by_slug["bad/one"].picks == []
    assert by_slug["good/one"].error is None
    assert len(by_slug["good/one"].picks) == 1


def test_generate_picks_malformed_reply_yields_no_picks_and_keeps_the_raw_reply(
    populated_cache, monkeypatch
):
    _patch_call_model(monkeypatch, {"a/b": "I refuse to answer in JSON."})

    (result,) = generate_picks_for_gameweek(
        1, markets=[market("m1", 1)], cache_dir=populated_cache, models=(AgentModel("a/b", "B"),)
    )

    assert result.picks == []
    assert result.error is not None
    # The Vara version stored only the error string, which made a bad reply
    # impossible to diagnose after the fact.
    assert result.raw_reply == "I refuse to answer in JSON."


def test_generate_picks_deliberate_empty_picks_is_not_an_error(populated_cache, monkeypatch):
    _patch_call_model(monkeypatch, {"a/b": '{"picks": []}'})

    (result,) = generate_picks_for_gameweek(
        1, markets=[market("m1", 1)], cache_dir=populated_cache, models=(AgentModel("a/b", "B"),)
    )

    assert result.picks == []
    assert result.error is None


# ---- save / load --------------------------------------------------------


def test_save_and_load_picks_round_trip(tmp_path):
    markets = [market("m1", 1)]
    result = ModelPicksResult(
        model=AgentModel("a/b", "B", "So1anaAddre55"),
        picks=[AgentPick("m1", 0.62, 2.5, "because", yes_price=0.55, no_price=0.47)],
        raw_reply="{}",
        decided_at="2026-10-07T00:00:00+00:00",
    )
    path = save_picks(3, [result], picks_dir=tmp_path)
    assert path.name == "gw3.json"

    saved = load_picks(3, picks_dir=tmp_path)
    assert saved["bankroll_usdc"] == AGENT_BANKROLL_USDC
    (m,) = saved["models"]
    assert m["solana_address"] == "So1anaAddre55"
    assert m["decided_at"] == "2026-10-07T00:00:00+00:00"
    (pick,) = m["picks"]
    assert pick["market_id"] == "m1"
    assert pick["side"] == "yes"
    assert pick["edge"] == pytest.approx(0.07)
    # The price is stored, not looked up later: the pool moves.
    assert pick["yes_price_at_decision"] == 0.55
    assert "stake_vara" not in pick


def test_save_picks_records_a_failed_model_without_inventing_picks(tmp_path):
    result = ModelPicksResult(
        model=AgentModel("a/b", "B"),
        error="boom",
        raw_reply="not json",
        decided_at="2026-10-07T00:00:00+00:00",
    )
    save_picks(3, [result], picks_dir=tmp_path)
    (m,) = load_picks(3, picks_dir=tmp_path)["models"]
    assert m["error"] == "boom"
    assert m["raw_reply"] == "not json"
    assert m["picks"] == []


def test_load_picks_for_a_gameweek_that_was_never_run(tmp_path):
    with pytest.raises(FileNotFoundError):
        load_picks(99, picks_dir=tmp_path)
