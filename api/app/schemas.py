from datetime import datetime

from pydantic import BaseModel


class PostOut(BaseModel):
    id: str
    source: str
    category: str
    title: str
    snippet: str = ""
    url: str
    author: str = ""
    published_at: datetime
    sentiment: float
    emotions: dict[str, float] = {}
    topics: list[str] = []
    reach: int = 0

    class Config:
        from_attributes = True


class AggregateOut(BaseModel):
    day: datetime
    source: str
    category: str
    mean_sentiment: float
    variance: float
    volume: int
    emotions: dict[str, float] = {}
    exemplar_ids: list[str] = []

    class Config:
        from_attributes = True


class WindowResponse(BaseModel):
    from_: datetime
    to: datetime
    aggregates: list[AggregateOut]
    exemplars: list[PostOut]

    class Config:
        populate_by_name = True


class StatsResponse(BaseModel):
    total_posts: int
    first_post_at: datetime | None
    last_post_at: datetime | None
    by_category: dict[str, int]
