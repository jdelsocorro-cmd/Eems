import json
from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy import text

from app.core.config import get_settings

settings = get_settings()

# SUPABASE_DB_URL points at Supabase's DIRECT connection (port 5432), not
# the Transaction pooler (6543), despite the original plan's default
# preference for the pooler. Reason, found via integration testing: the
# Transaction pooler (Supavisor) intermittently handed back a backend
# connection with a stale prepared statement from an earlier, unrelated
# client session, causing DuplicatePreparedStatementError on ordinary
# queries -- including SQLAlchemy's own dialect-initialization query, before
# any application code even ran. The direct/session-mode connection had zero
# failures across repeated testing -- it doesn't multiplex unrelated client
# sessions onto one physical backend connection the way transaction-mode
# pooling does, so it doesn't have that failure mode.
#
# statement_cache_size=0 stops asyncpg from using named prepared statements
# client-side at all -- still correct/defensive practice here even without
# transaction-mode pooling in the picture, and cheap to keep.
#
# A production readiness review (2026-09-08) found this engine originally
# used poolclass=NullPool -- meaning every single request opened a brand-new
# physical connection from scratch and closed it at the end. That decision
# was carried over from when this connection targeted the transaction
# pooler (where NullPool was one part of dodging the prepared-statement bug
# above); it was never revisited after the switch to the direct/session-mode
# connection, which doesn't share that risk. Measured live: opening a fresh
# connection to this database costs ~2.2s on its own (Render's default
# region is Oregon; Supabase is ap-southeast-1/Singapore -- see the
# accompanying region-migration fix), separate from actual query time
# (~175-355ms once a connection exists) -- meaning NullPool was paying that
# ~2.2s connection-setup tax on every single API request. Pooling here reuses
# already-established connections across requests instead, which is safe
# now that this isn't the transaction-mode pooler: a session-mode/direct
# connection is a real, dedicated backend session for as long as SQLAlchemy
# holds it, not something Supavisor is multiplexing between unrelated
# clients concurrently. pool_size=5 keeps normal traffic pooled without
# opening new connections; max_overflow=5 allows bursts past that (both
# comfortably inside Supabase's 60-direct-connection budget on a
# single-worker Render free-tier deployment); pool_pre_ping guards against
# a connection going stale after Render's own periodic idle/sleep cycles.
engine = create_async_engine(
    settings.supabase_db_url,
    pool_size=5,
    max_overflow=5,
    pool_pre_ping=True,
    connect_args={"statement_cache_size": 0},
)

AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def get_db_for_user(auth_user_id: str | None) -> AsyncGenerator[AsyncSession, None]:
    """Yields a session where auth.uid() (and therefore every RLS policy)
    resolves exactly as it would for a request that hit Postgres directly
    via Supabase's own client -- same mechanism PostgREST uses internally.

    auth_user_id is the `sub` claim from the caller's verified Supabase JWT
    (see core/security.py + core/deps.py), or None for unauthenticated
    contexts (auth.uid() then resolves to null, so RLS policies deny by
    default rather than granting anything).
    """
    async with AsyncSessionLocal() as session:
        async with session.begin():
            claims = json.dumps({"sub": auth_user_id, "role": "authenticated"})
            await session.execute(text("select set_config('request.jwt.claims', :claims, true)"), {"claims": claims})
            await session.execute(text("set local role authenticated"))
            yield session


async def get_db_as_service() -> AsyncGenerator[AsyncSession, None]:
    """For system-only operations (e.g. the scheduled scoring-snapshot job)
    that must bypass RLS deliberately. Skips `set local role authenticated`,
    so the session stays as the `eems_app` login role itself, which has
    BYPASSRLS granted directly (see supabase/migrations/008_app_role.sql) --
    RLS evaluates the current role post-SET-ROLE, so every normal
    request-handling path (get_db_for_user, above) still switches to
    `authenticated` and is fully RLS-restricted; only code that deliberately
    calls this function runs with the bypass active. Only call this from
    code paths gated by a system/cron trigger or an already-verified
    system-permission check, never directly from a user-input-driven request
    handler.
    """
    async with AsyncSessionLocal() as session:
        async with session.begin():
            yield session
