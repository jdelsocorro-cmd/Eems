from fastapi import APIRouter
from sqlalchemy import text

from app.db.session import AsyncSessionLocal

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict:
    """Liveness check for Render's own health monitoring. Runs a real query
    (not just a 200 OK) so it also proves the DB connection is alive, not
    just the web process.

    Also what .github/workflows/keepalive.yml's ping-render job hits every
    10 minutes. Render's free-tier 15-min idle spin-down was originally an
    accepted cold-start tradeoff for staying on the free tier -- revisited
    once that cold start turned out to be exactly what real usage felt as
    "loading takes some time": every request after 15 minutes idle ate a
    30-90s container cold boot. This endpoint being pinged keeps the
    service warm; it's unrelated to Supabase's separate 7-day auto-pause,
    which keepalive.yml's other job covers independently.
    """
    async with AsyncSessionLocal() as session:
        await session.execute(text("select 1"))
    return {"status": "ok"}
