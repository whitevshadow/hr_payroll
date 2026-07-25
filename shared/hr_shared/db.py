"""Async engine + session factory builder.

Each service runs against the single ``hr_payroll`` database but is isolated to
its own schema via ``search_path``. The schema name is read from settings
(``DB_SCHEMA``).
"""

from __future__ import annotations

from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)


def build_engine(database_url: str, db_schema: str) -> AsyncEngine:
    """Create an async engine pinned to a single schema via search_path.

    asyncpg honours ``server_settings`` for the connection; setting
    ``search_path`` there means every statement on that connection resolves
    unqualified table names against the service's schema.
    """
    return create_async_engine(
        database_url,
        echo=False,
        pool_pre_ping=True,
        connect_args={"server_settings": {"search_path": db_schema}},
    )


def build_session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(
        engine, expire_on_commit=False, class_=AsyncSession
    )


def get_session_dependency(session_factory: async_sessionmaker[AsyncSession]):
    """Return a FastAPI dependency that yields a session per request."""

    async def _get_session() -> AsyncGenerator[AsyncSession, None]:
        async with session_factory() as session:
            yield session

    return _get_session
