"""Test fixtures: swap in a fresh sqlite DB per test so the API runs end-to-end
without a real Postgres. We deliberately rebind the module-level ``engine``
and ``SessionLocal`` because the routes (and the startup hook that calls
``Base.metadata.create_all``) import them directly.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

# Point settings at an in-memory sqlite DB before the app imports anything.
os.environ.setdefault("DATABASE_URL", "sqlite+pysqlite:///:memory:")
os.environ.setdefault("CORS_ORIGINS", "*")

# Make the `api/` package importable when pytest is run from the repo root.
API_DIR = Path(__file__).resolve().parents[1]
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))


@pytest.fixture()
def client():
    # Reset settings cache so env vars above take effect even if a previous
    # test imported the app first.
    from app import config as config_mod
    config_mod.get_settings.cache_clear()

    from app import db as db_mod
    from app import main as main_mod

    # StaticPool + shared cache: every session checks out the SAME underlying
    # sqlite connection, so ":memory:" tables created by metadata.create_all()
    # are visible to route handlers. Without this, each new session opens a
    # fresh empty in-memory DB.
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        future=True,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)

    # Rebind the shared engine/session so routes use the fresh DB.
    db_mod.engine = engine
    db_mod.SessionLocal = SessionLocal

    db_mod.Base.metadata.create_all(bind=engine)

    with TestClient(main_mod.app) as c:
        yield c

    db_mod.Base.metadata.drop_all(bind=engine)
    engine.dispose()


@pytest.fixture()
def db_session():
    from app import db as db_mod
    with db_mod.SessionLocal() as s:
        yield s
