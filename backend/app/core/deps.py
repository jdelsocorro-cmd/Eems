from collections.abc import AsyncGenerator

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import InvalidTokenError, decode_supabase_jwt
from app.db.session import get_db_for_user

bearer_scheme = HTTPBearer(auto_error=False)


async def get_db(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> AsyncGenerator[AsyncSession, None]:
    """Base DB dependency: verifies the caller's Supabase JWT (if any) and
    yields a session with RLS claims set for that user. Routes that require
    a logged-in employee should depend on get_current_employee instead --
    this one is only for endpoints that need a session but handle
    "not authenticated" themselves (e.g. returning an empty result rather
    than a 401).
    """
    auth_user_id = None
    if credentials is not None:
        try:
            claims = decode_supabase_jwt(credentials.credentials)
            auth_user_id = claims.get("sub")
        except InvalidTokenError as exc:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token") from exc

    async for session in get_db_for_user(auth_user_id):
        yield session


class CurrentEmployee:
    """Resolved identity for the current request: the employees.id row that
    matches the caller's verified auth_user_id. Kept as a small dataclass-ish
    holder rather than the raw ORM row so routers depend on a stable shape.
    """

    def __init__(self, employee_id: str, auth_user_id: str):
        self.employee_id = employee_id
        self.auth_user_id = auth_user_id


async def get_current_employee(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> CurrentEmployee:
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")

    try:
        claims = decode_supabase_jwt(credentials.credentials)
    except InvalidTokenError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token") from exc

    auth_user_id = claims.get("sub")
    if not auth_user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token missing subject claim")

    # app.current_employee_id() is the same function RLS policies use, so
    # "who am I" is resolved identically here and inside every policy --
    # there's no second, divergent notion of identity to keep in sync.
    result = await db.execute(text("select app.current_employee_id()"))
    employee_id = result.scalar_one_or_none()
    if employee_id is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No employee record linked to this account yet",
        )

    return CurrentEmployee(employee_id=str(employee_id), auth_user_id=auth_user_id)


def require_permission(resource: str, action: str):
    """Dependency factory: 403s with a clear message before a handler even
    runs, for permission checks that aren't already implied by RLS row
    visibility (e.g. "can you create a project at all", vs. "can you see
    this specific project"). The underlying check is app.has_permission(),
    the exact same function used inside RLS policies -- one source of truth,
    enforced at both layers for defense in depth and for clearer error
    messages than a bare RLS-denied empty result would give.
    """

    async def _check(
        current: CurrentEmployee = Depends(get_current_employee),
        db: AsyncSession = Depends(get_db),
    ) -> CurrentEmployee:
        result = await db.execute(
            text("select app.has_permission(:employee_id, :resource, :action)"),
            {"employee_id": current.employee_id, "resource": resource, "action": action},
        )
        if not result.scalar_one():
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Missing permission: {resource}.{action}",
            )
        return current

    return _check
