from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .deps import runtime
from .routes import router

app = FastAPI(title="compliance-service", lifespan=runtime.lifespan())
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "compliance-service"}
