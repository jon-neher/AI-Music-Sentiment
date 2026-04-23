"""GDELT 2.0 DOC API ingest. Category = business. GDELT has built-in tone."""
from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import Iterable

import httpx

from . import RawPost

GDELT_URL = "https://api.gdeltproject.org/api/v2/doc/doc"


def fetch(from_dt: datetime, to_dt: datetime, max_records: int = 250) -> Iterable[RawPost]:
    params = {
        "query": "(\"artificial intelligence\" OR \"machine learning\" OR \"large language model\")",
        "mode": "ArtList",
        "format": "json",
        "startdatetime": from_dt.strftime("%Y%m%d%H%M%S"),
        "enddatetime": to_dt.strftime("%Y%m%d%H%M%S"),
        "maxrecords": max_records,
        "sort": "datedesc",
    }
    r = httpx.get(GDELT_URL, params=params, timeout=45.0, follow_redirects=True)
    if r.status_code != 200:
        return
    try:
        data = r.json()
    except Exception:
        return
    for a in data.get("articles", []):
        try:
            published = datetime.strptime(a["seendate"], "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
        except Exception:
            continue
        url = a.get("url") or ""
        if not url:
            continue
        yield RawPost(
            id=f"gdelt:{hashlib.sha1(url.encode('utf-8')).hexdigest()[:40]}",
            source="gdelt",
            category="business",
            title=a.get("title") or "",
            snippet=a.get("socialimage") or "",
            url=url,
            author=a.get("domain") or "",
            published_at=published,
            reach=0,
            topics=[],
        )
