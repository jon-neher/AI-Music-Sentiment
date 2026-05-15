"""TechCrunch -- AI category RSS."""
from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime

from . import RawPost
from ._rss import FeedConfig
from ._rss import fetch as _rss_fetch

_FEED = FeedConfig(
    source="techcrunch",
    category="business",
    url="https://techcrunch.com/category/artificial-intelligence/feed/",
)


def fetch(from_dt: datetime, to_dt: datetime) -> Iterable[RawPost]:
    return _rss_fetch(_FEED, from_dt, to_dt)
