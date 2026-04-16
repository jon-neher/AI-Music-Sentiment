import asyncio
import json
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from ..db import SessionLocal
from ..models import Post

router = APIRouter()


@router.websocket("/ws/live")
async def live(ws: WebSocket):
    await ws.accept()
    last_ts = datetime.now(timezone.utc) - timedelta(minutes=5)
    try:
        while True:
            with SessionLocal() as s:
                rows = s.scalars(
                    select(Post).where(Post.published_at > last_ts).order_by(Post.published_at)
                ).all()
            for p in rows:
                last_ts = max(last_ts, p.published_at)
                await ws.send_text(json.dumps({
                    "id": p.id,
                    "source": p.source,
                    "category": p.category,
                    "title": p.title,
                    "url": p.url,
                    "published_at": p.published_at.isoformat(),
                    "sentiment": p.sentiment,
                    "emotions": p.emotions,
                }))
            await asyncio.sleep(15)
    except WebSocketDisconnect:
        return
