"""Bluesky ingest via the AT Protocol `searchPosts` endpoint.

Bluesky's public AppView gated `searchPosts` behind auth, so we create a
session with an app password and pass the returned JWT as a Bearer token.
If `BLUESKY_IDENTIFIER` / `BLUESKY_APP_PASSWORD` are unset, the source
silently skips (mirrors Reddit / NewsAPI behavior).

Reach = likeCount + repostCount + replyCount.
"""
from __future__ import annotations

import logging
from collections.abc import Iterable
from datetime import UTC, datetime

import httpx

from ..config import get_settings
from . import RawPost

log = logging.getLogger(__name__)

_SESSION_URL = "https://bsky.social/xrpc/com.atproto.server.createSession"
_SEARCH_URL = "https://api.bsky.app/xrpc/app.bsky.feed.searchPosts"
_QUERIES = [
    '"artificial intelligence"',
    '"machine learning"',
    "LLM",
    "ChatGPT",
]
_MAX_PAGES = 10
_PER_QUERY_CAP = 500


def _parse_created(value: str) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt


def _create_session(identifier: str, app_password: str, user_agent: str) -> str | None:
    try:
        r = httpx.post(
            _SESSION_URL,
            json={"identifier": identifier, "password": app_password},
            headers={"User-Agent": user_agent, "Content-Type": "application/json"},
            timeout=20.0,
        )
        r.raise_for_status()
        return r.json().get("accessJwt")
    except Exception:
        log.exception("Bluesky createSession failed")
        return None


def fetch(from_dt: datetime, to_dt: datetime) -> Iterable[RawPost]:
    settings = get_settings()
    if not (settings.bluesky_identifier and settings.bluesky_app_password):
        log.info("Bluesky credentials unset; skipping bluesky.")
        return

    user_agent = settings.reddit_user_agent  # reuse the shared UA string
    jwt = _create_session(settings.bluesky_identifier, settings.bluesky_app_password, user_agent)
    if not jwt:
        return

    since_iso = from_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    until_iso = to_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    headers = {
        "Authorization": f"Bearer {jwt}",
        "User-Agent": user_agent,
    }

    with httpx.Client(timeout=30.0, follow_redirects=True, headers=headers) as client:
        for q in _QUERIES:
            cursor: str | None = None
            count = 0
            for _ in range(_MAX_PAGES):
                if count >= _PER_QUERY_CAP:
                    break
                params = {"q": q, "limit": 100, "since": since_iso, "until": until_iso}
                if cursor:
                    params["cursor"] = cursor
                try:
                    r = client.get(_SEARCH_URL, params=params)
                    r.raise_for_status()
                    data = r.json()
                except Exception:
                    log.exception("Bluesky searchPosts %r failed", q)
                    break
                posts = data.get("posts") or []
                if not posts:
                    break
                for p in posts:
                    uri = p.get("uri") or ""
                    if not uri:
                        continue
                    record = p.get("record") or {}
                    text = (record.get("text") or "").strip()
                    if not text:
                        continue
                    published = _parse_created(record.get("createdAt") or p.get("indexedAt") or "")
                    if not published or published < from_dt or published > to_dt:
                        continue
                    author = ((p.get("author") or {}).get("handle") or "")
                    rkey = uri.rsplit("/", 1)[-1]
                    post_url = (
                        f"https://bsky.app/profile/{author}/post/{rkey}"
                        if author and rkey else ""
                    )
                    yield RawPost(
                        id=f"bluesky:{abs(hash(uri))}",
                        source="bluesky",
                        category="public",
                        title=text[:200],
                        snippet=text[:500],
                        url=post_url,
                        author=author[:128],
                        published_at=published,
                        reach=int(p.get("likeCount") or 0)
                              + int(p.get("repostCount") or 0)
                              + int(p.get("replyCount") or 0),
                        topics=[],
                    )
                    count += 1
                cursor = data.get("cursor")
                if not cursor:
                    break
