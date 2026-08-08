from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .bootstrap import ensure_bootstrap_admin
from .deps import runtime
from .routes import router
from .settings import settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Wraps the shared runtime lifespan (which runs create_all) so the tables
    # exist before the bootstrap admin is inserted into them.
    async with runtime.lifespan()(app):
        await ensure_bootstrap_admin(runtime.session_factory, settings)
        yield


app = FastAPI(title="auth-service", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "auth-service"}
