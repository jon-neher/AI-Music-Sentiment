"""NewsAPI ingest for the `business` category.

Free tier caveats:
  - Only serves articles from the last ~30 days; older windows are clamped
    (if the clamp leaves no time left, we skip).
  - Returns at most 100 results per query regardless of paging.

Complements GDELT: NewsAPI has curated mainstream outlets with decent titles
and descriptions; GDELT stays the historical workhorse.
"""
from __future__ import annotations

import hashlib
import logging
from collections.abc import Iterable
from datetime import UTC, datetime, timedelta

import httpx

from ..config import get_settings
from . import RawPost

log = logging.getLogger(__name__)

_URL = "https://newsapi.org/v2/everything"
_MAX_DAYS = 30
_QUERY = '("artificial intelligence" OR "machine learning" OR LLM OR "large language model" OR "generative AI")'
# Outlets we ingest directly via dedicated RSS sources; excluding them here
# avoids double-counting the same article in aggregate volume metrics and
# spares free-tier quota from being spent on dupes.
_EXCLUDE_DOMAINS = ",".join([
    "theverge.com",
    "arstechnica.com",
    "techcrunch.com",
    "technologyreview.com",
    "wired.com",
    "404media.co",
    "bloomberg.com",
    "wsj.com",
    "cnbc.com",
    "economist.com",
    "fastcompany.com",
])


def fetch(from_dt: datetime, to_dt: datetime) -> Iterable[RawPost]:
    settings = get_settings()
    if not settings.newsapi_key:
        log.info("NEWSAPI_KEY unset; skipping newsapi.")
        return

    now = datetime.now(UTC)
    cutoff = now - timedelta(days=_MAX_DAYS - 1)
    effective_from = max(from_dt, cutoff)
    if effective_from >= to_dt:
        log.info("NewsAPI window outside 30-day free-tier range; skipping.")
        return

    headers = {"X-Api-Key": settings.newsapi_key}
    for page in range(1, 6):
        params = {
            "q": _QUERY,
            "from": effective_from.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "to": to_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "sortBy": "publishedAt",
            "pageSize": 100,
            "language": "en",
            "page": page,
            "excludeDomains": _EXCLUDE_DOMAINS,
        }
        try:
            r = httpx.get(_URL, params=params, headers=headers, timeout=30.0, follow_redirects=True)
            r.raise_for_status()
            data = r.json()
        except Exception:
            log.exception("NewsAPI page %d failed", page)
            return
        articles = data.get("articles") or []
        if not articles:
            return
        for a in articles:
            url = a.get("url") or ""
            if not url:
                continue
            try:
                published = datetime.strptime(a.get("publishedAt") or "", "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=UTC)
            except ValueError:
                continue
            yield RawPost(
                id=f"newsapi:{hashlib.sha1(url.encode('utf-8')).hexdigest()[:40]}",
                source="newsapi",
                category="business",
                title=(a.get("title") or "").strip(),
                snippet=(a.get("description") or "").strip()[:500],
                url=url,
                author=((a.get("source") or {}).get("name") or "")[:128],
                published_at=published,
                reach=0,
                topics=[],
            )
        total = data.get("totalResults") or 0
        if page * 100 >= min(total, 100):
            return
