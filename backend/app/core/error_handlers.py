from fastapi import Request, status
from fastapi.responses import JSONResponse
from sqlalchemy.exc import DBAPIError

# Postgres deliberately withholds the specific key/value (the .detail text,
# e.g. "Key (org_unit_id, code)=(<uuid>, AM4) already exists.") on tables
# with row-level security when the querying role's grants wouldn't
# otherwise let it see the conflicting row -- confirmed live: cause.detail
# is None on every request through the real (RLS-restricted) app.db.session
# role, even though the identical insert raises the full .detail text when
# run directly as an unrestricted role. That's intentional Postgres/RLS
# behavior (it stops error messages from leaking row data past RLS) and
# shouldn't be worked around. cause.constraint_name is schema metadata, not
# row data, so it isn't withheld -- mapped to a friendly, specific message
# per known constraint; anything not in this map still gets a useful,
# generic fallback instead of an opaque 500.
_FRIENDLY_UNIQUE_CONSTRAINTS = {
    "uq_positions_org_unit_code": "A position with that code already exists in this org unit.",
    "employees_work_email_key": "An employee with that work email already exists.",
    "employees_employee_number_key": "An employee with that employee number already exists.",
}


async def db_error_handler(request: Request, exc: DBAPIError) -> JSONResponse:
    """Translates specific, expected Postgres errors into clean HTTP
    responses. Registered as the app-wide DBAPIError handler
    (app.add_exception_handler in main.py), so this is the single place
    that decides which DB errors are "normal" business-rule rejections
    (bad request / conflict) versus real bugs that should keep surfacing
    as opaque 500s.

    Translates a raw RLS policy violation (Postgres SQLSTATE 42501,
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

    # app.enforce_kpi_sensitive_changes() (005_goals_kpis.sql) and
    # app.compute_and_snapshot_score() (022_compute_and_snapshot_score.sql)
    # raise a plain `raise exception` for authorization failures they detect
    # at the trigger/function level -- not RLS, so it doesn't match the text
    # above, but the same "translate to a clean 403" treatment applies.
    # Routers pre-check these same conditions for a nicer error message; this
    # is the defense-in-depth backstop for paths that skip the router (e.g.
    # Realtime, or a direct SQL call), matching the RLS-is-the-real-backstop
    # philosophy the whole schema is built on.
    if "not authorized" in str(exc.orig).lower():
        return JSONResponse(
            status_code=status.HTTP_403_FORBIDDEN,
            content={"detail": "Not authorized to perform this action on the specified resource."},
        )

    # Postgres SQLSTATE 23505 (unique_violation) -- e.g. two positions in
    # the same org unit sharing a code. Without this, a plain duplicate
    # entry (an everyday data-entry mistake, not a bug) surfaced to the
    # client as an opaque 500 with no indication of what was actually
    # wrong. Same wrapping as the RLS case above: the real asyncpg
    # exception (and its .constraint_name) is one level deeper, on
    # exc.orig.__cause__.
    cause = getattr(exc.orig, "__cause__", None)
    if getattr(cause, "sqlstate", None) == "23505" or getattr(exc.orig, "sqlstate", None) == "23505":
        constraint_name = getattr(cause, "constraint_name", None)
        detail = _FRIENDLY_UNIQUE_CONSTRAINTS.get(constraint_name, "That value is already in use. Please choose a different one.")
        return JSONResponse(status_code=status.HTTP_409_CONFLICT, content={"detail": detail})

    raise exc
