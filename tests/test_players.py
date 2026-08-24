import json
from pathlib import Path

from data_pipeline.players import top_expensive_players

FIXTURES = Path(__file__).parent / "fixtures"


def load_bootstrap():
    return json.loads((FIXTURES / "bootstrap_static_sample.json").read_text())


def test_top_expensive_players_orders_by_cost_descending():
    players = top_expensive_players(load_bootstrap(), n=3)
    assert [p.web_name for p in players] == ["Haaland", "Salah", "Palmer"]


def test_top_expensive_players_ties_broken_by_total_points():
    # Isak and Watkins are both now_cost=90; Isak has more total_points.
    players = top_expensive_players(load_bootstrap(), n=6)
    names = [p.web_name for p in players]
    assert names.index("Isak") < names.index("Watkins")


def test_top_expensive_players_respects_n():
    players = top_expensive_players(load_bootstrap(), n=2)
    assert len(players) == 2


def test_price_millions_conversion():
    players = top_expensive_players(load_bootstrap(), n=1)
    assert players[0].price_millions == 15.0


def test_photo_url_derived_from_raw_photo_field():
    players = top_expensive_players(load_bootstrap(), n=1)
    assert players[0].photo == "223094.jpg"
    assert players[0].photo_url == (
        "https://resources.premierleague.com/premierleague/photos/players/110x140/p223094.png"
    )
