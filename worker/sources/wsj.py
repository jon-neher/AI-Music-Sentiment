"""Wall Street Journal -- tech (WSJD) RSS, filtered for AI coverage."""
from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime

from . import RawPost
from ._rss import FeedConfig
from ._rss import fetch as _rss_fetch

_FEED = FeedConfig(
    source="wsj",
    category="business",
    url="https://feeds.content.dowjones.io/public/rss/RSSWSJD",
    filter_ai=True,
)


def fetch(from_dt: datetime, to_dt: datetime) -> Iterable[RawPost]:
    return _rss_fetch(_FEED, from_dt, to_dt)
