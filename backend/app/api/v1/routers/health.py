import time

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


@router.get("/health/diag")
async def health_diag() -> dict:
    """TEMPORARY diagnostic endpoint -- added 2026-09-08 to confirm, with
    real server-side numbers rather than client-side inference, whether
    Render-to-Supabase cross-region latency (Render defaults to Oregon;
    Supabase is ap-southeast-1) plus NullPool's fresh-connection-per-request
    pattern (db/session.py) is the actual cause of multi-second API response
    times. Remove once that's confirmed either way -- not meant to ship
    long-term.
    """
    t0 = time.monotonic()
    async with AsyncSessionLocal() as session:
        t1 = time.monotonic()
        await session.execute(text("select 1"))
        t2 = time.monotonic()
        await session.execute(text("select 1"))
        t3 = time.monotonic()
        await session.execute(text("select count(*) from employees"))
        t4 = time.monotonic()
    return {
        "connection_setup_ms": round((t1 - t0) * 1000),
        "first_query_ms": round((t2 - t1) * 1000),
        "second_query_same_connection_ms": round((t3 - t2) * 1000),
        "third_query_real_table_ms": round((t4 - t3) * 1000),
        "total_ms": round((t4 - t0) * 1000),
    }
