"""Shared Atom/RSS ingest helper.

Outlet modules build a ``FeedConfig`` and delegate to ``fetch`` here. Handles
HTML cleanup, stable SHA-1 IDs from article URL, optional AI keyword filter
for firehose feeds, and published-time window clamping.
"""
from __future__ import annotations

import hashlib
import html
import logging
import re
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import feedparser
import httpx

from ..config import get_settings
from . import RawPost

log = logging.getLogger(__name__)

_UA = "ai-music-sentiment/0.1 (+github.com/jon-neher/AI-Music-Sentiment)"
_TAG_RE = re.compile(r"<[^>]+>")
# RSS feeds only serve recent items; skip requests for windows that end before
# this cutoff to avoid ~1,500 wasted fetches during a multi-year backfill.
_HISTORICAL_CUTOFF = timedelta(days=7)

# In-process cache of ETag / Last-Modified per feed URL. Lets us issue
# conditional GETs that return 304 Not Modified when a feed is unchanged --
# which is the common case on the hourly cron. Reset on every worker restart.
_FEED_CACHE: dict[str, dict[str, str]] = {}


@dataclass(frozen=True)
class FeedConfig:
    source: str        # matches RawPost.source; keep short (<=32 chars)
    category: str      # "business" | "public" | "science"
    url: str
    # True when the feed is a general firehose; we keyword-filter with
    # Settings.keywords to keep only AI-relevant items.
    filter_ai: bool = False


def _clean(text: str) -> str:
    return html.unescape(_TAG_RE.sub(" ", text or "")).strip()


def _matches(text: str, keywords: list[str]) -> bool:
    t = (text or "").lower()
    return any(k in t for k in keywords)


def fetch(cfg: FeedConfig, from_dt: datetime, to_dt: datetime) -> Iterable[RawPost]:
    if to_dt < datetime.now(UTC) - _HISTORICAL_CUTOFF:
        log.debug("%s: window ends %s, older than RSS horizon; skipping.",
                  cfg.source, to_dt.date())
        return

    headers = {"User-Agent": _UA}
    cached = _FEED_CACHE.get(cfg.url, {})
    if cached.get("etag"):
        headers["If-None-Match"] = cached["etag"]
    if cached.get("last_modified"):
        headers["If-Modified-Since"] = cached["last_modified"]

    try:
        r = httpx.get(cfg.url, headers=headers, timeout=30.0, follow_redirects=True)
    except Exception:
        log.exception("%s RSS fetch failed", cfg.source)
        return
    if r.status_code == 304:
        log.debug("%s: 304 Not Modified; skipping parse", cfg.source)
        return
    try:
        r.raise_for_status()
    except Exception:
        log.exception("%s RSS fetch failed (status %s)", cfg.source, r.status_code)
        return

    # Cache validators for the next run. Publishers vary in which they emit;
    # we store whichever are present.
    new_cache: dict[str, str] = {}
    if etag := r.headers.get("etag"):
        new_cache["etag"] = etag
    if lm := r.headers.get("last-modified"):
        new_cache["last_modified"] = lm
    if new_cache:
        _FEED_CACHE[cfg.url] = new_cache

    feed = feedparser.parse(r.text)
    keywords = get_settings().keywords if cfg.filter_ai else []

    for e in feed.entries:
        dt_tuple = e.get("published_parsed") or e.get("updated_parsed")
        if not dt_tuple:
            continue
        try:
            published = datetime(*dt_tuple[:6], tzinfo=UTC)
        except Exception:
            continue
        if published < from_dt or published > to_dt:
            continue

        url = (e.get("link") or "").strip()
        if not url:
            continue

        title = _clean(e.get("title", ""))
        if not title:
            continue
        snippet = _clean(e.get("summary", ""))[:500]

        if cfg.filter_ai and not _matches(f"{title} {snippet}", keywords):
            continue

        authors = e.get("authors") or []
        author = ", ".join(
            a.get("name", "") for a in authors if isinstance(a, dict) and a.get("name")
        )[:128]
        if not author:
            author = (e.get("author", "") or "")[:128]

        digest = hashlib.sha1(url.encode("utf-8")).hexdigest()[:40]
        yield RawPost(
            id=f"{cfg.source}:{digest}",
            source=cfg.source,
            category=cfg.category,
            title=title,
            snippet=snippet,
            url=url,
            author=author,
            published_at=published,
            reach=0,
            topics=[t.term for t in (e.get("tags") or []) if getattr(t, "term", None)],
        )
