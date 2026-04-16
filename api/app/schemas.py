from datetime import datetime
from typing import Dict, List, Optional
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
    emotions: Dict[str, float] = {}
    topics: List[str] = []
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
    emotions: Dict[str, float] = {}
    exemplar_ids: List[str] = []

    class Config:
        from_attributes = True


class WindowResponse(BaseModel):
    from_: datetime
    to: datetime
    aggregates: List[AggregateOut]
    exemplars: List[PostOut]

    class Config:
        populate_by_name = True


class StatsResponse(BaseModel):
    total_posts: int
    first_post_at: Optional[datetime]
    last_post_at: Optional[datetime]
    by_category: Dict[str, int]
