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

from . import cache
from .players import Player, top_expensive_players
from .settlement import PRIMARY_POINTS_THRESHOLD, SECONDARY_POINTS_THRESHOLD

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_TIMEOUT = 60

PICKS_DIR = Path("data/agent_picks")


@dataclass(frozen=True)
class AgentModel:
    slug: str
    name: str


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
    AgentModel("~openai/gpt-latest", "GPT (latest)"),
    AgentModel("~anthropic/claude-opus-latest", "Claude Opus (latest)"),
    AgentModel("~google/gemini-pro-latest", "Gemini Pro (latest)"),
    AgentModel("x-ai/grok-4.20", "Grok 4.20"),
    AgentModel("deepseek/deepseek-v4-pro", "DeepSeek V4 Pro"),
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
    """
    team_names = _team_names(bootstrap)
    lines = [
        f"You are picking outcomes for a Fantasy Premier League (FPL) prediction market, gameweek {gw}.",
        "For each player below, predict whether they will score AT LEAST the given points threshold",
        "in this single gameweek (standard FPL scoring: goals, assists, clean sheets, bonus, etc).",
        "",
        "Players (id, name, team, opponent this gameweek, price, season total points so far):",
    ]
    for p in players:
        opp = _opponent_summary(fixtures, gw, p.team, team_names)
        lines.append(
            f"- id={p.id} {p.web_name} ({team_names.get(p.team, '?')}) {opp}, "
            f"£{p.price_millions:.1f}m, {p.total_points} pts this season"
        )
    lines += [
        "",
        f"Thresholds to judge for every player: {', '.join(str(t) for t in thresholds)}.",
        "",
        "Respond with ONLY a JSON object of this exact shape, no other text, no markdown fences:",
        '{"picks": [{"player_id": <int>, "threshold": <int>, "pick": "yes"|"no", "confidence": <0-1 float>}, ...]}',
        f"Include one entry for every (player, threshold) pair above -- {len(players)} players x "
        f"{len(thresholds)} thresholds = {len(players) * len(thresholds)} entries total.",
    ]
    return "\n".join(lines)


@dataclass(frozen=True)
class AgentPick:
    player_id: int
    threshold: int
    pick: bool  # True = model expects the player to clear the threshold
    confidence: float | None


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
    fences (some models do this despite being told JSON-only).
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
        return []

    entries = parsed.get("picks") if isinstance(parsed, dict) else None
    if not isinstance(entries, list):
        return []

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
    error: str | None  # set on a failed call, or a reply that parsed to zero picks


def generate_picks_for_gameweek(
    gw: int,
    *,
    n_players: int = 20,
    thresholds: tuple[int, ...] = (PRIMARY_POINTS_THRESHOLD, SECONDARY_POINTS_THRESHOLD),
    cache_dir: Path | None = None,
    models: tuple[AgentModel, ...] = AGENT_MODELS,
    session: requests.Session | None = None,
) -> list[ModelPicksResult]:
    """Ask every configured model for its picks on one gameweek's player pool.

    One model failing (bad slug, outage, malformed reply) never blocks
    the others -- each is caught and recorded individually, so a
    partial result is still a useful, honest result.
    """
    kwargs = {"cache_dir": cache_dir} if cache_dir is not None else {}
    bootstrap = cache.load_latest_bootstrap_static(**kwargs)
    fixtures = cache.load_latest_fixtures(**kwargs)
    players = top_expensive_players(bootstrap, n=n_players)
    valid_player_ids = {p.id for p in players}
    valid_thresholds = set(thresholds)

    prompt = build_prompt(players, bootstrap, fixtures, gw, thresholds=thresholds)

    results: list[ModelPicksResult] = []
    for model in models:
        try:
            raw = call_model(model, prompt, session=session)
        except OpenRouterError as exc:
            results.append(ModelPicksResult(model=model, picks=[], error=str(exc)))
            continue
        picks = parse_picks(raw, valid_player_ids=valid_player_ids, valid_thresholds=valid_thresholds)
        error = None if picks else f"parsed 0 usable picks from a {len(raw)}-char reply"
        results.append(ModelPicksResult(model=model, picks=picks, error=error))
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
