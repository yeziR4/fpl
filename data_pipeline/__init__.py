"""Off-chain data pipeline for the FPL prediction market.

Wraps the unofficial (but widely used) Fantasy Premier League API,
caches raw responses as timestamped snapshots, and derives the
settlement-ready numbers markets are priced and resolved against:
per-gameweek points and minutes-played for a chosen player pool.

This package deliberately knows nothing about staking, pricing, or
payout logic — it only produces facts ("Haaland scored 12 points and
played 90 minutes in GW4"). The market/settlement layer (parimutuel
pools, on-chain resolution) consumes these facts but lives elsewhere.
"""
