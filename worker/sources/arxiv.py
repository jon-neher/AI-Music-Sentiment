"""arXiv ingest via the public export API. Category = science."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Iterable
from urllib.parse import urlencode

import httpx
import feedparser

from . import RawPost

ARXIV_URL = "http://export.arxiv.org/api/query?"


def fetch(from_dt: datetime, to_dt: datetime, max_results_per_page: int = 200) -> Iterable[RawPost]:
    categories = ["cs.AI", "cs.CL", "cs.LG", "cs.NE", "stat.ML"]
    search = " OR ".join(f"cat:{c}" for c in categories)

    start = 0
    while True:
        q = urlencode({
            "search_query": search,
            "start": start,
            "max_results": max_results_per_page,
            "sortBy": "submittedDate",
            "sortOrder": "descending",
        })
        r = httpx.get(ARXIV_URL + q, timeout=60.0)
        r.raise_for_status()
        feed = feedparser.parse(r.text)
        if not feed.entries:
            break
        out_of_range = False
        for e in feed.entries:
            try:
                published = datetime(*e.published_parsed[:6], tzinfo=timezone.utc)
            except Exception:
                continue
            if published < from_dt:
                out_of_range = True
                continue
            if published > to_dt:
                continue
            arxiv_id = e.id.rsplit("/", 1)[-1]
            yield RawPost(
                id=f"arxiv:{arxiv_id}",
                source="arxiv",
                category="science",
                title=(e.title or "").replace("\n", " ").strip(),
                snippet=(e.summary or "").replace("\n", " ").strip()[:500],
                url=e.link,
                author=", ".join(a.name for a in getattr(e, "authors", [])[:4]),
                published_at=published,
                reach=0,
                topics=[t.term for t in getattr(e, "tags", []) if getattr(t, "term", None)],
            )
        if out_of_range or len(feed.entries) < max_results_per_page:
            break
        start += max_results_per_page
