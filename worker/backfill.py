"""One-shot historical backfill: walks from `backfill_start` to today in monthly chunks."""
from __future__ import annotations

import argparse
import logging
from datetime import datetime, timedelta, timezone

from dateutil.relativedelta import relativedelta

from .config import get_settings
from .ingest import run_window
from .aggregate import rollup_range

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", type=str, default=None)
    ap.add_argument("--end", type=str, default=None)
    args = ap.parse_args()

    settings = get_settings()
    start = datetime.fromisoformat(args.start or settings.backfill_start).replace(tzinfo=timezone.utc)
    end = datetime.fromisoformat(args.end).replace(tzinfo=timezone.utc) if args.end else datetime.now(timezone.utc)

    cursor = start
    while cursor < end:
        nxt = min(cursor + relativedelta(months=1), end)
        run_window(cursor, nxt)
        rollup_range(cursor, nxt)
        cursor = nxt


if __name__ == "__main__":
    main()
