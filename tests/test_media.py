import json
from pathlib import Path

import pytest

from data_pipeline.media import player_photo_url, team_badge_url, team_code_for_id

FIXTURES = Path(__file__).parent / "fixtures"


def load_bootstrap():
    return json.loads((FIXTURES / "bootstrap_static_sample.json").read_text())


def test_player_photo_url_built_from_stable_code():
    # Keyed on elements[].code -- what FPL's own frontend actually
    # reads -- not parsed out of the raw `photo` filename field.
    url = player_photo_url(223094)
    assert url == "https://resources.premierleague.com/premierleague/photos/players/110x140/p223094.png"


def test_player_photo_url_accepts_a_different_size():
    url = player_photo_url(223094, size="40x40")
    assert "/photos/players/40x40/p223094.png" in url


def test_team_badge_url_uses_the_given_code():
    url = team_badge_url(43)
    assert url == "https://resources.premierleague.com/premierleague/badges/50/t43.png"


def test_team_code_for_id_looks_up_the_stable_code():
    # Haaland's team id (11) maps to code 43 in the fixture -- id and
    # code are deliberately different values so a passthrough bug would
    # be caught here.
    assert team_code_for_id(load_bootstrap(), team_id=11) == 43


def test_team_code_for_id_raises_for_unknown_team():
    with pytest.raises(ValueError):
        team_code_for_id(load_bootstrap(), team_id=404)
