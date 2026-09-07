from data_pipeline.agents import AgentPick
from data_pipeline.oddsmaker import (
    DEFAULT_CONFIDENCE,
    MAX_STAKE_WEIGHT,
    MIN_STAKE_WEIGHT,
    TOTAL_BANKROLL_USD,
    bet_records,
    market_probability,
    player_standing,
    with_bet_records,
)
from data_pipeline.settlement import PRIMARY_POINTS_THRESHOLD, SECONDARY_POINTS_THRESHOLD

# Four forwards spanning the full standing range, plus one midfielder
# to prove position pools don't leak into each other.
BOOTSTRAP = {
    "elements": [
        {"id": 1, "element_type": 4, "total_points": 100},  # best forward
        {"id": 2, "element_type": 4, "total_points": 60},
        {"id": 3, "element_type": 4, "total_points": 30},
        {"id": 4, "element_type": 4, "total_points": 5},  # worst forward
        {"id": 5, "element_type": 3, "total_points": 200},  # best overall, but a midfielder
    ]
}

# A round, easy-to-check rate -- $1 == 1 VARA, so bankroll_vara ==
# TOTAL_BANKROLL_USD exactly and every assertion below can compare
# against plain USD figures without a conversion step.
VARA_USD_PRICE = 1.0


def test_player_standing_best_forward_is_top_of_both_rankings():
    standing = player_standing(1, BOOTSTRAP)
    assert standing.position_percentile == 1.0
    # Overall: ranked behind player 5 (200 pts) -- rank 2 of 5.
    assert standing.overall_percentile == 1 - (2 - 1) / (5 - 1)


def test_player_standing_worst_forward_is_bottom_of_position_ranking():
    standing = player_standing(4, BOOTSTRAP)
    assert standing.position_percentile == 0.0


def test_player_standing_position_pool_excludes_other_positions():
    # Player 5 is the only midfielder -- a group of one is "average".
    standing = player_standing(5, BOOTSTRAP)
    assert standing.position_percentile == 0.5


def test_player_standing_unknown_player_raises():
    import pytest

    with pytest.raises(ValueError):
        player_standing(999, BOOTSTRAP)


def test_market_probability_best_standing_hits_the_high_anchor():
    p = market_probability(1, PRIMARY_POINTS_THRESHOLD, BOOTSTRAP)
    # Not percentile 1.0 overall (player 5 outranks it), so p sits
    # just under the high anchor, never above it.
    low, high = 0.10, 0.80
    assert low < p <= high


def test_market_probability_worst_standing_hits_the_low_anchor():
    p = market_probability(4, PRIMARY_POINTS_THRESHOLD, BOOTSTRAP)
    low, high = 0.10, 0.80
    assert low <= p < high
    assert p < 0.3  # clearly near the low end, not the middle


def test_market_probability_harder_threshold_is_priced_lower_for_the_same_player():
    p5 = market_probability(1, PRIMARY_POINTS_THRESHOLD, BOOTSTRAP)
    p10 = market_probability(1, SECONDARY_POINTS_THRESHOLD, BOOTSTRAP)
    assert p10 < p5


def _pick(*, pick_yes: bool = True, confidence: float | None = 0.5) -> AgentPick:
    return AgentPick(player_id=1, threshold=PRIMARY_POINTS_THRESHOLD, pick=pick_yes, confidence=confidence)


def test_bet_records_empty_picks_returns_empty_list():
    assert bet_records([], BOOTSTRAP, VARA_USD_PRICE) == []


def test_bet_records_single_pick_gets_the_entire_bankroll():
    records = bet_records([_pick()], BOOTSTRAP, VARA_USD_PRICE)
    assert len(records) == 1
    assert records[0].stake_vara == TOTAL_BANKROLL_USD


def test_bet_records_stakes_always_sum_to_the_total_bankroll():
    picks = [_pick(confidence=0.0), _pick(confidence=0.4), _pick(confidence=1.0)]
    records = bet_records(picks, BOOTSTRAP, VARA_USD_PRICE)
    # Each stake is individually rounded to 2dp, so the sum can be off
    # by a cent or two per record -- never invented, same discipline
    # MarketLedger's own integer-division payout math follows.
    import pytest

    assert sum(r.stake_vara for r in records) == pytest.approx(TOTAL_BANKROLL_USD, abs=0.01 * len(records))


def test_bet_records_higher_confidence_gets_a_bigger_slice_of_the_same_bankroll():
    picks = [_pick(confidence=0.0), _pick(confidence=1.0)]
    low, high = bet_records(picks, BOOTSTRAP, VARA_USD_PRICE)
    assert low.stake_vara < high.stake_vara
    # Ratio should track MAX_STAKE_WEIGHT/MIN_STAKE_WEIGHT, within the
    # slack per-record 2dp rounding can introduce.
    import pytest

    assert high.stake_vara / low.stake_vara == pytest.approx(MAX_STAKE_WEIGHT / MIN_STAKE_WEIGHT, abs=0.05)


def test_bet_records_missing_confidence_uses_the_default_not_an_extreme():
    default = bet_records([_pick(confidence=None)], BOOTSTRAP, VARA_USD_PRICE)
    explicit = bet_records([_pick(confidence=DEFAULT_CONFIDENCE)], BOOTSTRAP, VARA_USD_PRICE)
    assert default[0].stake_vara == explicit[0].stake_vara


def test_bet_records_confidence_never_changes_the_odds():
    low, high = bet_records([_pick(confidence=0.0), _pick(confidence=1.0)], BOOTSTRAP, VARA_USD_PRICE)
    # Same player, same threshold, same side -- only the stake should differ.
    assert low.market_probability == high.market_probability


def test_bet_records_no_side_prices_the_complementary_probability():
    yes, no = bet_records([_pick(pick_yes=True), _pick(pick_yes=False)], BOOTSTRAP, VARA_USD_PRICE)
    assert round(yes.market_probability + no.market_probability, 4) == 1.0


def test_bet_records_potential_return_matches_fair_decimal_odds():
    (record,) = bet_records([_pick(confidence=1.0)], BOOTSTRAP, VARA_USD_PRICE)
    expected_return = round(record.stake_vara * (1 / record.market_probability), 2)
    assert record.potential_return_vara == expected_return
    # A winning bet always gets back at least its own stake.
    assert record.potential_return_vara >= record.stake_vara


def test_bet_records_scale_inversely_with_the_vara_usd_price():
    # Same $10 bankroll, a VARA worth half as much -> twice the VARA stake.
    cheap = bet_records([_pick()], BOOTSTRAP, VARA_USD_PRICE)
    expensive = bet_records([_pick()], BOOTSTRAP, VARA_USD_PRICE * 2)
    assert round(cheap[0].stake_vara / expensive[0].stake_vara, 4) == 2.0


def test_with_bet_records_enriches_every_agent_pick_without_touching_its_other_fields():
    picks = [_pick(confidence=0.7), _pick(pick_yes=False, confidence=0.3)]
    enriched = with_bet_records(picks, BOOTSTRAP, VARA_USD_PRICE)

    assert len(enriched) == len(picks)
    for original, result in zip(picks, enriched):
        assert result.player_id == original.player_id
        assert result.threshold == original.threshold
        assert result.pick == original.pick
        assert result.confidence == original.confidence
        assert result.market_probability is not None
        assert result.stake_vara is not None
        assert result.potential_return_vara is not None
