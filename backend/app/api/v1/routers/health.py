from fastapi import APIRouter
from sqlalchemy import text

from app.db.session import AsyncSessionLocal

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict:
    """Liveness check for Render's own health monitoring. Runs a real query
    (not just a 200 OK) so it also proves the DB connection is alive, not
    just the web process.

    Not what the keep-alive workflow hits, on purpose --
    .github/workflows/keepalive.yml pings Supabase's REST endpoint directly.
    Render's free-tier web service spinning down after 15 min idle is a
    cheap, accepted cold start (see the architecture plan); the Supabase
    project auto-pausing after 7 days idle is the actual outage risk, and
    pinging this endpoint wouldn't touch Supabase unless this web service
    also happened to be warm.
    """
    async with AsyncSessionLocal() as session:
        await session.execute(text("select 1"))
    return {"status": "ok"}
