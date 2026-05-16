from datetime import datetime

from sqlalchemy import JSON, DateTime, Float, Index, Integer, String, Text, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

from .config import get_settings


class Base(DeclarativeBase):
    pass


class Post(Base):
    __tablename__ = "posts"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    source: Mapped[str] = mapped_column(String(32), index=True)
    category: Mapped[str] = mapped_column(String(16), index=True)
    title: Mapped[str] = mapped_column(Text)
    snippet: Mapped[str] = mapped_column(Text, default="")
    url: Mapped[str] = mapped_column(Text)
    author: Mapped[str] = mapped_column(String(128), default="")
    published_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    sentiment: Mapped[float] = mapped_column(Float, default=0.0)
    emotions: Mapped[dict] = mapped_column(JSON, default=dict)
    topics: Mapped[list] = mapped_column(JSON, default=list)
    reach: Mapped[int] = mapped_column(Integer, default=0)
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
    __table_args__ = (Index("ix_agg_day_cat", "day", "category"),)


_settings = get_settings()
engine = create_engine(_settings.resolved_database_url, pool_pre_ping=True, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
