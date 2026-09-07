"""Live VARA -> USD price, fetched once per pipeline run and used to
size each AI model's fixed-dollar gameweek bankroll (see oddsmaker.py's
bet sizing). The Python-side counterpart to
web/src/lib/vara/price.ts -- same CoinGecko endpoint, same coin id.

Unlike the frontend (which fails soft to VARA-only display on any
error -- "never show a number nothing backs" is fine there, nothing
downstream depends on it), pick generation needs *some* real VARA
figure to actually stake every run: a fetch failure here falls back to
a documented last-confirmed real price rather than blocking every
model's bet record on one flaky HTTP call.
"""

from __future__ import annotations

import requests

COINGECKO_SIMPLE_PRICE_URL = "https://api.coingecko.com/api/v3/simple/price?ids=vara-network&vs_currencies=usd"
DEFAULT_TIMEOUT = 15

# Last confirmed real price (checked against Coinbase/CoinMarketCap,
# 2026-09-07) -- used ONLY if the live CoinGecko fetch below fails.
# Stale but still the right order of magnitude beats blocking pick
# generation entirely on one bad request; worth refreshing this
# constant occasionally, not something to lean on as the real price.
FALLBACK_VARA_USD_PRICE = 0.00042


def fetch_vara_usd_price(*, session: requests.Session | None = None) -> float:
    """USD price of 1 VARA -- live from CoinGecko, or
    FALLBACK_VARA_USD_PRICE if that fetch fails for any reason
    (network, rate limit, malformed response, a missing or
    non-positive price)."""
    http = session or requests
    try:
        response = http.get(COINGECKO_SIMPLE_PRICE_URL, timeout=DEFAULT_TIMEOUT)
        response.raise_for_status()
        price = response.json()["vara-network"]["usd"]
        if isinstance(price, (int, float)) and not isinstance(price, bool) and price > 0:
            return float(price)
    except (requests.RequestException, ValueError, KeyError, TypeError):
        pass
    return FALLBACK_VARA_USD_PRICE
