"""Fast Company -- Technology RSS, filtered for AI coverage."""
from __future__ import annotations

from datetime import datetime
from typing import Iterable

from . import RawPost
from ._rss import FeedConfig, fetch as _rss_fetch

_FEED = FeedConfig(
    source="fastcompany",
    category="business",
    url="https://www.fastcompany.com/technology/rss",
    filter_ai=True,
)


def fetch(from_dt: datetime, to_dt: datetime) -> Iterable[RawPost]:
    return _rss_fetch(_FEED, from_dt, to_dt)
