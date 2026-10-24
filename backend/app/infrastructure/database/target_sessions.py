# 2026-10-24：本次修改原因：Stage 2B v2 路由需复用显式配置的目标库会话，不接触旧版 tasks.db。
"""Lazy target-database session factory for API v2."""

import os
from functools import lru_cache

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.infrastructure.database.session import make_target_engine, require_database_revision, session_factory


@lru_cache(maxsize=1)
def _factory():
    url = os.getenv("AI4GEO_V2_DATABASE_URL")
    if not url:
        raise RuntimeError("Configure AI4GEO_V2_DATABASE_URL and migrate the separate target database before using /api/v2")
    engine = make_target_engine(url)
    require_database_revision(engine, "20261024_01")
    return session_factory(engine)


def target_session():
    try:
        factory = _factory()
    except (RuntimeError, ValueError) as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    with factory() as session:
        yield session
