"""Ask frontier models to price FPL markets, then trade their opinions for real.

This is the "ask the models" half; `leaderboard.py` is the "were they right"
half. What changed from the Vara version, and why, is worth stating once --
most of the old design survived, and the parts that didn't were the parts that
assumed paper money.

KEPT, deliberately, because it was right:

  - One identical prompt for every model. The board compares judgement given
    the same information, not who got the better prompt.
  - The odds never come from a model's own confidence. In the old build that
    was a rule we enforced; on Panta it is simply true -- the price comes from
    the pool, and a model claiming conviction cannot move it.
  - Never fabricate a pick on a parse failure. A swallowed error would invent
    a leaderboard entry.
  - Per-model error isolation: one dead slug fails one model, not the week.
  - Abstention is a valid answer. Forcing a pick on a market a model has no
    view on measures stamina, not skill.

CHANGED, because the old version was pricing bets nobody could place:

  - No VARA. Stakes are USDC, so the whole vara_price module and its live
    exchange-rate dependency are gone. One fewer network call, one fewer way
    to fail mid-sprint.
  - No simulated payouts. A forecast becomes a real primary order on Panta,
    and the fill is read back from the chain rather than computed.
  - The prompt shows the REAL pool price, because that is the price a model
    would actually trade at. The old version showed our own modeled
    probability, which is a different and much easier question.

ADDED, because it is the difference between a scoreboard and a benchmark:

  - A stated probability. The old prompt asked for pick + confidence, and
    confidence is confidence in the BET, not the probability of the EVENT --
    you cannot compute calibration from it. With a probability you get both
    the edge a model believed it had (p minus price) and its Brier score.
  - A one-line rationale, so the board can show reasoning, not just a verdict.
  - The raw reply is stored even when parsing fails, so a bad reply is
    diagnosable afterwards instead of being one opaque error string.
  - The decision-time price is stored with the pick. A benchmark has to be
    auditable, and the pool will have moved by the time anyone checks.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import requests

from . import cache
from .players import Player, top_expensive_players

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_TIMEOUT = 90

PICKS_DIR = Path("data/agent_picks")

# The per-agent bankroll the whole exercise is budgeted around. It lives here
# rather than in a pricing module because it is no longer a pricing input: the
# model spends it, and the pool sets the price.
AGENT_BANKROLL_USDC = 5.0


@dataclass(frozen=True)
class AgentModel:
    slug: str
    name: str
    # A real Solana public key, one per model, so each model's trades are
    # separately attributable on chain. A public key is safe to commit; the
    # secret behind it never goes in this repo.
    solana_address: str = ""


# One model per lab, for genuine cross-lab diversity rather than several from
# one family. Self-updating "latest" aliases where OpenRouter offers them, so
# the list doesn't go stale the way dated slugs eventually do.
#
# Addresses are empty here and filled in by provisioning them for real. A model
# without an address is refused at trade time rather than defaulted to
# somebody else's wallet.
_DEFAULT_AGENT_MODELS: tuple[AgentModel, ...] = (
    AgentModel("~openai/gpt-latest", "GPT (latest)"),
    AgentModel("~anthropic/claude-opus-latest", "Claude Opus (latest)"),
    AgentModel("~google/gemini-pro-latest", "Gemini Pro (latest)"),
    AgentModel("x-ai/grok-4.20", "Grok 4.20"),
    AgentModel("deepseek/deepseek-v4-pro", "DeepSeek V4 Pro"),
)

AGENT_MODELS_JSON = Path("data/agent_models.json")


def _parse_model_spec(spec: str) -> tuple[AgentModel, ...]:
    """Parse "slug|Label,slug|Label" into AgentModels.

    '|' separates slug from label because OpenRouter slugs contain colons
    (e.g. "deepseek/deepseek-chat-v3.1:free"), so ':' is not a safe delimiter.
    """
    models: list[AgentModel] = []
    for chunk in spec.split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        slug, _, label = chunk.partition("|")
        slug = slug.strip()
        if slug:
            models.append(AgentModel(slug, label.strip() or slug, ""))
    return tuple(models)


def _resolve_agent_models() -> tuple[AgentModel, ...]:
    spec = os.environ.get("AGENT_MODELS", "").strip()
    if spec:
        parsed = _parse_model_spec(spec)
        if parsed:
            return parsed

    if AGENT_MODELS_JSON.exists():
        try:
            raw = json.loads(AGENT_MODELS_JSON.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            raw = None
        if isinstance(raw, list):
            parsed = tuple(
                AgentModel(
                    entry["slug"],
                    entry.get("name") or entry["slug"],
                    entry.get("solana_address", ""),
                )
                for entry in raw
                if isinstance(entry, dict) and entry.get("slug")
            )
            if parsed:
                return parsed

    return _DEFAULT_AGENT_MODELS


AGENT_MODELS: tuple[AgentModel, ...] = _resolve_agent_models()


class OpenRouterError(RuntimeError):
    """Raised when OpenRouter can't be reached or returns something unusable."""


