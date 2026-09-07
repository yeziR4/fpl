from data_pipeline.agents import AgentPick
from data_pipeline.oddsmaker import (
    DEFAULT_CONFIDENCE,
    MAX_STAKE_VARA,
    MIN_STAKE_VARA,
    bet_record,
    market_probability,
    player_standing,
    with_bet_record,
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


def test_bet_record_stake_scales_with_confidence():
    low_conf = bet_record(
        pick_yes=True, confidence=0.0, player_id=1, threshold=PRIMARY_POINTS_THRESHOLD, bootstrap=BOOTSTRAP
    )
    high_conf = bet_record(
        pick_yes=True, confidence=1.0, player_id=1, threshold=PRIMARY_POINTS_THRESHOLD, bootstrap=BOOTSTRAP
    )
    assert low_conf.stake_vara == MIN_STAKE_VARA
    assert high_conf.stake_vara == MAX_STAKE_VARA


def test_bet_record_missing_confidence_uses_the_default_not_an_extreme():
    default = bet_record(
        pick_yes=True, confidence=None, player_id=1, threshold=PRIMARY_POINTS_THRESHOLD, bootstrap=BOOTSTRAP
    )
    explicit = bet_record(
        pick_yes=True,
        confidence=DEFAULT_CONFIDENCE,
        player_id=1,
        threshold=PRIMARY_POINTS_THRESHOLD,
        bootstrap=BOOTSTRAP,
    )
    assert default.stake_vara == explicit.stake_vara


def test_bet_record_confidence_never_changes_the_odds():
    low = bet_record(
        pick_yes=True, confidence=0.0, player_id=1, threshold=PRIMARY_POINTS_THRESHOLD, bootstrap=BOOTSTRAP
    )
    high = bet_record(
        pick_yes=True, confidence=1.0, player_id=1, threshold=PRIMARY_POINTS_THRESHOLD, bootstrap=BOOTSTRAP
    )
    # Same player, same threshold, same side -- only the stake should differ.
    assert low.market_probability == high.market_probability


def test_bet_record_no_side_prices_the_complementary_probability():
    yes = bet_record(
        pick_yes=True, confidence=0.5, player_id=1, threshold=PRIMARY_POINTS_THRESHOLD, bootstrap=BOOTSTRAP
    )
    no = bet_record(
        pick_yes=False, confidence=0.5, player_id=1, threshold=PRIMARY_POINTS_THRESHOLD, bootstrap=BOOTSTRAP
    )
    assert round(yes.market_probability + no.market_probability, 4) == 1.0


def test_bet_record_potential_return_matches_fair_decimal_odds():
    record = bet_record(
        pick_yes=True, confidence=1.0, player_id=1, threshold=PRIMARY_POINTS_THRESHOLD, bootstrap=BOOTSTRAP
    )
    expected_return = round(record.stake_vara * (1 / record.market_probability), 2)
    assert record.potential_return_vara == expected_return
    # A winning bet always gets back at least its own stake.
    assert record.potential_return_vara >= record.stake_vara


def test_with_bet_record_enriches_an_agent_pick_without_touching_its_other_fields():
    pick = AgentPick(player_id=1, threshold=PRIMARY_POINTS_THRESHOLD, pick=True, confidence=0.7)
    enriched = with_bet_record(pick, BOOTSTRAP)

    assert enriched.player_id == pick.player_id
    assert enriched.threshold == pick.threshold
    assert enriched.pick == pick.pick
    assert enriched.confidence == pick.confidence
    assert enriched.market_probability is not None
    assert enriched.stake_vara is not None
    assert enriched.potential_return_vara is not None
