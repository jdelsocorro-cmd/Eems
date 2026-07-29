from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentEmployee, get_current_employee, get_db
from app.schemas.employee import EmployeeMe

router = APIRouter(prefix="/employees", tags=["employees"])


@router.get("/me", response_model=EmployeeMe)
async def get_me(
    current: CurrentEmployee = Depends(get_current_employee),
    db: AsyncSession = Depends(get_db),
) -> EmployeeMe:
    """The first real end-to-end proof of the auth chain: JWT verified ->
    app.current_employee_id() resolved -> RLS-scoped row fetched -- if this
    endpoint works for a logged-in user, the whole foundation (JWT, RLS
    claim-setting, employees_select policy) is wired correctly.
    """
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
