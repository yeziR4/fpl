"""AI agent picks via OpenRouter.

Five top-tier models, one per lab, are each given the same snapshot of
FPL data (the top-N most expensive players, their opponent this
gameweek, price, season form) and asked to predict the same points-
threshold markets `resolution.py` already knows how to settle. This
module is the "ask the models" half; `leaderboard.py` is the "were
they right" half, once a gameweek finishes.

Deliberately narrow in scope: this produces *picks*, not stakes, not
matchmaking, not selection/assignment between agents and markets --
every model is asked about every player pool, every time. See
docs/architecture.md.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import requests

from . import cache, oddsmaker, vara_price
from .players import Player, top_expensive_players
from .settlement import PRIMARY_POINTS_THRESHOLD, SECONDARY_POINTS_THRESHOLD

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_TIMEOUT = 60

PICKS_DIR = Path("data/agent_picks")


@dataclass(frozen=True)
class AgentModel:
    slug: str
    name: str
    # Each model's own real Vara mainnet wallet -- generated once
    # (GearKeyring.create(), the same sr25519 keypair machinery
    # web/src/lib/vara/keyring.ts uses for a human's wallet), so a
    # future "the model stakes VARA on its own pick" feature has
    # somewhere real to stake from. An address is public information,
    # safe to commit -- unlike the mnemonic behind it, which is not
    # stored anywhere in this repo. See docs/architecture.md.
    #
    # Defaults to "" purely so tests can build a throwaway AgentModel
    # without needing a real address -- every entry in AGENT_MODELS
    # below sets a real one.
    address: str = ""


# One model per lab, chosen for genuine cross-lab diversity rather than
# several models from the same family. Self-updating "latest" aliases
# preferred where OpenRouter offers them (openai/anthropic/google) --
# these silently re-point to each lab's new flagship, so the list
# doesn't go stale the way a dated slug eventually would. Confirmed
# real, current slugs via WebSearch/WebFetch against OpenRouter's own
# catalog (this sandbox can't reach openrouter.ai directly to check
# itself) -- verify with a real GitHub Actions call before relying on
# these further; a renamed/retired slug fails that one model's pick
# for a gameweek, not the whole pipeline (see call_model/generate_picks_for_gameweek).
AGENT_MODELS: tuple[AgentModel, ...] = (
    AgentModel("~openai/gpt-latest", "GPT (latest)", "kGh61bXfYSsT223sqzn4sWpq5Mz2VJWBJxsAK6R3E8YnXoAN2"),
    AgentModel(
        "~anthropic/claude-opus-latest", "Claude Opus (latest)", "kGkqpNus1hJGtgsZzh4SUV5upvrfk2hsKp5TvtfNqYemGoBEX"
    ),
    AgentModel("~google/gemini-pro-latest", "Gemini Pro (latest)", "kGgBKtcr97kHFDybuA3qxhsDcBQYVXxVtLNkpf8WhYM1DWQ5h"),
    AgentModel("x-ai/grok-4.20", "Grok 4.20", "kGg3f6tTWQaGCsg2YDeWUAJCnVTDXuPwu4oJzSmzH4BeEk2a3"),
    AgentModel("deepseek/deepseek-v4-pro", "DeepSeek V4 Pro", "kGihgHBfyczWhbM3tpXrmDKKZLRYsgicx7eaeVBFDdiuNurQs"),
)


class OpenRouterError(RuntimeError):
    """Raised when OpenRouter can't be reached or returns something unusable."""


def _api_key() -> str:
    key = os.environ.get("OPENROUTER_API_KEY")
    if not key:
        raise OpenRouterError(
            "OPENROUTER_API_KEY is not set -- it's a GitHub Actions secret the "
            "repo owner adds directly (Settings -> Secrets and variables -> "
            "Actions), never pasted into chat or committed. See docs/architecture.md."
        )
    return key


