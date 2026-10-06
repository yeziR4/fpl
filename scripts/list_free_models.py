#!/usr/bin/env python3
"""List the `:free` models OpenRouter is currently serving.

OpenRouter rotates and retires free slugs without notice, so reading a
hardcoded list is how you get a silent break three days into a sprint. This
reads the live catalog instead.

    python scripts/list_free_models.py

No API key needed -- /api/v1/models is public.
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request

MODELS_URL = "https://openrouter.ai/api/v1/models"


def main() -> int:
    try:
        with urllib.request.urlopen(MODELS_URL, timeout=40) as resp:
            payload = json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        print("HTTP %s from %s" % (exc.code, MODELS_URL))
        return 1
    except Exception as exc:  # noqa: BLE001
        print("could not reach OpenRouter: %r" % exc)
        return 1

    models = payload.get("data", payload if isinstance(payload, list) else [])
    free = [
        m
        for m in models
        if isinstance(m, dict) and str(m.get("id", "")).endswith(":free")
    ]
    free.sort(key=lambda m: str(m.get("id", "")))

    if not free:
        print("No ':free' models in the catalog right now.")
        return 0

    print("%d free models currently available:\n" % len(free))
    for m in free:
        mid = m.get("id", "?")
        name = m.get("name", "")
        ctx = m.get("context_length")
        print("  %-58s %s" % (mid, ("ctx=%s" % ctx) if ctx else ""))
        if name and name != mid:
            print("  %-58s %s" % ("", name))

    print(
        "\nUse one or more, comma-separated, with '|' before the display label:\n"
        '  $env:AGENT_MODELS = "%s|Free model A,%s|Free model B"\n'
        % (free[0].get("id"), free[min(1, len(free) - 1)].get("id"))
    )
    print("Or write them to data/agent_models.json as:")
    print('  [{"slug": "%s", "name": "Free model A"}]' % free[0].get("id"))
    print("\nNote: the pitch hook is 'humans vs FRONTIER AI'. A free-tier list")
    print("weakens that claim -- decide the production list before the demo.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
