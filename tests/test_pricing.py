"""Built with fully synthetic, inline bootstrap/fixtures/event_live data
rather than the shared tests/fixtures/*.json files -- unlike settlement
and resolution's tests, these need several gameweeks, several players
per position, and a not-yet-finished gameweek all in the same run, more
control than the shared fixtures (built for a 1-2 gameweek setup) give
without editing them and risking those other tests.
"""

import pytest

from data_pipeline import cache
from data_pipeline.pricing import (
    NO_DATA_FALLBACK_PROBABILITY,
    PRIOR_STRENGTH,
    market_open_probability,
)

# Two forwards (Haaland-like) and two midfielders, one keeper -- enough
# to pool a real position rate distinct from any one player's own.
BOOTSTRAP = {
    "elements": [
        {"id": 1, "web_name": "Striker A", "element_type": 4, "team": 1},
        {"id": 2, "web_name": "Striker B", "element_type": 4, "team": 2},
        {"id": 3, "web_name": "Mid A", "element_type": 3, "team": 3},
        {"id": 4, "web_name": "Mid B", "element_type": 3, "team": 4},
        {"id": 5, "web_name": "Keeper A", "element_type": 1, "team": 5},
    ],
}


def _fixtures(finished_gws: set[int], all_gws: set[int]) -> list[dict]:
    """One fixture per gameweek, finished iff that gw is in `finished_gws`."""
    return [
        {"id": gw, "event": gw, "team_h": 1, "team_a": 2, "finished": gw in finished_gws}
        for gw in sorted(all_gws)
    ]


def _live(stats_by_player: dict[int, tuple[int, int]]) -> dict:
    """stats_by_player: player_id -> (total_points, minutes)."""
    return {
        "elements": [
            {"id": pid, "stats": {"total_points": pts, "minutes": mins}}
            for pid, (pts, mins) in stats_by_player.items()
        ]
    }


def test_no_cached_history_returns_the_fallback_probability(tmp_path):
    cache_dir = tmp_path / "cache"
    cache.save_bootstrap_static(BOOTSTRAP, cache_dir=cache_dir)
    cache.save_fixtures(_fixtures(finished_gws=set(), all_gws=set()), cache_dir=cache_dir)

    # gw=1 -- nothing before it exists to look at at all.
    p = market_open_probability(1, element_type=4, threshold=5, gw=1, bootstrap=BOOTSTRAP, cache_dir=cache_dir)
    assert p == NO_DATA_FALLBACK_PROBABILITY


def test_player_with_zero_games_played_gets_exactly_the_position_rate(tmp_path):
    cache_dir = tmp_path / "cache"
    cache.save_bootstrap_static(BOOTSTRAP, cache_dir=cache_dir)
    cache.save_fixtures(_fixtures(finished_gws={1}, all_gws={1}), cache_dir=cache_dir)
    # Player 1 (forward) never appears in GW1's live snapshot at all --
    # e.g. not yet in the squad. Player 2 (also a forward) played and
    # cleared 5+; that's the whole forward pool's real rate: 1/1.
    cache.save_event_live(1, _live({2: (8, 90)}), cache_dir=cache_dir)

    p = market_open_probability(1, element_type=4, threshold=5, gw=2, bootstrap=BOOTSTRAP, cache_dir=cache_dir)
    assert p == 1.0  # position_rate is 1/1, and (0 + k*1.0) / (0 + k) == 1.0


def test_strong_long_history_pulls_probability_toward_the_players_own_rate(tmp_path):
    cache_dir = tmp_path / "cache"
    cache.save_bootstrap_static(BOOTSTRAP, cache_dir=cache_dir)
    gws = list(range(1, 11))  # 10 games -- comfortably more than PRIOR_STRENGTH
    cache.save_fixtures(_fixtures(finished_gws=set(gws), all_gws=set(gws)), cache_dir=cache_dir)
    for gw in gws:
        # Player 1 clears 5+ every single game; player 2 (same position,
        # sets the position rate) never does -- a low prior that a long
        # enough personal history should mostly override.
        cache.save_event_live(gw, _live({1: (8, 90), 2: (2, 90)}), cache_dir=cache_dir)

    p = market_open_probability(1, element_type=4, threshold=5, gw=11, bootstrap=BOOTSTRAP, cache_dir=cache_dir)
    # Position pool includes player 1's own games too (10 clears / 20
    # played, since player 2 never clears): position_rate = 0.5.
    # p0 = (10 + 6*0.5) / (10 + 6) == 13/16 == 0.8125 -- well above the
    # 0.5 position rate, proof a long, strong personal record pulls the
    # price up even with the player's own results baked into that
    # position rate too, without literally hitting 1.0.
    assert p == 13 / 16
    assert p > 0.5


