"""Ingest runner: pulls from sources, scores, upserts into Postgres."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Iterable, List

from sqlalchemy.dialects.postgresql import insert as pg_insert

from .config import get_settings
from .db import Post, SessionLocal, init_db
from .score import score_batch
from .sources import RawPost
from .sources import hn as hn_source
from .sources import arxiv as arxiv_source
from .sources import gdelt as gdelt_source

log = logging.getLogger(__name__)


def _upsert_posts(raws: List[RawPost]) -> int:
    if not raws:
        return 0
    settings = get_settings()
    texts = [f"{r.title}. {r.snippet}" for r in raws]
    scores = score_batch(texts, settings.sentiment_model, settings.emotion_model)

    rows = []
    for r, (sent, emo) in zip(raws, scores):
        rows.append({
            "id": r.id,
            "source": r.source,
            "category": r.category,
            "title": r.title[:2000],
            "snippet": r.snippet[:2000],
            "url": r.url,
            "author": r.author[:128],
            "published_at": r.published_at.replace(tzinfo=None),
            "sentiment": sent,
            "emotions": emo,
            "topics": r.topics,
            "reach": r.reach,
        })
    with SessionLocal() as s:
        stmt = pg_insert(Post.__table__).values(rows)
        stmt = stmt.on_conflict_do_update(
            index_elements=[Post.__table__.c.id],
            set_={
                "sentiment": stmt.excluded.sentiment,
                "emotions": stmt.excluded.emotions,
                "reach": stmt.excluded.reach,
            },
        )
        s.execute(stmt)
        s.commit()
    return len(rows)


def run_window(from_dt: datetime, to_dt: datetime) -> dict:
    init_db()
    log.info("Ingest %s -> %s", from_dt.isoformat(), to_dt.isoformat())

    totals = {"hn": 0, "arxiv": 0, "gdelt": 0}
    batch: List[RawPost] = []

    def flush():
        nonlocal batch
        if batch:
            _upsert_posts(batch)
            batch = []

    for post in hn_source.fetch(int(from_dt.timestamp()), int(to_dt.timestamp())):
        batch.append(post)
        totals["hn"] += 1
        if len(batch) >= 64:
            flush()
    flush()

    for post in arxiv_source.fetch(from_dt, to_dt):
        batch.append(post)
        totals["arxiv"] += 1
        if len(batch) >= 64:
            flush()
    flush()

    for post in gdelt_source.fetch(from_dt, to_dt):
        batch.append(post)
        totals["gdelt"] += 1
        if len(batch) >= 64:
            flush()
    flush()

    log.info("Ingest complete: %s", totals)
    return totals


def run_recent(hours: int = 2) -> dict:
    now = datetime.now(timezone.utc)
    return run_window(now - timedelta(hours=hours), now)
