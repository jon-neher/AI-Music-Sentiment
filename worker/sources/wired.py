"""Wired -- AI tag RSS."""
from __future__ import annotations

from datetime import datetime
from typing import Iterable

from . import RawPost
from ._rss import FeedConfig, fetch as _rss_fetch

_FEED = FeedConfig(
    source="wired",
    category="business",
    url="https://www.wired.com/feed/tag/ai/latest/rss",
)


def fetch(from_dt: datetime, to_dt: datetime) -> Iterable[RawPost]:
    return _rss_fetch(_FEED, from_dt, to_dt)