def test_thin_one_game_sample_is_shrunk_toward_the_prior_not_taken_at_face_value(tmp_path):
    cache_dir = tmp_path / "cache"
    cache.save_bootstrap_static(BOOTSTRAP, cache_dir=cache_dir)
    cache.save_fixtures(_fixtures(finished_gws={1}, all_gws={1}), cache_dir=cache_dir)
    # Player 1 clears the line in their only game so far (1/1 = 100%
    # naive rate); the rest of the forward pool (player 2) never does.
    cache.save_event_live(1, _live({1: (8, 90), 2: (2, 90)}), cache_dir=cache_dir)

    p = market_open_probability(1, element_type=4, threshold=5, gw=2, bootstrap=BOOTSTRAP, cache_dir=cache_dir)
    # (1 + 6*0.5) / (1 + 6) == 4/7 -- position rate here is 1/2 (player
    # 1's own game counts toward the pooled position rate too), pulling
    # a naive 100% a long way down, not left at face value.
    assert p == pytest.approx(4 / 7)
    assert p < 1.0


def test_unplayed_gameweek_is_excluded_from_the_sample_not_counted_as_a_miss(tmp_path):
    cache_dir = tmp_path / "cache"
    cache.save_bootstrap_static(BOOTSTRAP, cache_dir=cache_dir)
    cache.save_fixtures(_fixtures(finished_gws={1, 2}, all_gws={1, 2}), cache_dir=cache_dir)
    # GW1: player 1 didn't play (0 minutes -- unused sub / blank).
    # GW2: player 1 played and cleared.
    cache.save_event_live(1, _live({1: (0, 0), 2: (2, 90)}), cache_dir=cache_dir)
    cache.save_event_live(2, _live({1: (8, 90), 2: (2, 90)}), cache_dir=cache_dir)

    p = market_open_probability(1, element_type=4, threshold=5, gw=3, bootstrap=BOOTSTRAP, cache_dir=cache_dir)
    # Player 1's sample must be (cleared=1, played=1), not (1, 2) --
    # the unplayed GW1 contributes nothing to their own history.
    # Position pool: GW1 player2 no-clear, GW2 player1 clear + player2
    # no-clear = 1/3 pooled rate.
    expected = (1 + PRIOR_STRENGTH * (1 / 3)) / (1 + PRIOR_STRENGTH)
    assert p == pytest.approx(expected)


def test_not_yet_finished_gameweek_is_excluded_even_if_cached(tmp_path):
    cache_dir = tmp_path / "cache"
    cache.save_bootstrap_static(BOOTSTRAP, cache_dir=cache_dir)
    # GW1 finished, GW2 cached but still in progress (finished=False).
    cache.save_fixtures(_fixtures(finished_gws={1}, all_gws={1, 2}), cache_dir=cache_dir)
    cache.save_event_live(1, _live({1: (2, 90), 2: (2, 90)}), cache_dir=cache_dir)
    # If GW2 were wrongly included, player 1 would look like a 1/2
    # clearer instead of 0/1 -- this snapshot is provisional and must
    # not be trusted.
    cache.save_event_live(2, _live({1: (9, 90), 2: (2, 90)}), cache_dir=cache_dir)

    p = market_open_probability(1, element_type=4, threshold=5, gw=3, bootstrap=BOOTSTRAP, cache_dir=cache_dir)
    expected = (0 + PRIOR_STRENGTH * 0.0) / (0 + PRIOR_STRENGTH)  # only GW1 counted: nobody cleared
    assert p == pytest.approx(expected)
    assert p == 0.0


def test_position_pool_only_counts_players_of_the_same_element_type(tmp_path):
    cache_dir = tmp_path / "cache"
    cache.save_bootstrap_static(BOOTSTRAP, cache_dir=cache_dir)
    cache.save_fixtures(_fixtures(finished_gws={1}, all_gws={1}), cache_dir=cache_dir)
    # Player 3 is a midfielder (element_type 3) clearing a high bar
    # every game -- must NOT leak into a forward's (element_type 4)
    # position rate.
    cache.save_event_live(1, _live({2: (2, 90), 3: (12, 90)}), cache_dir=cache_dir)

    p = market_open_probability(1, element_type=4, threshold=5, gw=2, bootstrap=BOOTSTRAP, cache_dir=cache_dir)
    # Forward pool is just player 2 (0 clears / 1 played) -- player 3's
    # midfield heroics must not raise this at all.
    assert p == 0.0
