"""Semantic Scholar ingest. Complements arXiv by supplying citation-weighted reach.

No API key required; rate limit is modest (100 req / 5 min unauthenticated),
so we sleep between paged requests and back off on 429.
"""
from __future__ import annotations

import logging
import time
from collections.abc import Iterable
from datetime import UTC, datetime

import httpx

from . import RawPost

log = logging.getLogger(__name__)

_URL = "https://api.semanticscholar.org/graph/v1/paper/search"
_FIELDS = "paperId,title,abstract,url,publicationDate,citationCount,venue,authors"
_QUERIES = [
    "artificial intelligence",
    "machine learning",
    "large language model",
    "deep learning",
]
_PAGE_LIMIT = 100
_MAX_PAGES = 5
_POLITENESS_SLEEP_S = 3.0


def fetch(from_dt: datetime, to_dt: datetime) -> Iterable[RawPost]:
    year_range = f"{from_dt.year}-{to_dt.year}"
    for q in _QUERIES:
        offset = 0
        for _ in range(_MAX_PAGES):
            params = {
                "query": q,
                "offset": offset,
                "limit": _PAGE_LIMIT,
                "year": year_range,
                "fields": _FIELDS,
            }
            try:
                r = httpx.get(_URL, params=params, timeout=45.0, follow_redirects=True)
                if r.status_code == 429:
                    time.sleep(5.0)
                    continue
                r.raise_for_status()
                data = r.json()
            except Exception:
                log.exception("Semantic Scholar query %r offset %d failed", q, offset)
                break
            items = data.get("data") or []
            if not items:
                break
            for p in items:
                pid = p.get("paperId")
                if not pid:
                    continue
                pub_str = p.get("publicationDate")
                if not pub_str:
                    continue
                try:
                    published = datetime.strptime(pub_str, "%Y-%m-%d").replace(tzinfo=UTC)
                except ValueError:
                    continue
                if published < from_dt or published > to_dt:
                    continue
                authors = p.get("authors") or []
                venue = p.get("venue") or ""
                yield RawPost(
                    id=f"ss:{pid}",
                    source="semanticscholar",
                    category="science",
                    title=(p.get("title") or "").strip(),
                    snippet=((p.get("abstract") or "").replace("\n", " ")).strip()[:500],
                    url=p.get("url") or "",
                    author=", ".join((a.get("name") or "") for a in authors[:4])[:128],
                    published_at=published,
                    reach=int(p.get("citationCount") or 0),
                    topics=[venue] if venue else [],
                )
            total = data.get("total") or 0
            offset += _PAGE_LIMIT
            if offset >= total:
                break
            time.sleep(_POLITENESS_SLEEP_S)
