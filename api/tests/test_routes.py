from datetime import datetime, timedelta, timezone

import pytest

from app.models import Post, DailyAggregate
from app.schemas import PostOut


def _mk_post(id_: str, *, category: str = "public", sentiment: float = 0.1,
             reach: int = 1, published_at: datetime | None = None) -> Post:
    return Post(
        id=id_,
        source="gdelt",
        category=category,
        title=f"title {id_}",
        snippet="",
        url=f"https://example.com/{id_}",
        author="",
        published_at=published_at or datetime(2025, 6, 1, tzinfo=timezone.utc),
        sentiment=sentiment,
        emotions={"joy": 0.2},
        topics=["ai"],
        reach=reach,
    )


def test_healthz(client):
    r = client.get("/healthz")
    assert r.status_code == 200
    assert r.json() == {"ok": True}


def test_stats_empty_db(client):
    r = client.get("/api/stats")
    assert r.status_code == 200
    body = r.json()
    assert body["total_posts"] == 0
    assert body["by_category"] == {}
    assert body["first_post_at"] is None
    assert body["last_post_at"] is None


def test_window_empty_db(client):
    from_ = datetime(2025, 1, 1, tzinfo=timezone.utc).isoformat()
    to = datetime(2025, 12, 31, tzinfo=timezone.utc).isoformat()
    r = client.get("/api/window", params={"from": from_, "to": to})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["aggregates"] == []
    assert body["exemplars"] == []
    # Pydantic serializes `from_` via its populate_by_name alias; accept either
    # key to keep the contract forgiving.
    assert body.get("from_") or body.get("from")


def test_window_orders_by_reach_desc_and_filters_by_category(client, db_session):
    published = datetime(2025, 6, 15, tzinfo=timezone.utc)
    db_session.add_all([
        _mk_post("a", category="public", reach=10, published_at=published),
        _mk_post("b", category="science", reach=99, published_at=published),
        _mk_post("c", category="business", reach=50, published_at=published),
        _mk_post("d", category="public", reach=1, published_at=published),
    ])
    db_session.commit()

    r = client.get("/api/window", params={
        "from": datetime(2025, 6, 1, tzinfo=timezone.utc).isoformat(),
        "to": datetime(2025, 6, 30, tzinfo=timezone.utc).isoformat(),
    })
    assert r.status_code == 200, r.text
    ids = [p["id"] for p in r.json()["exemplars"]]
    assert ids == ["b", "c", "a", "d"], ids

    # Category filter narrows the result set.
    r2 = client.get("/api/window", params={
        "from": datetime(2025, 6, 1, tzinfo=timezone.utc).isoformat(),
        "to": datetime(2025, 6, 30, tzinfo=timezone.utc).isoformat(),
        "sources": "public",
    })
    assert r2.status_code == 200
    ids2 = [p["id"] for p in r2.json()["exemplars"]]
    assert ids2 == ["a", "d"]


def test_window_excludes_rows_outside_time_bounds(client, db_session):
    in_range = _mk_post("in", published_at=datetime(2025, 6, 15, tzinfo=timezone.utc))
    too_old = _mk_post("old", published_at=datetime(2024, 1, 1, tzinfo=timezone.utc))
    too_new = _mk_post("new", published_at=datetime(2026, 1, 1, tzinfo=timezone.utc))
    db_session.add_all([in_range, too_old, too_new])
    db_session.commit()

    r = client.get("/api/window", params={
        "from": datetime(2025, 6, 1, tzinfo=timezone.utc).isoformat(),
        "to": datetime(2025, 6, 30, tzinfo=timezone.utc).isoformat(),
    })
    ids = {p["id"] for p in r.json()["exemplars"]}
    assert ids == {"in"}


def test_post_detail_and_404(client, db_session):
    db_session.add(_mk_post("x"))
    db_session.commit()

    r = client.get("/api/post/x")
    assert r.status_code == 200
    assert r.json()["id"] == "x"

    miss = client.get("/api/post/does-not-exist")
    assert miss.status_code == 404


def test_aggregates_returned_in_window(client, db_session):
    db_session.add_all([
        DailyAggregate(
            day=datetime(2025, 6, 10, tzinfo=timezone.utc),
            source="gdelt", category="business",
            mean_sentiment=0.1, variance=0.02, volume=12,
            emotions={}, exemplar_ids=["a", "b"],
        ),
        DailyAggregate(
            day=datetime(2024, 1, 1, tzinfo=timezone.utc),
            source="gdelt", category="business",
            mean_sentiment=-0.2, variance=0.01, volume=5,
            emotions={}, exemplar_ids=[],
        ),
    ])
    db_session.commit()

    r = client.get("/api/window", params={
        "from": datetime(2025, 1, 1, tzinfo=timezone.utc).isoformat(),
        "to": datetime(2025, 12, 31, tzinfo=timezone.utc).isoformat(),
    })
    aggs = r.json()["aggregates"]
    assert len(aggs) == 1
    assert aggs[0]["volume"] == 12
    assert aggs[0]["exemplar_ids"] == ["a", "b"]


def test_postout_schema_round_trips_json_columns(client, db_session):
    """Regression guard for schema drift between SQLAlchemy Post and PostOut."""
    p = _mk_post("rt")
    p.emotions = {"anger": 0.3, "joy": 0.4}
    p.topics = ["ai", "ml"]
    db_session.add(p)
    db_session.commit()

    out = PostOut.model_validate(p)
    assert out.emotions == {"anger": 0.3, "joy": 0.4}
    assert out.topics == ["ai", "ml"]
    assert out.category == "public"
