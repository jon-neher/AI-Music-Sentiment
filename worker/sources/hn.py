"""Hacker News ingest via Algolia public API. Covers 2007->present."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Iterable, List

import httpx

from ..config import get_settings
from . import RawPost

ALGOLIA_URL = "https://hn.algolia.com/api/v1/search_by_date"


def _matches(text: str, keywords: List[str]) -> bool:
    t = (text or "").lower()
    return any(k in t for k in keywords)


def fetch(from_ts: int, to_ts: int, max_pages: int = 50) -> Iterable[RawPost]:
    settings = get_settings()
    keywords = settings.keywords
    query = "AI OR \"artificial intelligence\" OR \"machine learning\" OR LLM OR GPT"

    with httpx.Client(timeout=30.0, follow_redirects=True) as client:
        for page in range(max_pages):
            params = {
                "query": query,
                "tags": "story",
                "numericFilters": f"created_at_i>={from_ts},created_at_i<{to_ts}",
                "hitsPerPage": 100,
                "page": page,
            }
            r = client.get(ALGOLIA_URL, params=params)
            r.raise_for_status()
            data = r.json()
            hits = data.get("hits", [])
            if not hits:
                break
            for h in hits:
                title = h.get("title") or h.get("story_title") or ""
                if not title:
                    continue
                if not _matches(title, keywords):
                    continue
                ts = h.get("created_at_i")
                if ts is None:
                    continue
                url = h.get("url") or f"https://news.ycombinator.com/item?id={h.get('objectID')}"
                yield RawPost(
                    id=f"hn:{h['objectID']}",
                    source="hn",
                    category="public",
                    title=title,
                    snippet=(h.get("story_text") or "")[:500],
                    url=url,
                    author=h.get("author") or "",
                    published_at=datetime.fromtimestamp(ts, tz=timezone.utc),
                    reach=int(h.get("points") or 0),
                    topics=[],
                )
            if data.get("nbPages", 0) <= page + 1:
                break
