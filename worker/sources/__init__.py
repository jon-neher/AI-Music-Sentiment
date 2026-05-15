from dataclasses import dataclass, field
from datetime import datetime


@dataclass
class RawPost:
    id: str
    source: str
    category: str
    title: str
    snippet: str
    url: str
    author: str
    published_at: datetime
    reach: int = 0
    topics: list[str] = field(default_factory=list)
