from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, and_
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import DailyAggregate, Post
from ..schemas import WindowResponse, AggregateOut, PostOut, StatsResponse

router = APIRouter()


@router.get("/window", response_model=WindowResponse)
def window(
    from_: datetime = Query(..., alias="from"),
    to: datetime = Query(...),
    sources: Optional[str] = Query(None, description="comma-separated category filter"),
    limit_exemplars: int = Query(200, le=2000),
    db: Session = Depends(get_db),
):
    cats = [c.strip() for c in sources.split(",")] if sources else None

    agg_stmt = select(DailyAggregate).where(
        and_(DailyAggregate.day >= from_, DailyAggregate.day <= to)
    )
    if cats:
        agg_stmt = agg_stmt.where(DailyAggregate.category.in_(cats))
    aggregates = db.scalars(agg_stmt).all()

    post_stmt = (
        select(Post)
        .where(and_(Post.published_at >= from_, Post.published_at <= to))
        .order_by(Post.reach.desc())
        .limit(limit_exemplars)
    )
    if cats:
        post_stmt = post_stmt.where(Post.category.in_(cats))
    exemplars = db.scalars(post_stmt).all()

    return WindowResponse(
        from_=from_,
        to=to,
        aggregates=[AggregateOut.model_validate(a) for a in aggregates],
        exemplars=[PostOut.model_validate(p) for p in exemplars],
    )


@router.get("/post/{post_id}", response_model=PostOut)
def post_detail(post_id: str, db: Session = Depends(get_db)):
    p = db.get(Post, post_id)
    if not p:
        from fastapi import HTTPException
        raise HTTPException(404, "not found")
    return PostOut.model_validate(p)


@router.get("/stats", response_model=StatsResponse)
def stats(db: Session = Depends(get_db)):
    from sqlalchemy import func
    total = db.scalar(select(func.count(Post.id))) or 0
    first = db.scalar(select(func.min(Post.published_at)))
    last = db.scalar(select(func.max(Post.published_at)))
    rows = db.execute(
        select(Post.category, func.count(Post.id)).group_by(Post.category)
    ).all()
    return StatsResponse(
        total_posts=total,
        first_post_at=first,
        last_post_at=last,
        by_category={r[0]: r[1] for r in rows},
    )
