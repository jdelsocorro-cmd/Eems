import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentEmployee, get_current_employee, get_db, require_permission
from app.schemas.rbac import EmployeeRole, EmployeeRoleCreate

router = APIRouter(prefix="/employee-roles", tags=["rbac"])


@router.get("", response_model=list[EmployeeRole])
async def list_employee_roles(
    employee_id: uuid.UUID | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> list[EmployeeRole]:
    """employee_roles_select's own RLS policy (self, or anyone with role.
    manage) already scopes this -- no manual filtering needed beyond the
    optional employee_id query param for the RBAC admin UI's "grants for
    this person" view.
    """
    where_clause = "where employee_id = :employee_id" if employee_id is not None else ""
    result = await db.execute(
        text(f"""
            select id, employee_id, role_id, scope_type, scope_id, granted_by, granted_at, expires_at
            from employee_roles
            {where_clause}
            order by granted_at desc
        """),
        {"employee_id": str(employee_id)} if employee_id is not None else {},
    )
    return [EmployeeRole(**row) for row in result.mappings().all()]


@router.post("", response_model=EmployeeRole, status_code=status.HTTP_201_CREATED)
async def grant_employee_role(
    payload: EmployeeRoleCreate,
    db: AsyncSession = Depends(get_db),
    current: CurrentEmployee = Depends(require_permission("role", "manage")),
) -> EmployeeRole:
    """The coarse require_permission check above just confirms the caller
    holds role.manage somewhere (a quick pre-check for a clean 403 message);
    employee_roles_mutate's RLS policy (015_scope_aware_rbac_mutate.sql)
    enforces that it's scoped to the SAME company this specific grant's
    scope resolves to -- a company-scoped admin can't grant roles reaching
    into a company they don't manage.
    """
    result = await db.execute(
        text("""
            insert into employee_roles (employee_id, role_id, scope_type, scope_id, granted_by, expires_at)
            values (:employee_id, :role_id, :scope_type, :scope_id, :granted_by, :expires_at)
            returning id, employee_id, role_id, scope_type, scope_id, granted_by, granted_at, expires_at
        """),
        {
            "employee_id": str(payload.employee_id),
            "role_id": str(payload.role_id),
            "scope_type": payload.scope_type,
            "scope_id": str(payload.scope_id) if payload.scope_id else None,
            "granted_by": current.employee_id,
            "expires_at": payload.expires_at,
        },
    )
    row = result.mappings().one()
    return EmployeeRole(**row)


@router.delete("/{grant_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_employee_role(
    grant_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(require_permission("role", "manage")),
) -> None:
    """Revoke = hard delete, not expiry -- unlike offboarding (which expires
    grants so the moment of revocation is itself auditable via employee_
    roles' own granted_at/expires_at trail), a manually revoked grant has no
    equivalent need to record "when it was revoked" as a distinct fact from
    "it no longer exists"; the audit_log trigger on employee_roles
    (002_rbac.sql) already captures the deletion event and the row's last
    state.
    """
    result = await db.execute(text("delete from employee_roles where id = :id returning id"), {"id": str(grant_id)})
    if result.mappings().one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Grant not found")
