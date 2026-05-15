"""Daily aggregate roll-ups."""
from __future__ import annotations

import statistics
from datetime import datetime, timedelta, timezone

from sqlalchemy import and_, delete, select

from .db import DailyAggregate, Post, SessionLocal, init_db


def rollup_range(from_day: datetime, to_day: datetime) -> int:
    """Recompute daily aggregates for [from_day, to_day] inclusive."""
    init_db()
    from_day = datetime(from_day.year, from_day.month, from_day.day)
    to_day = datetime(to_day.year, to_day.month, to_day.day)
    total_rows = 0

    day = from_day
    while day <= to_day:
        next_day = day + timedelta(days=1)
        with SessionLocal() as s:
            rows = s.scalars(
                select(Post).where(and_(Post.published_at >= day, Post.published_at < next_day))
            ).all()
            s.execute(delete(DailyAggregate).where(DailyAggregate.day == day))

            groups: dict[tuple, list[Post]] = {}
            for p in rows:
                groups.setdefault((p.source, p.category), []).append(p)

            for (source, category), items in groups.items():
                sentiments = [p.sentiment for p in items]
                mean = sum(sentiments) / len(sentiments)
                var = statistics.pvariance(sentiments) if len(sentiments) > 1 else 0.0
                emo_sum: dict[str, float] = {}
                for p in items:
                    for k, v in (p.emotions or {}).items():
                        emo_sum[k] = emo_sum.get(k, 0.0) + float(v)
                n = len(items)
                emo_mean = {k: v / n for k, v in emo_sum.items()}
                top = sorted(items, key=lambda p: abs(p.sentiment) * (1 + (p.reach or 0)), reverse=True)[:12]
                agg = DailyAggregate(
                    day=day,
                    source=source,
                    category=category,
                    mean_sentiment=mean,
                    variance=var,
                    volume=n,
                    emotions=emo_mean,
                    exemplar_ids=[p.id for p in top],
                )
                s.add(agg)
                total_rows += 1
            s.commit()
        day = next_day
    return total_rows


def rollup_recent(days: int = 3) -> int:
    now = datetime.now(timezone.utc)
    return rollup_range(now - timedelta(days=days), now)
