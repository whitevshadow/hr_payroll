"""Per-service runtime wiring to avoid copy-paste boilerplate.

V1 bootstraps tables with ``metadata.create_all`` inside the FastAPI lifespan
(schema is created first via search_path target). This keeps ``docker compose
up`` a single working command.

# TODO(v2): replace create_all with Alembic ``upgrade head`` on start, one
# migration chain per service schema.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Callable

from fastapi import Depends, FastAPI, HTTPException
from sqlalchemy import MetaData, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from .auth import RequestContext, build_context_dependency
from .config import BaseServiceSettings
from .db import build_engine, build_session_factory, get_session_dependency


class ServiceRuntime:
    """Bundles engine, session factory and FastAPI dependencies for a service."""

    def __init__(self, settings: BaseServiceSettings, *metadatas: MetaData):
        self.settings = settings
        self.metadatas = metadatas
        self.engine = build_engine(settings.database_url, settings.db_schema)
        self.session_factory: async_sessionmaker[AsyncSession] = (
            build_session_factory(self.engine)
        )
        self.get_session = get_session_dependency(self.session_factory)
        self.get_context = build_context_dependency(
            settings.jwt_secret, settings.jwt_algorithm
        )

    async def create_all(self) -> None:
        async with self.engine.begin() as conn:
            await conn.execute(
                text(f"CREATE SCHEMA IF NOT EXISTS {self.settings.db_schema}")
            )
            for metadata in self.metadatas:
                # Ensure any explicit-schema tables (e.g. audit) exist too.
                for tbl in metadata.tables.values():
                    if tbl.schema:
                        await conn.execute(
                            text(f"CREATE SCHEMA IF NOT EXISTS {tbl.schema}")
                        )
                await conn.run_sync(metadata.create_all)

    def require_roles(self, *allowed: str, get_ctx: Callable | None = None) -> Callable:
        """Return a FastAPI dependency that enforces at least one of ``allowed`` roles."""
        get_ctx = get_ctx or self.get_context

        async def _guard(ctx: RequestContext = Depends(get_ctx)) -> RequestContext:
            if not any(r in allowed for r in ctx.roles):
                raise HTTPException(
                    status_code=403,
                    detail=f"Requires one of: {', '.join(allowed)}",
                )
            return ctx

        return _guard

    def lifespan(self):
        @asynccontextmanager
        async def _lifespan(app: FastAPI):
            await self.create_all()
            yield
            await self.engine.dispose()

        return _lifespan
