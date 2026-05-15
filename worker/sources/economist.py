"""The Economist -- Business section RSS, filtered for AI coverage.

Firehose feed (~300 items) so the AI filter does meaningful work.
"""
from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime

from . import RawPost
from ._rss import FeedConfig
from ._rss import fetch as _rss_fetch

_FEED = FeedConfig(
    source="economist",
    category="business",
    url="https://www.economist.com/business/rss.xml",
    filter_ai=True,
)


def fetch(from_dt: datetime, to_dt: datetime) -> Iterable[RawPost]:
    return _rss_fetch(_FEED, from_dt, to_dt)
