"""APScheduler-based always-on worker. Runs hourly ingest + nightly rollup."""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from apscheduler.schedulers.blocking import BlockingScheduler
from sqlalchemy import func, select

from .ingest import run_recent
from .aggregate import rollup_recent
from .backfill import run_backfill
from .config import get_settings
from .db import Post, SessionLocal, init_db

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("worker.schedule")

# A fresh deploy starts with 0 rows; anything below this triggers a one-shot
# historical backfill so the UI isn't blank while the hourly cron slowly fills
# in. Upserts make the backfill idempotent across restarts.
_BACKFILL_THRESHOLD = 100


def _maybe_backfill() -> None:
    with SessionLocal() as s:
        n = s.scalar(select(func.count(Post.id))) or 0
    if n >= _BACKFILL_THRESHOLD:
        log.info("Skipping backfill (%d posts already present).", n)
        return

    settings = get_settings()
    start = datetime.fromisoformat(settings.backfill_start).replace(tzinfo=timezone.utc)
    end = datetime.now(timezone.utc)
    log.info("Posts table nearly empty (%d rows); backfilling %s -> %s", n, start.date(), end.date())
    try:
        run_backfill(start, end)
    except Exception:
        log.exception("Auto-backfill failed; scheduler will still arm.")


def main() -> None:
    init_db()
    log.info("Worker starting; running an initial ingest.")
    try:
        run_recent(hours=6)
        rollup_recent(days=2)
    except Exception:
        log.exception("Initial ingest failed")

    _maybe_backfill()

    sched = BlockingScheduler(timezone="UTC")
    sched.add_job(lambda: run_recent(hours=2), "cron", minute=7, id="hourly_ingest")
    sched.add_job(lambda: rollup_recent(days=3), "cron", hour=3, minute=0, id="nightly_rollup")
    log.info("Scheduler armed.")
    sched.start()


if __name__ == "__main__":
    main()
