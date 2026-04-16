from datetime import datetime
from sqlalchemy import String, Float, Integer, DateTime, JSON, Index, Text
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


class Post(Base):
    __tablename__ = "posts"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)  # source:native_id
    source: Mapped[str] = mapped_column(String(32), index=True)      # hn|reddit|gdelt|arxiv|...
    category: Mapped[str] = mapped_column(String(16), index=True)    # public|business|science
    title: Mapped[str] = mapped_column(Text)
    snippet: Mapped[str] = mapped_column(Text, default="")
    url: Mapped[str] = mapped_column(Text)
    author: Mapped[str] = mapped_column(String(128), default="")
    published_at: Mapped[datetime] = mapped_column(DateTime, index=True)

    sentiment: Mapped[float] = mapped_column(Float, default=0.0)  # -1..1
    emotions: Mapped[dict] = mapped_column(JSON, default=dict)    # {joy,anger,...}
    topics: Mapped[list] = mapped_column(JSON, default=list)
    reach: Mapped[int] = mapped_column(Integer, default=0)         # upvotes/citations/etc.

    __table_args__ = (
        Index("ix_posts_cat_time", "category", "published_at"),
        Index("ix_posts_src_time", "source", "published_at"),
    )


class DailyAggregate(Base):
    __tablename__ = "daily_aggregates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    day: Mapped[datetime] = mapped_column(DateTime, index=True)
    source: Mapped[str] = mapped_column(String(32), index=True)
    category: Mapped[str] = mapped_column(String(16), index=True)
    mean_sentiment: Mapped[float] = mapped_column(Float, default=0.0)
    variance: Mapped[float] = mapped_column(Float, default=0.0)
    volume: Mapped[int] = mapped_column(Integer, default=0)
    emotions: Mapped[dict] = mapped_column(JSON, default=dict)
    exemplar_ids: Mapped[list] = mapped_column(JSON, default=list)

    __table_args__ = (
        Index("ix_agg_day_cat", "day", "category"),
    )
