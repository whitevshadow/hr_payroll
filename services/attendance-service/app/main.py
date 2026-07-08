from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .deps import runtime
from .routes import router
from .leave_routes import router as leave_router

app = FastAPI(title="attendance-service", lifespan=runtime.lifespan())
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router)
app.include_router(leave_router)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "attendance-service"}
