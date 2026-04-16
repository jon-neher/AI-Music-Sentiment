"""APScheduler-based always-on worker. Runs hourly ingest + nightly rollup."""
from __future__ import annotations

import logging

from apscheduler.schedulers.blocking import BlockingScheduler

from .ingest import run_recent
from .aggregate import rollup_recent
from .db import init_db

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("worker.schedule")


def main() -> None:
    init_db()
    log.info("Worker starting; running an initial ingest.")
    try:
        run_recent(hours=6)
        rollup_recent(days=2)
    except Exception:
        log.exception("Initial ingest failed")

    sched = BlockingScheduler(timezone="UTC")
    sched.add_job(lambda: run_recent(hours=2), "cron", minute=7, id="hourly_ingest")
    sched.add_job(lambda: rollup_recent(days=3), "cron", hour=3, minute=0, id="nightly_rollup")
    log.info("Scheduler armed.")
    sched.start()


if __name__ == "__main__":
    main()
