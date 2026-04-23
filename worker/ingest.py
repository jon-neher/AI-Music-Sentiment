"""Ingest runner: pulls from sources, scores, upserts into Postgres."""
from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from typing import Callable, Iterable, List

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from .config import get_settings
from .db import Post, SessionLocal, init_db
from .score import score_batch
from .sources import RawPost
from .sources import hn as hn_source
from .sources import arxiv as arxiv_source
from .sources import gdelt as gdelt_source
from .sources import reddit as reddit_source
from .sources import newsapi as newsapi_source
from .sources import semanticscholar as ss_source
from .sources import bluesky as bluesky_source
from .sources import theverge as theverge_source
from .sources import arstechnica as arstechnica_source
from .sources import techcrunch as techcrunch_source
from .sources import mittr as mittr_source
from .sources import wired as wired_source
from .sources import media404 as media404_source
from .sources import bloomberg as bloomberg_source
from .sources import wsj as wsj_source
from .sources import cnbc as cnbc_source
from .sources import economist as economist_source
from .sources import fastcompany as fastcompany_source

log = logging.getLogger(__name__)


def _row(r: RawPost, sent: float, emo: dict) -> dict:
    return {
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
    }


def _upsert_posts(raws: List[RawPost]) -> int:
    """Upsert posts, only scoring ones that don't yet exist.

    Sentiment/emotion scoring is the hot path (torch inference); a full
    backfill covers hundreds of thousands of posts. We query for which IDs
    are already in the DB and skip scoring those, which makes re-runs and
    overlapping windows effectively free. For known posts we still issue
    the upsert so mutable fields (``reach``) stay fresh.
    """
    if not raws:
        return 0
    settings = get_settings()

    ids = [r.id for r in raws]
    with SessionLocal() as s:
        existing = set(s.scalars(
            select(Post.__table__.c.id).where(Post.__table__.c.id.in_(ids))
        ).all())

    new_raws = [r for r in raws if r.id not in existing]
    known_raws = [r for r in raws if r.id in existing]

    rows: list[dict] = []
    if new_raws:
        texts = [f"{r.title}. {r.snippet}" for r in new_raws]
        scores = score_batch(texts, settings.sentiment_model, settings.emotion_model)
        for r, (sent, emo) in zip(new_raws, scores):
            rows.append(_row(r, sent, emo))
    # Known posts: dummy sentiment/emotions; the ON CONFLICT clause below only
    # refreshes ``reach``, so the original scores are preserved.
    for r in known_raws:
        rows.append(_row(r, 0.0, {}))

    if not rows:
        return 0

    with SessionLocal() as s:
        stmt = pg_insert(Post.__table__).values(rows)
        stmt = stmt.on_conflict_do_update(
            index_elements=[Post.__table__.c.id],
            set_={"reach": stmt.excluded.reach},
        )
        s.execute(stmt)
        s.commit()
    return len(rows)


def run_window(from_dt: datetime, to_dt: datetime) -> dict:
    init_db()
    log.info("Ingest %s -> %s", from_dt.isoformat(), to_dt.isoformat())

    from_ts = int(from_dt.timestamp())
    to_ts = int(to_dt.timestamp())

    sources: List[tuple[str, Callable[[], Iterable[RawPost]]]] = [
        ("hn",              lambda: hn_source.fetch(from_ts, to_ts)),
        ("arxiv",           lambda: arxiv_source.fetch(from_dt, to_dt)),
        ("gdelt",           lambda: gdelt_source.fetch(from_dt, to_dt)),
        ("reddit",          lambda: reddit_source.fetch(from_ts, to_ts)),
        ("newsapi",         lambda: newsapi_source.fetch(from_dt, to_dt)),
        ("semanticscholar", lambda: ss_source.fetch(from_dt, to_dt)),
        ("bluesky",         lambda: bluesky_source.fetch(from_dt, to_dt)),
        ("theverge",        lambda: theverge_source.fetch(from_dt, to_dt)),
        ("arstechnica",     lambda: arstechnica_source.fetch(from_dt, to_dt)),
        ("techcrunch",      lambda: techcrunch_source.fetch(from_dt, to_dt)),
        ("mittr",           lambda: mittr_source.fetch(from_dt, to_dt)),
        ("wired",           lambda: wired_source.fetch(from_dt, to_dt)),
        ("media404",        lambda: media404_source.fetch(from_dt, to_dt)),
        ("bloomberg",       lambda: bloomberg_source.fetch(from_dt, to_dt)),
        ("wsj",             lambda: wsj_source.fetch(from_dt, to_dt)),
        ("cnbc",            lambda: cnbc_source.fetch(from_dt, to_dt)),
        ("economist",       lambda: economist_source.fetch(from_dt, to_dt)),
        ("fastcompany",     lambda: fastcompany_source.fetch(from_dt, to_dt)),
    ]

    totals: dict = {name: 0 for name, _ in sources}

    def _collect(name: str, factory: Callable[[], Iterable[RawPost]]) -> tuple[str, list[RawPost]]:
        """Run a source to completion into a list. Per-source try/except so
        one flaky source can't abort the whole ingest."""
        collected: list[RawPost] = []
        try:
            for post in factory():
                collected.append(post)
        except Exception:
            log.exception("Source %s aborted; continuing with remaining sources.", name)
        return name, collected

    # Fetch all sources in parallel. Work is network-bound (httpx + feedparser);
    # threads sidestep the GIL well enough for this IO profile. Keep worker
    # count modest to avoid spamming remote endpoints from a single pod.
    all_posts: list[RawPost] = []
    with ThreadPoolExecutor(max_workers=min(8, len(sources))) as pool:
        futs = [pool.submit(_collect, name, factory) for name, factory in sources]
        for fut in as_completed(futs):
            name, posts = fut.result()
            totals[name] = len(posts)
            all_posts.extend(posts)

    # Score + upsert sequentially in the existing batch size. Scoring holds
    # the torch pipeline; parallelism there would contend on the model.
    for i in range(0, len(all_posts), 64):
        _upsert_posts(all_posts[i:i + 64])

    log.info("Ingest complete: %s", totals)
    return totals


def run_recent(hours: int = 2) -> dict:
    now = datetime.now(timezone.utc)
    return run_window(now - timedelta(hours=hours), now)
