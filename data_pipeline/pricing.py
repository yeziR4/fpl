"""Stage 1 of the market-maker pricing engine: where a market's OPENING
probability comes from, before any liquidity or trading enters into it
at all. This is the half of the design that answers "why is Haaland's
over-10 priced differently from his over-5, and differently from some
bench player's over-5" -- real historical data, not a guess and not
the AI models' own opinion. Stage 2 (LMSR liquidity depth, `b`, sized
from whatever real VARA is actually committed) is a separate module
built once real capital backs it -- this one only ever answers "what
does history say the fair price is", nothing about how much money
sits behind that price or how fast it can move.

Deliberately independent of what the 5 AI models pick (see agents.py):
if a market's fair-value prior came from the models' own consensus,
watching them trade against it would just be watching them trade
against themselves. This module uses nothing but real, already-cached
per-gameweek results -- cache.load_event_live, the exact same
settlement-grade snapshots resolution.py already trusts to decide real
payouts -- and nothing else.

THE FORMULA, PLAINLY
---------------------
A player's own history is the first signal: across every FINISHED
gameweek this season they actually played (minutes > 0 -- a blank
gameweek or an unused sub isn't a data point about their scoring,
it's just an absence, and is excluded from the sample rather than
counted as a "no"), what fraction cleared the threshold?

That alone is unreliable early -- 1 game at 1/1 clearing a line isn't
"100% likely", it's "we don't know yet". So it's shrunk toward a
position-wide base rate (the same clear-rate, pooled across every
player who shares that position, over the same window) using a
standard Bayesian blend:

    p0 = (player_cleared + k * position_rate) / (player_played + k)

`k` (PRIOR_STRENGTH below) is "how many games' worth of trust the
prior gets" -- with k=6, a player with 0 games played gets exactly the
position rate; a player with 30 games played is barely moved by it at
all. This is a real, tunable modeling choice, not a derived constant --
worth revisiting once there's enough of a season's data to check it
against how markets actually settled, not before.

Only FINISHED gameweeks ever enter the sample (see resolution.py's own
reasoning for why: `total_points` keeps moving for up to about an hour
after full time while FPL recalculates bonus points), and only
gameweeks that have actually been fetched into the cache -- a thin or
even empty history is a valid, honestly-thin input to the shrinkage
formula, not an error. See cli.py's `price-market` for a way to
inspect this by hand, and .github/workflows/agent-picks.yml for where
enough history actually gets fetched for this to have real data to
work with.
"""

from __future__ import annotations

from . import cache
from .resolution import is_gameweek_finished

PRIOR_STRENGTH = 6

# Only reachable before ANY gameweek this season has ever been fetched
# into the cache at all (so there's no player history AND no position
# pool to fall back to either) -- maximum uncertainty stated honestly,
# not a guessed "realistic-looking" number.
NO_DATA_FALLBACK_PROBABILITY = 0.5


def _finished_gws_before(gw: int, *, cache_dir=None) -> list[int]:
    """Every gameweek strictly before `gw` that's both cached and
    fully finished -- the real, settlement-grade history window this
    module ever looks at. Silently skips anything not cached (never
    fetched) rather than erroring."""
    kwargs = {"cache_dir": cache_dir} if cache_dir is not None else {}
    return [g for g in range(1, gw) if cache.has_event_live(g, **kwargs) and is_gameweek_finished(g, **kwargs)]


def _player_history(player_id: int, threshold: int, gws: list[int], *, cache_dir=None) -> tuple[int, int]:
    """(cleared, played) for one player across the given gameweeks."""
    kwargs = {"cache_dir": cache_dir} if cache_dir is not None else {}
    cleared = played = 0
    for gw in gws:
        live = cache.load_event_live(gw, **kwargs)
        for element in live["elements"]:
            if element["id"] != player_id:
                continue
            stats = element["stats"]
            if stats["minutes"] > 0:
                played += 1
                if stats["total_points"] >= threshold:
                    cleared += 1
            break  # found this gameweek's entry for the player -- done with it either way
    return cleared, played


def _position_rate(
    element_type: int, threshold: int, gws: list[int], bootstrap: dict, *, cache_dir=None
) -> float | None:
    """Pooled clear-rate across every player of this position over the
    given gameweeks. None if there's no data at all to pool -- callers
    fall back to NO_DATA_FALLBACK_PROBABILITY in that case."""
    kwargs = {"cache_dir": cache_dir} if cache_dir is not None else {}
    position_players = {e["id"] for e in bootstrap["elements"] if e["element_type"] == element_type}
    cleared = played = 0
    for gw in gws:
        live = cache.load_event_live(gw, **kwargs)
        for element in live["elements"]:
            if element["id"] not in position_players:
                continue
            stats = element["stats"]
            if stats["minutes"] == 0:
                continue
            played += 1
            if stats["total_points"] >= threshold:
                cleared += 1
    if played == 0:
        return None
    return cleared / played


def market_open_probability(
    player_id: int,
    element_type: int,
    threshold: int,
    gw: int,
    bootstrap: dict,
    *,
    cache_dir=None,
    prior_strength: int = PRIOR_STRENGTH,
) -> float:
    """The Bayesian-shrunk probability a market for this
    (player, threshold, gw) should open at -- see the module
    docstring for the full formula and reasoning. Always returns a
    value in [0, 1]; never PENDING/None the way resolution.py's
    outcomes can be, since this isn't answering a payout-safe
    yes/no/pending question -- it's an opinion a price can start at,
    honest about how little it might have to go on yet.
    """
    gws = _finished_gws_before(gw, cache_dir=cache_dir)
    if not gws:
        return NO_DATA_FALLBACK_PROBABILITY

    cleared, played = _player_history(player_id, threshold, gws, cache_dir=cache_dir)
    position_rate = _position_rate(element_type, threshold, gws, bootstrap, cache_dir=cache_dir)
    if position_rate is None:
        position_rate = NO_DATA_FALLBACK_PROBABILITY

    return (cleared + prior_strength * position_rate) / (played + prior_strength)