def call_model(
    model: AgentModel, prompt: str, *, session: requests.Session | None = None
) -> str:
    """One call to OpenRouter's OpenAI-compatible chat-completions endpoint.

    Returns the raw text content of the model's reply. Raises
    OpenRouterError on any failure -- never returns a fabricated
    fallback, since a swallowed failure here would silently produce a
    fake pick further down the pipeline. Callers should catch this per
    model, not let one model's outage take down every other model's
    picks for the gameweek (see generate_picks_for_gameweek).
    """
    http = session or requests
    try:
        response = http.post(
            OPENROUTER_URL,
            headers={
                "Authorization": f"Bearer {_api_key()}",
                "Content-Type": "application/json",
                # OpenRouter asks integrations to identify themselves via
                # these headers; doesn't gate anything, just good citizenship.
                "HTTP-Referer": "https://yezir4.github.io/fpl",
                "X-Title": "FPL Prediction Market -- Agent Picks",
            },
            json={
                "model": model.slug,
                "messages": [{"role": "user", "content": prompt}],
                "response_format": {"type": "json_object"},
                "temperature": 0.2,
            },
            timeout=DEFAULT_TIMEOUT,
        )
        response.raise_for_status()
        body = response.json()
    except (requests.RequestException, ValueError) as exc:
        raise OpenRouterError(f"{model.slug}: request failed: {exc}") from exc

    try:
        return body["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise OpenRouterError(f"{model.slug}: unexpected response shape: {body}") from exc


def _team_name(team: dict) -> str:
    return team.get("short_name") or team.get("name") or f"Team {team['id']}"


def _team_names(bootstrap: dict) -> dict[int, str]:
    return {t["id"]: _team_name(t) for t in bootstrap["teams"]}


def _opponent_summary(
    fixtures: list[dict], gw: int, team_id: int, team_names: dict[int, str]
) -> str:
    matches = [f for f in fixtures if f["event"] == gw and team_id in (f["team_h"], f["team_a"])]
    if not matches:
        return "no fixture (blank gameweek)"
    if len(matches) > 1:
        legs = []
        for f in matches:
            home = f["team_h"] == team_id
            opp = f["team_a"] if home else f["team_h"]
            legs.append(f"{'vs' if home else '@'} {team_names.get(opp, '?')}")
        return "double gameweek: " + ", ".join(legs)
    f = matches[0]
    home = f["team_h"] == team_id
    opp = f["team_a"] if home else f["team_h"]
    return f"{'vs' if home else '@'} {team_names.get(opp, '?')}"


def build_prompt(
    players: list[Player],
    bootstrap: dict,
    fixtures: list[dict],
    gw: int,
    *,
    thresholds: tuple[int, ...] = (PRIMARY_POINTS_THRESHOLD, SECONDARY_POINTS_THRESHOLD),
) -> str:
    """The exact prompt every model gets for a gameweek.

    Deliberately identical across all five models -- the leaderboard is
    meant to compare their judgement given the same information, not
    who happened to get a better prompt.

    Two changes from an earlier version, both requested directly after
    watching real gameweeks run with the old prompt:

    1. A model is no longer required to cover every (player, threshold)
       pair -- it's shown this system's own market price for each one
       and told plainly it's scored on P&L from the bets it actually
       places, not raw accuracy across a forced full board. Forcing a
       pick on a market it has no real opinion on was a guardrail that
       actively worked against the thing the leaderboard is supposed
       to measure: a model with no edge anywhere is free to submit an
       empty `picks` list (see PicksParseError -- that's a valid
       answer, not a parse failure).
    2. The prompt now explains its own economy -- a fixed gameweek
       bankroll, and how confidence sizes a bet against it -- so a
       model can reason about sizing and edge together, not just
       direction. Still true, and now said out loud: confidence never
       touches the odds (`oddsmaker.market_probability` prices every
       market from real player standing, before any model ever sees
       it), so a model can't buy a better price by claiming more
       conviction -- only a bigger stake on a pick it's actually right
       about.
    """
    team_names = _team_names(bootstrap)
    n_pairs = len(players) * len(thresholds)
    lines = [
        f"You are picking outcomes for a Fantasy Premier League (FPL) prediction market, gameweek {gw}.",
        "Your picks are tracked on a public leaderboard alongside four other AI models and scored",
        "against the real results once this gameweek finishes -- you are judged on total profit and",
        "loss (P&L) from the bets you actually place, NOT on how many markets you attempt or your",
        "raw accuracy across the board. There is no reward for guessing on a market you have no real",
        "edge in, and no penalty for leaving one alone -- only bet where you believe the true",
        "probability is meaningfully different from the market price already shown below for it.",
        "",
        f"Your bankroll this gameweek is a fixed ${oddsmaker.TOTAL_BANKROLL_USD:.0f}, split across",
        "whatever picks you actually make -- each pick's own confidence (0-1) sizes its share of that",
        "bankroll relative to your other picks this gameweek (higher confidence = a bigger share,",
        "never a guarantee of being right). Betting on every market dilutes your best ideas instead",
        "of sizing them up; betting on none is a fully valid answer if you see no real edge anywhere.",
        "A correct pick pays back 1 / (the market price of the side you took) times its stake; a",
        "wrong one pays nothing. The market price is this system's own -- never your opinion -- so you",
        "cannot buy better odds by claiming more confidence, only a bigger stake on a pick you're",
        "actually right about.",
        "",
        "For each player below, decide whether they will score AT LEAST the given points threshold",
        "in this single gameweek (standard FPL scoring: goals, assists, clean sheets, bonus, etc),",
        "against this system's own market price for that outcome.",
        "",
        "Players (id, name, team, opponent this gameweek, price, season points, market price per",
        "threshold -- the probability this system already prices that outcome at):",
    ]
    for p in players:
        opp = _opponent_summary(fixtures, gw, p.team, team_names)
        market = ", ".join(
            f"{round(oddsmaker.market_probability(p.id, t, bootstrap) * 100)}% Yes on {t}+"
            for t in thresholds
        )
        lines.append(
            f"- id={p.id} {p.web_name} ({team_names.get(p.team, '?')}) {opp}, "
            f"£{p.price_millions:.1f}m, {p.total_points} pts this season -- market: {market}"
        )
    lines += [
        "",
        f"Thresholds: {', '.join(str(t) for t in thresholds)}.",
        "",
        "Respond with ONLY a JSON object of this exact shape, no other text, no markdown fences:",
        '{"picks": [{"player_id": <int>, "threshold": <int>, "pick": "yes"|"no", "confidence": <0-1 float>}, ...]}',
        "Include an entry ONLY for the (player, threshold) pairs you actually want to bet on -- zero,",
        f'some, or all of the {n_pairs} possible pairs above. An empty list ("picks": []) is a valid',
        "answer if you see no edge anywhere this gameweek.",
    ]
    return "\n".join(lines)


@dataclass(frozen=True)
class AgentPick:
    player_id: int
    threshold: int
    pick: bool  # True = model expects the player to clear the threshold
    confidence: float | None
    # Populated by generate_picks_for_gameweek() (via
    # oddsmaker.with_bet_records()) after parse_picks() below returns
    # the model's raw pick+confidence -- parse_picks() itself stays a
    # pure parser of the model's reply, with no pricing concerns of
    # its own. None here means "not priced yet" (e.g. an AgentPick
    # built directly in a test), never "no market exists".
    market_probability: float | None = None
    stake_vara: float | None = None
    potential_return_vara: float | None = None


class PicksParseError(ValueError):
    """Raised when a model's reply can't be read as the required JSON
    shape at all (no JSON object found, or no "picks" list in it) --
    as opposed to parsing into a `picks` list that's simply empty, or
    whose entries don't individually validate. That's a normal,
    deliberate "no bets this gameweek" reply (see build_prompt()'s
    docstring for why that's now a valid answer, not an error), never
    raised for it -- only for a reply that didn't follow the required
    shape at all."""


def parse_picks(
    raw_text: str,
    *,
    valid_player_ids: set[int],
    valid_thresholds: set[int],
) -> list[AgentPick]:
    """Defensively parse a model's reply into picks.

    Never fabricates a pick for a malformed or out-of-pool entry -- a
    model that returns garbage just yields fewer picks, never a wrong
    or invented one. Tolerates the reply being wrapped in markdown code
    fences, or having commentary before/after the JSON object, despite
    being told JSON-only in the prompt -- confirmed for real, not
    hypothetical: `~google/gemini-pro-latest` did exactly this on its
    first live run against real GW picks (see docs/architecture.md).

    Raises PicksParseError when the reply doesn't even follow the
    required shape (no JSON object, or no "picks" list) -- a real
    parsing failure. Returns an empty list, not an error, when the
    shape is right but there's nothing usable in it (an empty "picks"
    list, or every entry in it failing validation): a model that
    looked at every market and chose to bet on none is behaving
    exactly as asked, not malfunctioning.
    """
    text = raw_text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        stripped = text.lstrip()
        if stripped[:4].lower() == "json":
            text = stripped[4:]

    try:
        parsed = json.loads(text)
    except ValueError:
        # Fall back to the first top-level {...} object found anywhere
        # in the reply, in case it's wrapped in leading/trailing prose
        # that the code-fence handling above doesn't strip (that only
        # catches a fence at the very start of the reply).
        start, end = text.find("{"), text.rfind("}")
        if start == -1 or end == -1 or end <= start:
            raise PicksParseError(f"no JSON object found in a {len(raw_text)}-char reply")
        try:
            parsed = json.loads(text[start : end + 1])
        except ValueError as exc:
            raise PicksParseError(f"embedded JSON object failed to parse: {exc}") from exc

    entries = parsed.get("picks") if isinstance(parsed, dict) else None
    if not isinstance(entries, list):
        raise PicksParseError('reply JSON has no "picks" list')

    picks: list[AgentPick] = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        player_id = entry.get("player_id")
        threshold = entry.get("threshold")
        pick_raw = entry.get("pick")
        if not isinstance(player_id, int) or player_id not in valid_player_ids:
            continue
        if not isinstance(threshold, int) or threshold not in valid_thresholds:
            continue
        if not isinstance(pick_raw, str) or pick_raw.strip().lower() not in ("yes", "no"):
            continue

        confidence = entry.get("confidence")
        if isinstance(confidence, bool) or not isinstance(confidence, (int, float)):
            confidence = None
        elif not (0 <= confidence <= 1):
            confidence = None

        picks.append(
            AgentPick(
                player_id=player_id,
                threshold=threshold,
                pick=pick_raw.strip().lower() == "yes",
                confidence=float(confidence) if confidence is not None else None,
            )
        )
    return picks


@dataclass
class ModelPicksResult:
    model: AgentModel
    picks: list[AgentPick]
    # Set on a failed call or a reply that didn't follow the required
    # JSON shape at all (see PicksParseError). An empty `picks` list
    # with `error is None` is a valid, deliberate "no edge anywhere
    # this gameweek" result, not a failure -- see build_prompt()'s
    # docstring.
    error: str | None


def generate_picks_for_gameweek(
    gw: int,
    *,
    # Matches web/src/app/page.tsx's MARKET_PLAYER_COUNT -- models are
    # asked about exactly the players real users can also see and
    # stake on, no wider "candidate" pool. Was 20 (40 markets/model at
    # 2 thresholds each); trimmed after a real run made it obvious 40
    # picks per model per gameweek was too many to read as a leaderboard,
    # not just too many to fit the site's own markets grid.
    n_players: int = 8,
    thresholds: tuple[int, ...] = (PRIMARY_POINTS_THRESHOLD, SECONDARY_POINTS_THRESHOLD),
    cache_dir: Path | None = None,
    models: tuple[AgentModel, ...] = AGENT_MODELS,
    session: requests.Session | None = None,
) -> list[ModelPicksResult]:
    """Ask every configured model for its picks on one gameweek's player pool.

    One model failing (bad slug, outage, malformed reply) never blocks
    the others -- each is caught and recorded individually, so a
    partial result is still a useful, honest result. A model that
    replies with valid JSON but an empty (or entirely-filtered) picks
    list is NOT a failure -- see build_prompt()'s docstring for why
    "no edge anywhere this gameweek" is now a deliberately valid
    answer, distinct from PicksParseError's "didn't even follow the
    required shape."
    """
    kwargs = {"cache_dir": cache_dir} if cache_dir is not None else {}
    bootstrap = cache.load_latest_bootstrap_static(**kwargs)
    fixtures = cache.load_latest_fixtures(**kwargs)
    players = top_expensive_players(bootstrap, n=n_players)
    valid_player_ids = {p.id for p in players}
    valid_thresholds = set(thresholds)

    prompt = build_prompt(players, bootstrap, fixtures, gw, thresholds=thresholds)

    # Fetched once per gameweek, not once per model or per pick --
    # every model's bet record this run should price VARA at the same
    # rate, and CoinGecko's free tier is rate-limited enough that one
    # call per gameweek is the right cadence anyway. See
    # oddsmaker.TOTAL_BANKROLL_USD's docstring for why this is what
    # turns "$10" into an actual VARA amount.
    vara_usd_price = vara_price.fetch_vara_usd_price(session=session)

    results: list[ModelPicksResult] = []
    for model in models:
        try:
            raw = call_model(model, prompt, session=session)
        except OpenRouterError as exc:
            results.append(ModelPicksResult(model=model, picks=[], error=str(exc)))
            continue
        try:
            picks = parse_picks(raw, valid_player_ids=valid_player_ids, valid_thresholds=valid_thresholds)
        except PicksParseError as exc:
            results.append(ModelPicksResult(model=model, picks=[], error=str(exc)))
            continue
        # This system's own bet records, not the model's -- see
        # oddsmaker.bet_records()'s docstring for why the odds come
        # entirely from player standing (never from what the model
        # itself claims to believe), and why the stakes across this
        # one model's whole pick list are sized together (a fixed
        # gameweek bankroll split by confidence), not independently
        # per pick. bet_records() already returns [] for an empty
        # `picks` list, so an intentional "no bets" reply needs no
        # special-casing here.
        picks = oddsmaker.with_bet_records(picks, bootstrap, vara_usd_price)
        results.append(ModelPicksResult(model=model, picks=picks, error=None))
    return results


def save_picks(gw: int, results: list[ModelPicksResult], *, picks_dir: Path = PICKS_DIR) -> Path:
    picks_dir.mkdir(parents=True, exist_ok=True)
    path = picks_dir / f"gw{gw}.json"
    payload = {
        "gw": gw,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "models": [
            {
                "slug": r.model.slug,
                "name": r.model.name,
                "error": r.error,
                "picks": [
                    {
                        "player_id": p.player_id,
                        "threshold": p.threshold,
                        "pick": "yes" if p.pick else "no",
                        "confidence": p.confidence,
                        "market_probability": p.market_probability,
                        "stake_vara": p.stake_vara,
                        "potential_return_vara": p.potential_return_vara,
                    }
                    for p in r.picks
                ],
            }
            for r in results
        ],
    }
    path.write_text(json.dumps(payload, indent=2, sort_keys=True))
    return path


def load_picks(gw: int, *, picks_dir: Path = PICKS_DIR) -> dict:
    path = picks_dir / f"gw{gw}.json"
    if not path.exists():
        raise FileNotFoundError(f"No saved picks for GW{gw} at {path}")
    return json.loads(path.read_text())
