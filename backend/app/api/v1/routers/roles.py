import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentEmployee, get_current_employee, get_db, require_permission
from app.models.rbac import Permission as PermissionModel
from app.models.rbac import Role as RoleModel
from app.schemas.rbac import Permission, Role, RoleCreate, RolePermissionCreate, RoleUpdate

router = APIRouter(tags=["rbac"])


@router.get("/permissions", response_model=list[Permission])
async def list_permissions(
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(require_permission("role", "manage")),
) -> list[PermissionModel]:
    """Fixed catalog -- needed to render the RBAC admin permission matrix.
    Gated on role.manage (not left open to any authenticated employee):
    the underlying table has no RLS restriction at all (permissions_select
    in 006_rls_policies.sql is `using (true)`, deliberately, since it's a
    catalog not per-row-sensitive data), so this API-level check is the
    only thing standing between "any employee" and "the entire RBAC
    permission catalog" -- added as part of the Super-Admin-vs-User view
    separation pass, matching the same require_permission gate create_role
    below already uses.
    """
    result = await db.execute(select(PermissionModel))
    return list(result.scalars().all())


@router.get("/roles", response_model=list[Role])
async def list_roles(
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(require_permission("role", "manage")),
) -> list[RoleModel]:
    result = await db.execute(select(RoleModel))
    return list(result.scalars().all())


@router.post("/roles", response_model=Role, status_code=status.HTTP_201_CREATED)
async def create_role(
    payload: RoleCreate,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(require_permission("role", "manage")),
) -> RoleModel:
    role = RoleModel(**payload.model_dump())
    db.add(role)
    await db.flush()
    await db.refresh(role)
    return role


@router.patch("/roles/{role_id}", response_model=Role)
async def update_role(
    role_id: uuid.UUID,
    payload: RoleUpdate,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> RoleModel:
    """No require_permission guard -- roles_mutate's own RLS policy already
    enforces company-scoped role.manage (015_scope_aware_rbac_mutate.sql),
    including blocking edits to system templates (company_id is null)
    entirely. Relying on RLS here, translated to 403 by
    core/error_handlers.py on denial, same pattern as departments/teams/
    positions.
    """
    role = await db.get(RoleModel, role_id)
    if role is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Role not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(role, field, value)

    await db.flush()
    await db.refresh(role)
    return role


@router.get("/roles/{role_id}/permissions", response_model=list[Permission])
async def get_role_permissions(
    role_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> list[PermissionModel]:
    result = await db.execute(
        text("""
            select p.id, p.resource, p.action, p.description
            from permissions p
            join role_permissions rp on rp.permission_id = p.id
            where rp.role_id = :role_id
        """),
        {"role_id": str(role_id)},
    )
    return [PermissionModel(**row) for row in result.mappings().all()]


@router.post("/roles/{role_id}/permissions", status_code=status.HTTP_204_NO_CONTENT)
async def grant_role_permission(
    role_id: uuid.UUID,
    payload: RolePermissionCreate,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> None:
    await db.execute(
        text("insert into role_permissions (role_id, permission_id) values (:role_id, :permission_id) on conflict do nothing"),
        {"role_id": str(role_id), "permission_id": str(payload.permission_id)},
    )
    await db.flush()


@router.delete("/roles/{role_id}/permissions/{permission_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_role_permission(
    role_id: uuid.UUID,
    permission_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> None:
    """Checks the DELETE actually matched a row -- found via browser
    testing: a bare `DELETE ... WHERE` that RLS silently filters down to
    zero matching rows is NOT an error in Postgres (unlike INSERT's WITH
    CHECK, which raises), so without this check the endpoint would return
    204 "success" even when role_permissions_mutate correctly blocked
    editing a system role's permissions -- the client would have no way to
    tell "revoked" from "silently did nothing." Same RETURNING-then-check
    pattern already used in position_assignments.end_position_assignment
    and employee_roles.revoke_employee_role.
    """
    result = await db.execute(
        text("delete from role_permissions where role_id = :role_id and permission_id = :permission_id returning role_id"),
        {"role_id": str(role_id), "permission_id": str(permission_id)},
    )
    if result.mappings().one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Permission grant not found, or you don't have rights to revoke it for this role",
        )
    await db.flush()
