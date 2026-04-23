"""Reddit ingest via OAuth2 client-credentials.

Two sub lists:
  - `reddit_subs_ai`: on-topic by construction; pulled unfiltered.
  - `reddit_subs_general`: high-traffic general subs; filtered against
    `settings.keywords` so we only capture AI-in-the-news-cycle posts.

For every matched submission we additionally fetch top-level comments so the
sentiment layer has both the framing (submission) and the reaction (comments).

r/Economics and r/business are mapped to the `business` category; all others
are `public`.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Iterable, Optional

import httpx

from ..config import get_settings
from . import RawPost

log = logging.getLogger(__name__)

_OAUTH_URL = "https://www.reddit.com/api/v1/access_token"
_API_BASE = "https://oauth.reddit.com"
_BUSINESS_SUBS = {"economics", "business"}
_LISTING_PAGE_CAP = 10
# Top-20 comments preserve ~95%% of the reaction-sentiment signal at 40%% of
# the comment-scoring cost versus the prior limit of 50.
_COMMENT_LIMIT = 20
# When a listing page returns no new submissions for this many pages in a row,
# stop paginating -- the rest of the page history is already ingested.
_KNOWN_PAGE_STREAK = 2


def _matches(text: str, keywords: list[str]) -> bool:
    t = (text or "").lower()
    return any(k in t for k in keywords)


def _category_for(sub: str) -> str:
    return "business" if sub.lower() in _BUSINESS_SUBS else "public"


def _get_token(client_id: str, client_secret: str, user_agent: str) -> Optional[str]:
    try:
        r = httpx.post(
            _OAUTH_URL,
            data={"grant_type": "client_credentials"},
            auth=(client_id, client_secret),
            headers={"User-Agent": user_agent},
            timeout=20.0,
        )
        r.raise_for_status()
        return r.json().get("access_token")
    except Exception:
        log.exception("Reddit token fetch failed")
        return None


def _emit_submission(d: dict, sub: str) -> Optional[RawPost]:
    sub_id = d.get("id")
    if not sub_id:
        return None
    created = int(d.get("created_utc") or 0)
    if created <= 0:
        return None
    title = (d.get("title") or "").strip()
    body = d.get("selftext") or ""
    return RawPost(
        id=f"reddit:sub:{sub_id}",
        source="reddit",
        category=_category_for(sub),
        title=title,
        snippet=body[:500],
        url="https://reddit.com" + (d.get("permalink") or ""),
        author=d.get("author") or "",
        published_at=datetime.fromtimestamp(created, tz=timezone.utc),
        reach=int(d.get("ups") or 0) + int(d.get("num_comments") or 0),
        topics=[sub],
    )


def _iter_comments(
    client: httpx.Client, submission_id: str, parent_title: str, sub: str,
    from_ts: int, to_ts: int,
) -> Iterable[RawPost]:
    try:
        r = client.get(f"/comments/{submission_id}", params={"depth": 1, "limit": _COMMENT_LIMIT})
        r.raise_for_status()
        data = r.json()
    except Exception:
        log.warning("Reddit comments fetch failed for %s", submission_id, exc_info=True)
        return
    if not isinstance(data, list) or len(data) < 2:
        return
    children = (data[1].get("data") or {}).get("children") or []
    for ch in children:
        if ch.get("kind") != "t1":
            continue
        cd = ch.get("data") or {}
        created = int(cd.get("created_utc") or 0)
        if created < from_ts or created > to_ts:
            continue
        body = cd.get("body") or ""
        author = cd.get("author") or ""
        if not body or author == "[deleted]":
            continue
        cid = cd.get("id")
        if not cid:
            continue
        yield RawPost(
            id=f"reddit:cmt:{cid}",
            source="reddit",
            category=_category_for(sub),
            title=f"re: {parent_title}"[:200],
            snippet=body[:500],
            url="https://reddit.com" + (cd.get("permalink") or ""),
            author=author,
            published_at=datetime.fromtimestamp(created, tz=timezone.utc),
            reach=int(cd.get("score") or 0),
            topics=[sub],
        )


def _known_submission_ids(ids: list[str]) -> set[str]:
    """Return the subset of submission post-IDs already stored in `posts`.

    Used to skip comment fetches for submissions we've seen before. Degrades
    gracefully: on any DB error we return an empty set, which falls back to
    the prior behavior (always fetch comments) rather than missing data.
    """
    if not ids:
        return set()
    try:
        from sqlalchemy import select
        from ..db import Post, SessionLocal
        with SessionLocal() as s:
            return set(s.scalars(
                select(Post.__table__.c.id).where(Post.__table__.c.id.in_(ids))
            ).all())
    except Exception:
        log.warning("Reddit: known-id DB probe failed; falling back to full fetch",
                    exc_info=True)
        return set()


def _walk_sub(
    client: httpx.Client, sub: str, keyword_filter: bool,
    keywords: list[str], from_ts: int, to_ts: int,
) -> Iterable[RawPost]:
    after: Optional[str] = None
    all_known_streak = 0
    for _ in range(_LISTING_PAGE_CAP):
        params: dict = {"limit": 100}
        if after:
            params["after"] = after
        try:
            r = client.get(f"/r/{sub}/new", params=params)
            r.raise_for_status()
            data = r.json()
        except Exception:
            log.exception("Reddit listing failed for r/%s", sub)
            return
        children = (data.get("data") or {}).get("children") or []
        if not children:
            return
        crossed_window = False
        page_posts: list[tuple[dict, RawPost]] = []
        for ch in children:
            d = ch.get("data") or {}
            created = int(d.get("created_utc") or 0)
            if created and created < from_ts:
                crossed_window = True
                continue
            if created and created > to_ts:
                continue
            title = (d.get("title") or "")
            body = d.get("selftext") or ""
            if keyword_filter and not _matches(f"{title} {body}", keywords):
                continue
            post = _emit_submission(d, sub)
            if post is None:
                continue
            page_posts.append((d, post))

        # Batch-check DB for which submissions we already have. Skip the
        # comment fetch for known ones (the submission is still yielded so
        # _upsert_posts can refresh `reach`).
        known = _known_submission_ids([p.id for _, p in page_posts])
        for d, post in page_posts:
            yield post
            if post.id in known:
                continue
            sub_id = d.get("id")
            if sub_id:
                yield from _iter_comments(client, sub_id, post.title, sub, from_ts, to_ts)

        # Listing short-circuit: if consecutive pages yield only
        # already-known submissions we've paginated into settled territory
        # and further pages would be pure re-fetch cost.
        page_has_new = any(p.id not in known for _, p in page_posts)
        if page_posts and not page_has_new:
            all_known_streak += 1
            if all_known_streak >= _KNOWN_PAGE_STREAK:
                log.debug("r/%s: paginated into known territory; stopping.", sub)
                return
        else:
            all_known_streak = 0

        after = (data.get("data") or {}).get("after")
        if not after or crossed_window:
            return


def fetch(from_ts: int, to_ts: int) -> Iterable[RawPost]:
    settings = get_settings()
    if not (settings.reddit_client_id and settings.reddit_client_secret):
        log.info("Reddit credentials unset; skipping reddit.")
        return
    token = _get_token(settings.reddit_client_id, settings.reddit_client_secret, settings.reddit_user_agent)
    if not token:
        return
    headers = {
        "Authorization": f"bearer {token}",
        "User-Agent": settings.reddit_user_agent,
    }
    keywords = settings.keywords
    with httpx.Client(
        base_url=_API_BASE, headers=headers, timeout=30.0, follow_redirects=True,
    ) as client:
        for sub in settings.ai_subs_list:
            yield from _walk_sub(client, sub, keyword_filter=False,
                                 keywords=keywords, from_ts=from_ts, to_ts=to_ts)
        for sub in settings.general_subs_list:
            yield from _walk_sub(client, sub, keyword_filter=True,
                                 keywords=keywords, from_ts=from_ts, to_ts=to_ts)
