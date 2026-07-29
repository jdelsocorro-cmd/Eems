import json
from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy import text

from app.core.config import get_settings

settings = get_settings()

# Pool size kept modest -- Supabase free tier is a small shared-CPU instance;
# a large pool just queues connections at the DB rather than helping.
#
# statement_cache_size=0 is required, not optional: this connects through
# Supabase's Transaction-mode pooler (Supavisor), which can hand a given
# logical connection a different backend Postgres connection between
# statements. asyncpg's default client-side prepared-statement cache assumes
# a stable backend connection -- without disabling it here, you eventually
# hit "prepared statement ... does not exist" errors that are hard to
# reproduce because they depend on the pooler's routing, not the app's logic.
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
