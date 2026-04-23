"""CNBC Technology RSS, filtered for AI coverage."""
from __future__ import annotations

from datetime import datetime
from typing import Iterable

from . import RawPost
from ._rss import FeedConfig, fetch as _rss_fetch

_FEED = FeedConfig(
    source="cnbc",
    category="business",
    url="https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=19854910",
    filter_ai=True,
)


def fetch(from_dt: datetime, to_dt: datetime) -> Iterable[RawPost]:
    return _rss_fetch(_FEED, from_dt, to_dt)
