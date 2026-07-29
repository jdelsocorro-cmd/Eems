from fastapi import APIRouter
from sqlalchemy import text

from app.db.session import AsyncSessionLocal

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict:
    """Trivial liveness check -- also the target the free-tier keep-alive
    workflow pings every 12h to stop the Supabase project auto-pausing after
    7 days idle. Runs a real query (not just a 200 OK) so a ping also proves
    the DB connection itself is alive, not just the web process.
    """
    async with AsyncSessionLocal() as session:
        await session.execute(text("select 1"))
    return {"status": "ok"}
