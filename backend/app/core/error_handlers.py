from fastapi import Request, status
from fastapi.responses import JSONResponse
from sqlalchemy.exc import DBAPIError


async def rls_violation_handler(request: Request, exc: DBAPIError) -> JSONResponse:
    """Translates a raw RLS policy violation (Postgres SQLSTATE 42501,
    "new row violates row-level security policy") into a clean 403.

    This is the correct, expected way company-scoped writes get rejected --
    e.g. attempting to create a department under a company you hold no
    scoped grant for (see supabase/migrations/013_scope_aware_org_structure_
    mutate.sql). Without this handler, that legitimate rejection would
    surface to the client as an unhandled 500 instead of a 403, since RLS
    denial isn't something FastAPI or SQLAlchemy know how to interpret on
    their own.

    Matching on message text, not exception type: SQLAlchemy's asyncpg
    adapter wraps the raw asyncpg.exceptions.InsufficientPrivilegeError in
    its own DBAPI-shim exception class before it reaches exc.orig, so an
    isinstance check against the real asyncpg exception type doesn't match
    here -- confirmed by testing. Same pragmatic text-matching approach
    positions.py already uses for cycle-detection on reparent.

    Deliberately narrow: only this specific message is translated. Other
    DBAPIError causes (a genuine schema/query bug, a custom trigger's
    `raise exception` like the position-reparent cycle check) are NOT this
    kind of error and should keep surfacing as 500s (or their own specific
    handling) so real bugs don't get silently mislabeled as permission
    issues.
    """
    if "row-level security" in str(exc.orig).lower():
        return JSONResponse(
            status_code=status.HTTP_403_FORBIDDEN,
            content={"detail": "Not authorized to perform this action on the specified resource."},
        )
    raise exc
