"""APScheduler-based always-on worker.

Cadence:
  - every 4h: ingest (5h window, 1h overlap) + light same-day rollup so the
    constellation reflects the current day as it unfolds
  - nightly: full 3-day rollup to settle late-arriving posts and reach churn

Hourly was overkill for this project -- the sonification reads daily
aggregates, which compress sub-daily variance anyway. 4h keeps <4h latency
from breaking news to constellation while cutting worker load ~75%%.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from apscheduler.schedulers.blocking import BlockingScheduler
from sqlalchemy import func, select

from .aggregate import rollup_recent
from .backfill import run_backfill
from .config import get_settings
from .db import Post, SessionLocal, init_db
from .ingest import run_recent

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("worker.schedule")

# Tolerance for the tail-gap check: if the newest post is within this window of
# "now", the scheduled cron is expected to fill the remainder; don't step on it.
_TAIL_TOLERANCE = timedelta(hours=5)
# Tolerance for the head-gap check: if the oldest post is within this window of
# the configured backfill_start, treat the head as fully covered.
_HEAD_TOLERANCE = timedelta(days=1)


def _ensure_utc(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _plan_backfill_windows() -> list[tuple[datetime, datetime]]:
    """Inspect the posts table and return the (start, end) windows still missing.

    - Empty DB -> one window from configured_start to now.
    - Populated DB -> up to two windows: a head gap (configured_start .. min)
      and/or a tail gap (max .. now). Returns [] when fully covered.
    """
    settings = get_settings()
    configured_start = datetime.fromisoformat(settings.backfill_start).replace(tzinfo=timezone.utc)
    now = datetime.now(timezone.utc)

    with SessionLocal() as s:
        row = s.execute(
            select(func.min(Post.published_at), func.max(Post.published_at), func.count(Post.id))
        ).first()
    first, last, total = (row or (None, None, 0))

    if not total:
        return [(configured_start, now)]

    first = _ensure_utc(first)
    last = _ensure_utc(last)

    windows: list[tuple[datetime, datetime]] = []
    if first > configured_start + _HEAD_TOLERANCE:
        windows.append((configured_start, first))
    if last < now - _TAIL_TOLERANCE:
        windows.append((last, now))
    return windows


def _maybe_backfill() -> None:
    windows = _plan_backfill_windows()
    if not windows:
        log.info("Backfill: no gaps detected; scheduler will arm immediately.")
        return
    for start, end in windows:
        log.info("Backfill: filling gap %s -> %s", start.date(), end.date())
        try:
            run_backfill(start, end)
        except Exception:
            log.exception("Backfill window %s-%s failed; continuing.", start.date(), end.date())


def main() -> None:
    init_db()
    log.info("Worker starting; running an initial ingest.")
    try:
        # Startup catch-up matches the scheduled ingest window below so the
        # first cron pass isn't re-doing work. _plan_backfill_windows
        # handles any gap larger than _TAIL_TOLERANCE.
        run_recent(hours=5)
        rollup_recent(days=2)
    except Exception:
        log.exception("Initial ingest failed")

    _maybe_backfill()

    sched = BlockingScheduler(timezone="UTC")
    # Every 4 hours at :07 -- ingest a 5h window (1h overlap for safety).
    sched.add_job(
        lambda: run_recent(hours=5),
        "cron", hour="*/4", minute=7, id="ingest",
    )
    # Same-day rollup immediately after each ingest so the constellation
    # reflects today's sentiment continuously rather than waiting for 3 AM.
    sched.add_job(
        lambda: rollup_recent(days=1),
        "cron", hour="*/4", minute=17, id="today_rollup",
    )
    # Nightly 3-day rollup settles late-arriving posts and reach churn.
    sched.add_job(
        lambda: rollup_recent(days=3),
        "cron", hour=3, minute=0, id="nightly_rollup",
    )
    log.info("Scheduler armed.")
    sched.start()


if __name__ == "__main__":
    main()
