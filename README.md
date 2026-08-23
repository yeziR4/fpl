# fpl

A prediction market on Fantasy Premier League outcomes — AI models and
humans both able to take positions, settled against real match data,
priced by a parimutuel pool rather than fixed odds. On-chain target is
Vara Network. Full context and open decisions: [`docs/architecture.md`](docs/architecture.md).

This repo currently contains the first building block: an **off-chain
data pipeline** that pulls FPL data, snapshots it locally over time (the
FPL API only exposes current state, so history has to be captured as it
happens), and derives the settlement facts a market needs — for a single
gameweek, whether a player scored 5+/10+ points in that match, and
whether they played the full 90 minutes.

## Quickstart

```bash
pip install -r requirements.txt

# Populate the cache (needs outbound access to fantasy.premierleague.com)
python -m data_pipeline.cli fetch-bootstrap
python -m data_pipeline.cli fetch-live 1

# Read it back
python -m data_pipeline.cli top20
python -m data_pipeline.cli points 1 --gw 1
python -m data_pipeline.cli full90 1 --gw 1
```

## Tests

```bash
pip install -r requirements.txt pytest
pytest
```

Tests run entirely against fixture data in `tests/fixtures/` — no
network access required.

## Layout

```
data_pipeline/    FPL API client, local snapshot cache, market-fact derivation, CLI
tests/            Unit tests + fixture JSON matching the real FPL API shape
docs/             Architecture notes and open decisions
data/cache/       Local snapshot store (gitignored, grows over time)
```

## Status

Early. Market mechanics (bucket design, fees, oracle trust model) and
the on-chain side are not built yet — see `docs/architecture.md` for
what's decided, what's open, and why.
