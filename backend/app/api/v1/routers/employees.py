import uuid
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentEmployee, get_current_employee, get_db, require_permission
from app.models.employee import Employee as EmployeeModel
from app.schemas.employee import (
    Employee,
    EmployeeCreate,
    EmployeeMe,
    EmployeeOffboard,
    EmployeeProfileSummary,
    EmployeeProfileSummaryManager,
    EmployeeUpdate,
)
from app.services.supabase_admin import SupabaseAdminError, ban_auth_user, invite_user_by_email

router = APIRouter(prefix="/employees", tags=["employees"])


@router.get("/me", response_model=EmployeeMe)
async def get_me(
    current: CurrentEmployee = Depends(get_current_employee),
    db: AsyncSession = Depends(get_db),
) -> EmployeeMe:
    result = await db.execute(
        text("""
            select id, employee_number, first_name, last_name, work_email, status, hire_date
            from employees
            where id = :employee_id
        """),
        {"employee_id": current.employee_id},
    )
    row = result.mappings().one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found")
    return EmployeeMe(**row)


@router.get("/me/permissions", response_model=list[str])
async def get_my_permissions(
    current: CurrentEmployee = Depends(get_current_employee),
    db: AsyncSession = Depends(get_db),
) -> list[str]:
    """The caller's own held (resource, action) grants, as "resource.action"
    strings -- lets the frontend decide what to render (nav items, route
    guards, mutation buttons) without duplicating RBAC logic client-side.
    Not a new authorization mechanism: it's a read of the exact same
    employee_roles -> role_permissions -> permissions chain
    app.has_permission() already walks (003_rbac_functions.sql), just
    returning the whole set instead of checking one pair. Safe under RLS
    with no special handling -- employee_roles_select already allows
    reading your own rows, role_permissions_select already allows reading
    rows for roles you could hold, and permissions_select is `using (true)`
    (006_rls_policies.sql) -- this endpoint doesn't grant any visibility
    the caller didn't already have via those three tables.
    """
    result = await db.execute(
        text("""
            select distinct perm.resource, perm.action
            from employee_roles er
            join role_permissions rp on rp.role_id = er.role_id
            join permissions perm on perm.id = rp.permission_id
            where er.employee_id = :employee_id
              and (er.expires_at is null or er.expires_at > now())
        """),
        {"employee_id": current.employee_id},
    )
    return [f"{row.resource}.{row.action}" for row in result.all()]


