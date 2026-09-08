import pytest_asyncio

from app.db.session import engine


@pytest_asyncio.fixture(autouse=True)
async def _dispose_db_engine_after_each_test():
    """Prevent SQLAlchemy's pooled asyncpg connections from surviving into
    a later test's event loop.

    `app/db/session.py`'s `engine` is a module-level singleton -- correct
    for a real server (one process, one event loop for its whole life), but
    every plain `@pytest.mark.asyncio` test here runs in its own fresh
    function-scoped event loop by default (pytest-asyncio's
    asyncio_default_fixture_loop_scope only affects async *fixtures*, not
    test functions themselves -- it wouldn't touch this even if set). Once
    a connection is pooled under one test's loop and that loop closes,
    `pool_pre_ping`'s reuse attempt in the next test dies with "Event loop
    is closed" -- and the pool's own invalidate-and-retry recovery path
    needs that same dead loop, so it raises instead of quietly reconnecting.
    Disposing here runs while the current test's loop is still alive, so
    every pooled connection is closed cleanly before it can leak into
    whichever loop runs next; the next test that touches the DB just opens
    a fresh connection under its own loop, same as it would in production
    (a fresh process, one loop, no cross-loop reuse).
    """
    yield
    await engine.dispose()
