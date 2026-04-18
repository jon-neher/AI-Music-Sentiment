"""Probe the live API for data-health issues.

Exits non-zero (and prints a structured summary) if:
- /api/stats returns fewer than MIN_TOTAL_POSTS rows
- any known category has fewer than MIN_CATEGORY_ROWS rows (catches the
  "only 1 public row" scenario we hit in prod)
- the newest post is older than MAX_STALENESS_HOURS

The script is intentionally dependency-light (httpx only) and safe to run
locally: `PROD_API_BASE=https://api.example.com python scripts/prod_health.py`.
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone

import httpx

EXPECTED_CATEGORIES = ("public", "business", "science")


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        print(f"warn: {name}={raw!r} is not an int, using default {default}", file=sys.stderr)
        return default


def main() -> int:
    base = os.environ.get("PROD_API_BASE", "").rstrip("/")
    if not base:
        print("PROD_API_BASE not set; nothing to probe.")
        return 0

    min_total = _env_int("MIN_TOTAL_POSTS", 1000)
    min_cat = _env_int("MIN_CATEGORY_ROWS", 5)
    max_stale_h = _env_int("MAX_STALENESS_HOURS", 48)

    with httpx.Client(timeout=20.0) as client:
        r = client.get(f"{base}/api/stats")
        r.raise_for_status()
        stats = r.json()

    failures: list[str] = []

    total = int(stats.get("total_posts") or 0)
    if total < min_total:
        failures.append(f"total_posts={total} < MIN_TOTAL_POSTS={min_total}")

    by_cat = stats.get("by_category") or {}
    for cat in EXPECTED_CATEGORIES:
        n = int(by_cat.get(cat) or 0)
        if n < min_cat:
            failures.append(f"by_category[{cat}]={n} < MIN_CATEGORY_ROWS={min_cat}")

    last = stats.get("last_post_at")
    if last:
        try:
            last_dt = datetime.fromisoformat(last.replace("Z", "+00:00"))
        except ValueError:
            failures.append(f"unparseable last_post_at={last!r}")
        else:
            if last_dt.tzinfo is None:
                last_dt = last_dt.replace(tzinfo=timezone.utc)
            age = datetime.now(timezone.utc) - last_dt
            if age > timedelta(hours=max_stale_h):
                failures.append(f"last_post_at age={age} > {max_stale_h}h")
    else:
        failures.append("last_post_at missing from /api/stats")

    print("== prod-health ==")
    print(f"total_posts   = {total}")
    print(f"by_category   = {by_cat}")
    print(f"last_post_at  = {last}")
    if failures:
        print("\nFAIL:")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