@router.get("", response_model=list[Employee])
async def list_employees(
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> list[EmployeeModel]:
    result = await db.execute(select(EmployeeModel).where(EmployeeModel.deleted_at.is_(None)))
    return list(result.scalars().all())


@router.get("/{employee_id}", response_model=Employee)
async def get_employee(
    employee_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> EmployeeModel:
    employee = await db.get(EmployeeModel, employee_id)
    if employee is None or employee.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found")
    return employee


@router.get("/{employee_id}/profile-summary", response_model=EmployeeProfileSummary)
async def get_employee_profile_summary(
    employee_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> EmployeeProfileSummary:
    """Overview tab for Employee 360 -- current position/org unit/manager in
    one composite read. No permission dependency beyond authentication:
    employees_select's own RLS (self, accessible_employee_ids, created_by,
    or -- since 040 -- hierarchy_subtree_employee_ids) is what actually
    gates whether `e` matches any row at all; if it doesn't, this 404s the
    same way get_employee already does, rather than re-implementing the
    visibility check here.
    """
    result = await db.execute(
        text("""
            select
                e.id, e.employee_number, e.first_name, e.last_name, e.work_email, e.status, e.hire_date,
                pos.title as position_title,
                ou.name as org_unit_name,
                mgr_emp.id as manager_id, mgr_emp.first_name as manager_first_name, mgr_emp.last_name as manager_last_name
            from employees e
            left join position_assignments pa on pa.employee_id = e.id and pa.end_date is null and pa.is_primary
            left join positions pos on pos.id = pa.position_id
            left join org_units ou on ou.id = pos.org_unit_id
            left join positions mgr_pos on mgr_pos.id = pos.reports_to_position_id
            left join position_assignments mgr_pa on mgr_pa.position_id = mgr_pos.id and mgr_pa.end_date is null and mgr_pa.is_primary
            left join employees mgr_emp on mgr_emp.id = mgr_pa.employee_id
            where e.id = :employee_id and e.deleted_at is null
        """),
        {"employee_id": str(employee_id)},
    )
    row = result.mappings().one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found")

    tenure_days = (date.today() - row["hire_date"]).days if row["hire_date"] else None
    manager = (
        EmployeeProfileSummaryManager(id=row["manager_id"], first_name=row["manager_first_name"], last_name=row["manager_last_name"])
        if row["manager_id"] is not None
        else None
    )
    return EmployeeProfileSummary(
        id=row["id"],
        employee_number=row["employee_number"],
        first_name=row["first_name"],
        last_name=row["last_name"],
        work_email=row["work_email"],
        status=row["status"],
        hire_date=row["hire_date"],
        tenure_days=tenure_days,
        position_title=row["position_title"],
        org_unit_name=row["org_unit_name"],
        manager=manager,
    )


@router.post("", response_model=Employee, status_code=status.HTTP_201_CREATED)
async def create_employee(
    payload: EmployeeCreate,
    db: AsyncSession = Depends(get_db),
    current: CurrentEmployee = Depends(require_permission("employee", "create")),
) -> EmployeeModel:
    """employee.create is intentionally NOT company-scoped the way
    org_structure.manage is (013_scope_aware_org_structure_mutate.sql) --
    unlike a department/team/position, a brand-new employee has no position
    assignment yet, so there's no company to scope creation against, the
    same reason company creation itself stays unscoped. Low real-world risk
    at Phase 1 scale (single-tenant EDGE, one company total) -- revisit if
    genuine multi-company tenancy is ever added.

    created_by is set here (not left to a default) so employees_select's
    "you can see records you created" clause (014_employee_created_by_
    visibility.sql) actually applies -- otherwise the creator couldn't see
    the employee they just made until that person is assigned a position.
    """
    auth_user_id = None
    if payload.send_invite:
        try:
            auth_user_id = await invite_user_by_email(payload.work_email)
        except SupabaseAdminError as exc:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    employee = EmployeeModel(
        **payload.model_dump(exclude={"send_invite"}),
        auth_user_id=auth_user_id,
        created_by=uuid.UUID(current.employee_id),
    )
    db.add(employee)
    await db.flush()
    await db.refresh(employee)
    return employee


@router.patch("/{employee_id}", response_model=Employee)
async def update_employee(
    employee_id: uuid.UUID,
    payload: EmployeeUpdate,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> EmployeeModel:
    """No require_permission dependency -- employees_update's own RLS
    policy already allows self-edit OR has_permission_on_employee(...,
    'employee', 'update') scoped to the target's accessible subtree, so the
    UPDATE either succeeds under RLS or raises the 403 translated by
    core/error_handlers.py. A require_permission("employee","update") guard
    here would incorrectly block self-edits, since an ordinary employee has
    no employee.update grant at all -- only the RLS self-check allows it.
    """
    employee = await db.get(EmployeeModel, employee_id)
    if employee is None or employee.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(employee, field, value)

    await db.flush()
    await db.refresh(employee)
    return employee


@router.post("/{employee_id}/offboard", response_model=Employee)
async def offboard_employee(
    employee_id: uuid.UUID,
    payload: EmployeeOffboard,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(require_permission("employee", "update")),
) -> EmployeeModel:
    """Offboarding is a status change, never a DELETE -- audit history
    (audit_log, kpi_scores, task assignments, ...) must survive. This:
    (1) sets status=offboarded + termination_date, (2) closes any open
    position_assignments so they stop counting as the position's current
    holder / showing up in the org chart, (3) expires their role grants so
    a disabled account can't retain elevated access, (4) bans (not deletes)
    their Supabase Auth account, so login is blocked but the account -- and
    everything it's linked to -- can be restored on rehire.

    Order matters here, found via testing: the employee row's own UPDATE
    must flush WHILE their position_assignment is still open, not after.
    employees_update's RLS check (via has_permission_on_employee ->
    accessible_employee_ids) requires the target to currently be within the
    caller's accessible subtree, which depends on them HAVING an open
    position_assignment -- closing it first, then trying to flush the
    status change, makes the employee invisible to that RLS check before
    the UPDATE it's gating even runs, so it silently matches zero rows
    (StaleDataError) instead of actually offboarding them.
    """
    employee = await db.get(EmployeeModel, employee_id)
    if employee is None or employee.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found")

    employee.status = "offboarded"
    employee.termination_date = payload.termination_date or date.today()
    await db.flush()

    await db.execute(
        text("update position_assignments set end_date = :end_date where employee_id = :employee_id and end_date is null"),
        {"end_date": employee.termination_date, "employee_id": str(employee_id)},
    )
    await db.execute(
        text("update employee_roles set expires_at = :now where employee_id = :employee_id and (expires_at is null or expires_at > :now)"),
        {"now": datetime.now(timezone.utc), "employee_id": str(employee_id)},
    )
    await db.flush()

    if employee.auth_user_id is not None:
        try:
            await ban_auth_user(str(employee.auth_user_id))
        except SupabaseAdminError as exc:
            # The DB-side offboarding already committed at this point (flush
            # above) -- surface the auth-ban failure distinctly rather than
            # rolling back state that's otherwise correct, so it's visible
            # and can be retried/handled manually instead of silently lost.
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Employee offboarded, but disabling their login failed: {exc}",
            ) from exc

    await db.refresh(employee)
    return employee
