"""One-shot historical backfill: walks from `backfill_start` to today in monthly chunks."""
from __future__ import annotations

import argparse
import logging
from datetime import datetime, timezone

from dateutil.relativedelta import relativedelta

from .aggregate import rollup_range
from .config import get_settings
from .ingest import run_window

log = logging.getLogger(__name__)


def run_backfill(start: datetime, end: datetime) -> None:
    """Walk [start, end) in month-sized chunks, ingesting then rolling up.

    Chunks that raise are logged and skipped so a flaky source can't abort the
    whole run. Upserts in `_upsert_posts` make re-runs idempotent.
    """
    cursor = start
    while cursor < end:
        nxt = min(cursor + relativedelta(months=1), end)
        try:
            run_window(cursor, nxt)
            rollup_range(cursor, nxt)
        except Exception:
            log.exception("Backfill chunk %s-%s failed; continuing.", cursor.date(), nxt.date())
        cursor = nxt


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", type=str, default=None)
    ap.add_argument("--end", type=str, default=None)
    args = ap.parse_args()

    settings = get_settings()
    start = datetime.fromisoformat(args.start or settings.backfill_start).replace(tzinfo=timezone.utc)
    end = datetime.fromisoformat(args.end).replace(tzinfo=timezone.utc) if args.end else datetime.now(timezone.utc)
    run_backfill(start, end)


if __name__ == "__main__":
    main()
