import json
from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy import text
from sqlalchemy.pool import NullPool

from app.core.config import get_settings

settings = get_settings()

# SUPABASE_DB_URL points at Supabase's DIRECT connection (port 5432), not
# the Transaction pooler (6543), despite the original plan's default
# preference for the pooler. Reason, found via integration testing: even
# with poolclass=NullPool + statement_cache_size=0 (both applied below), the
# Transaction pooler (Supavisor) intermittently handed back a backend
# connection with a stale prepared statement from an earlier, unrelated
# client session, causing DuplicatePreparedStatementError on ordinary
# queries -- including SQLAlchemy's own dialect-initialization query, before
# any application code even ran. The identical NullPool + statement_cache_
# size=0 setup against the direct connection had zero failures across
# repeated testing. Phase 1 scale doesn't need pooler-level connection
# multiplexing anyway (Supabase free tier allows 60 direct connections;
# NullPool means at most one physical connection per in-flight request), so
# reliability wins over following the general pooler-for-serverless
# heuristic that doesn't hold up empirically for this combination right now.
# Revisit if connection volume ever approaches that limit.
#
# NullPool + statement_cache_size=0 are kept regardless (cheap, defensive,
# and correct practice for any pgbouncer-fronted Postgres, direct or not):
#   - statement_cache_size=0 stops asyncpg from using named prepared
#     statements client-side at all.
#   - NullPool means SQLAlchemy doesn't hold physical connections open
#     between requests, so an idle app never occupies a chunk of the
#     60-connection budget it isn't actively using.
engine = create_async_engine(
    settings.supabase_db_url,
    poolclass=NullPool,
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