def _api_key() -> str:
    key = os.environ.get("OPENROUTER_API_KEY")
    if not key:
        raise OpenRouterError(
            "OPENROUTER_API_KEY is not set -- it's a GitHub Actions secret the "
            "repo owner adds directly (Settings -> Secrets and variables -> "
            "Actions), never pasted into chat or committed."
        )
    return key


def call_model(
    model: AgentModel, prompt: str, *, session: requests.Session | None = None
) -> str:
    """One call to OpenRouter's OpenAI-compatible chat-completions endpoint.

    Returns the raw text content of the reply. Raises OpenRouterError on any
    failure -- never returns a fabricated fallback, since a swallowed failure
    here would silently produce a fake pick. Callers catch this per model, so
    one outage doesn't take down every other model's forecasts.
    """
    http = session or requests
    try:
        response = http.post(
            OPENROUTER_URL,
            headers={
                "Authorization": f"Bearer {_api_key()}",
                "Content-Type": "application/json",
                # OpenRouter asks integrations to identify themselves via these
                # headers; doesn't gate anything, just good citizenship.
                "HTTP-Referer": "https://yezir4.github.io/fpl",
                "X-Title": "Overline -- Agent Forecasts",
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


# ------------------------------------------------------------------ markets


@dataclass(frozen=True)
class LiveMarket:
    """One real, tradeable Panta market, as the models will see it.

    Prices are the pool's, not ours. YES and NO are quoted separately rather
    than assumed to sum to 1, because on a real pool with a spread they don't --
    and pretending otherwise would hand every model a phantom edge.
    """

    market_id: str
    question: str
    yes_price: float
    no_price: float
    player_id: int | None = None
    player_name: str = ""
    position: str = ""
    threshold: int = 0
    # ISO 8601. Trading stops here, so a forecast is only meaningful before it.
    end_time: str | None = None

    @property
    def implied_yes(self) -> float:
        """The pool's own YES probability, normalised past any spread."""
        total = self.yes_price + self.no_price
        return self.yes_price / total if total > 0 else 0.5


def _team_names(bootstrap: dict) -> dict[int, str]:
    return {
        t["id"]: (t.get("short_name") or t.get("name") or f"Team {t['id']}")
        for t in bootstrap["teams"]
    }


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
    markets: list[LiveMarket],
    players: list[Player],
    bootstrap: dict,
    fixtures: list[dict],
    gw: int,
    *,
    bankroll_usdc: float = AGENT_BANKROLL_USDC,
) -> str:
    """The exact prompt every model gets.

    Deliberately identical across models -- the board compares judgement given
    the same information, not prompt-craft.

    Two things this asks for that the Vara version did not, and why:

    1. A PROBABILITY, not just a pick and a confidence. Confidence tells you how
       sure a model is about its bet; it does not tell you what it thinks the
       outcome is worth. With a probability you can measure both the edge it
       believed it had (probability minus price) and whether its confidence was
       calibrated (Brier score) -- the entire difference between a benchmark and
       a scoreboard.

    2. A one-line rationale, so the published board can show reasoning rather
       than a bare verdict.

    Models are told the pool's price and told plainly that the price is not
    theirs to set. That was a rule we enforced in the old build; here it is a
    fact about how an AMM works, which is why the instruction survived intact.
    """
    team_names = _team_names(bootstrap)
    by_id = {p.id: p for p in players}

    lines = [
        f"You are forecasting Fantasy Premier League (FPL) outcomes for gameweek {gw},",
        "and your forecasts are traded as real positions in prediction markets on Solana.",
        "",
        "You are one of five frontier models doing this. Your work is published and scored",
        "on three things, all public:",
        "  1. profit and loss from the positions actually taken,",
        "  2. whether your stated probabilities were calibrated (Brier score),",
        "  3. whether you had a real edge, or just a loud opinion.",
        "",
        "You are NOT scored on how many markets you attempt. There is no penalty for",
        "passing on every market, and passing is the right answer when you have no view.",
        "",
        f"Your bankroll is ${bankroll_usdc:.2f} for the entire gameweek, across every market",
        "below. It is yours to allocate, and an unspent bankroll is not a failure.",
        "",
        "THE PRICE IS NOT YOURS TO SET. Each market below shows the real pool price, set",
        "by the market's own liquidity and by other traders. Stating more confidence does",
        "not get you a better price. You make money only by being right about something",
        "the price has wrong.",
        "",
        "Markets (market_id | question | pool price for YES and NO | context):",
    ]

    for m in markets:
        player = by_id.get(m.player_id) if m.player_id is not None else None
        detail = ""
        if player is not None:
            opp = _opponent_summary(fixtures, gw, player.team, team_names)
            detail = (
                f" | {player.web_name} ({team_names.get(player.team, '?')}) {opp}, "
                f"£{player.price_millions:.1f}m, {player.total_points} pts so far this season"
            )
        lines.append(
            f"- {m.market_id} | {m.question} | YES {m.yes_price:.3f}, NO {m.no_price:.3f}"
            f"{detail}"
        )

    lines += [
        "",
        "Define your probability as the chance the market resolves YES -- the player",
        "reaching the stated points total in this single gameweek, under standard FPL",
        "scoring (goals, assists, clean sheets, bonus, appearance points).",
        "",
        "Then choose a stake. You are not obliged to bet on any market, and a market",
        "you have no view on should not be forced -- but a PASS still needs a reason.",
        "",
        "Respond with ONLY a JSON object, no markdown fences, no other text:",
        '{"picks": [{"market_id": "<id>", "probability": <0-1>, "stake_usdc": <number>, ',
        '  "reasoning": "<one sentence, under 200 characters>"}],',
        ' "passes": [{"market_id": "<id>", "reason": "<why you are not betting, under 160 chars>"}]}',
        "",
        f'"probability" is your belief the market resolves YES. "stake_usdc" is how much of',
        f"your ${bankroll_usdc:.2f} you commit, and must not exceed it in total across all",
        "picks.",
        "",
        "EVERY MARKET YOU DO NOT BET ON GOES IN \"passes\", WITH A REASON. This is not",
        "bookkeeping. A pass with a reason is a claim about your own edge -- 'the price",
        "looks fair to me' and 'I cannot judge this one' are both real answers and they say",
        "different things. A pass with no reason is indistinguishable from never having",
        "looked, and that distinction is most of what this exercise measures.",
        "",
        'An empty list ({"picks": []}) is a perfectly good answer, as long as your',
        '"passes" explain why you sat this gameweek out.',
    ]
    return "\n".join(lines)


# -------------------------------------------------------------------- picks


@dataclass(frozen=True)
class AgentPick:
    market_id: str
    # The model's belief that the market resolves YES. This is the number the
    # Brier score is computed from, and the reason the prompt asks for it at all.
    probability: float
    stake_usdc: float
    reasoning: str = ""
    # Carried from the market so a saved pick stays scoreable once the market
    # set is no longer to hand. resolution.py settles on (player, threshold),
    # and a picks file keyed only by market_id could not be scored after the
    # fact -- a real gap in the first draft of this.
    player_id: int | None = None
    threshold: int = 0
    # Filled in once the pool price is known, so edge can be reported even for a
    # pick that was never traded (below the minimum order size, say).
    yes_price: float | None = None
    no_price: float | None = None

    @property
    def side(self) -> str | None:
        """Which side this forecast actually backs, derived rather than asked for.

        Deriving it stops a model stating a probability and then taking the
        opposite side -- an incoherent pick that would still score. With a real
        spread it is possible for neither side to be +EV, and then there is no
        trade. That is a correct outcome, not a bug.
        """
        if self.yes_price is None or self.no_price is None:
            return None
        yes_edge = self.probability - self.yes_price
        no_edge = (1 - self.probability) - self.no_price
        if yes_edge <= 0 and no_edge <= 0:
            return None
        return "yes" if yes_edge >= no_edge else "no"

    @property
    def side_price(self) -> float | None:
        s = self.side
        if s is None:
            return None
        return self.yes_price if s == "yes" else self.no_price

    @property
    def edge(self) -> float | None:
        """Believed edge over the pool, as a probability. None if no trade."""
        s = self.side
        p = self.side_price
        if s is None or p is None:
            return None
        belief = self.probability if s == "yes" else 1 - self.probability
        return belief - p


class PicksParseError(ValueError):
    """The reply didn't follow the required shape at all -- no JSON object, or
    no "picks" list.

    Distinct from a `picks` list that is empty, or whose entries all fail
    validation: that is a deliberate "no view this gameweek" answer and returns
    an empty list rather than raising.
    """


def parse_picks(raw_text: str, *, valid_market_ids: set[str]) -> list[AgentPick]:
    """Defensively parse a model's reply into picks.

    Never fabricates a pick for a malformed or unknown-market entry -- a model
    returning garbage yields fewer picks, never a wrong or invented one.

    Tolerates markdown fences and surrounding prose, despite the prompt saying
    JSON-only. Not hypothetical: `~google/gemini-pro-latest` did exactly that on
    its first live run in the previous build.
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
        market_id = entry.get("market_id")
        if not isinstance(market_id, str) or market_id not in valid_market_ids:
            continue

        probability = entry.get("probability")
        if isinstance(probability, bool) or not isinstance(probability, (int, float)):
            continue
        if not (0.0 <= probability <= 1.0):
            continue

        stake = entry.get("stake_usdc")
        if isinstance(stake, bool) or not isinstance(stake, (int, float)) or stake <= 0:
            # A zero or missing stake is a deliberate pass, not a parse failure.
            continue

        reasoning = entry.get("reasoning")
        if not isinstance(reasoning, str):
            reasoning = ""

        picks.append(
            AgentPick(
                market_id=market_id,
                probability=float(probability),
                stake_usdc=round(float(stake), 2),
                reasoning=reasoning.strip()[:280],
            )
        )
    return picks


@dataclass(frozen=True)
class AgentPass:
    """A market the model looked at and deliberately did not bet on.

    Added because a silent pass is the least informative thing a model can do. It
    is indistinguishable from not having read the market at all, and the whole
    exercise is about separating a considered "the price looks fair" from a
    shrug. Recorded and published, so a pass carries as much accountability as a
    bet does.
    """

    market_id: str
    reason: str


def parse_passes(raw_text: str, *, valid_market_ids: set[str]) -> list[AgentPass]:
    """Pull the `passes` list out of a reply.

    Deliberately forgiving, and deliberately NOT raising. The passes block is
    newer than the picks block, so a model that ignores it should lose the extra
    detail rather than the whole forecast. Missing or malformed passes yield an
    empty list, never an exception -- parse_picks still owns the "did this reply
    follow the shape at all" decision.
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
        start, end = text.find("{"), text.rfind("}")
        if start == -1 or end == -1 or end <= start:
            return []
        try:
            parsed = json.loads(text[start : end + 1])
        except ValueError:
            return []

    entries = parsed.get("passes") if isinstance(parsed, dict) else None
    if not isinstance(entries, list):
        return []

    passes: list[AgentPass] = []
    seen: set[str] = set()
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        market_id = entry.get("market_id")
        if not isinstance(market_id, str) or market_id not in valid_market_ids:
            continue
        if market_id in seen:
            continue
        reason = entry.get("reason")
        if not isinstance(reason, str):
            reason = ""
        seen.add(market_id)
        passes.append(AgentPass(market_id=market_id, reason=reason.strip()[:240]))
    return passes


def apply_bankroll_cap(picks: list[AgentPick], bankroll_usdc: float) -> list[AgentPick]:
    """Scale stakes down proportionally if a model overspent its bankroll.

    A model that ignores the limit is not disqualified, it is trimmed -- and the
    trimming shows up in the numbers. Letting it silently stake more than
    everyone else would corrupt the only comparison that matters.
    """
    total = sum(p.stake_usdc for p in picks)
    if total <= bankroll_usdc or total == 0:
        return picks
    factor = bankroll_usdc / total
    return [
        AgentPick(
            market_id=p.market_id,
            probability=p.probability,
            stake_usdc=round(p.stake_usdc * factor, 2),
            reasoning=p.reasoning,
            player_id=p.player_id,
            threshold=p.threshold,
        )
        for p in picks
    ]


@dataclass
class ModelPicksResult:
    model: AgentModel
    picks: list[AgentPick] = field(default_factory=list)
    # Set on a failed call or a reply that didn't follow the required shape. An
    # empty `picks` list with `error is None` is a deliberate "no view" result.
    error: str | None = None
    # Markets it looked at and declined to bet on, with its reason. Empty when a
    # model simply ignored the request -- which is recorded as no reason given
    # rather than as "it had no view on anything".
    passes: list[AgentPass] = field(default_factory=list)
    # The model's actual reply, kept even when parsing failed. The Vara version
    # stored only the error string, which made a bad reply impossible to
    # diagnose after the fact.
    raw_reply: str = ""
    decided_at: str = ""


def generate_picks_for_gameweek(
    gw: int,
    *,
    markets: list[LiveMarket],
    n_players: int | None = None,
    cache_dir: Path | None = None,
    models: tuple[AgentModel, ...] = AGENT_MODELS,
    session: requests.Session | None = None,
) -> list[ModelPicksResult]:
    """Ask every configured model to forecast the given live markets.

    Prices come from the caller, read from Panta, because the models must see
    the price they would actually trade at. `n_players` widens the FPL context
    given to the models; it does not add markets, since a market that does not
    exist cannot be traded.
    """
    kwargs = {"cache_dir": cache_dir} if cache_dir is not None else {}
    bootstrap = cache.load_latest_bootstrap_static(**kwargs)
    fixtures = cache.load_latest_fixtures(**kwargs)
    players = top_expensive_players(bootstrap, n=n_players or 20)
    valid_market_ids = {m.market_id for m in markets}
    price_of = {m.market_id: (m.yes_price, m.no_price) for m in markets}
    market_of = {m.market_id: m for m in markets}

    prompt = build_prompt(markets, players, bootstrap, fixtures, gw)

    results: list[ModelPicksResult] = []
    for model in models:
        decided_at = datetime.now(timezone.utc).isoformat()
        try:
            raw = call_model(model, prompt, session=session)
        except OpenRouterError as exc:
            results.append(ModelPicksResult(model=model, error=str(exc), decided_at=decided_at))
            continue

        try:
            picks = parse_picks(raw, valid_market_ids=valid_market_ids)
        except PicksParseError as exc:
            results.append(
                ModelPicksResult(model=model, error=str(exc), raw_reply=raw, decided_at=decided_at)
            )
            continue

        picks = apply_bankroll_cap(picks, AGENT_BANKROLL_USDC)
        picks = [
            AgentPick(
                market_id=p.market_id,
                probability=p.probability,
                stake_usdc=p.stake_usdc,
                reasoning=p.reasoning,
                player_id=market_of[p.market_id].player_id,
                threshold=market_of[p.market_id].threshold,
                yes_price=price_of[p.market_id][0],
                no_price=price_of[p.market_id][1],
            )
            for p in picks
        ]
        results.append(
            ModelPicksResult(
                model=model,
                picks=picks,
                passes=parse_passes(raw, valid_market_ids=valid_market_ids),
                raw_reply=raw,
                decided_at=decided_at,
            )
        )
    return results


def save_picks(gw: int, results: list[ModelPicksResult], *, picks_dir: Path = PICKS_DIR) -> Path:
    picks_dir.mkdir(parents=True, exist_ok=True)
    path = picks_dir / f"gw{gw}.json"
    payload = {
        "gw": gw,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "bankroll_usdc": AGENT_BANKROLL_USDC,
        "models": [
            {
                "slug": r.model.slug,
                "name": r.model.name,
                "solana_address": r.model.solana_address,
                "error": r.error,
                "decided_at": r.decided_at,
                "raw_reply": r.raw_reply,
                "picks": [
                    {
                        "market_id": p.market_id,
                        "player_id": p.player_id,
                        "threshold": p.threshold,
                        "probability": p.probability,
                        "stake_usdc": p.stake_usdc,
                        "reasoning": p.reasoning,
                        # The price at decision time is stored, not looked up
                        # later: the pool will have moved by the time anyone
                        # checks, and an unauditable benchmark is not one.
                        "yes_price_at_decision": p.yes_price,
                        "no_price_at_decision": p.no_price,
                        "side": p.side,
                        "edge": p.edge,
                    }
                    for p in r.picks
                ],
                "passes": [
                    {"market_id": p.market_id, "reason": p.reason} for p in r.passes
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
