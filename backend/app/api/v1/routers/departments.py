import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentEmployee, get_current_employee, get_db, require_permission
from app.models.org import Department as DepartmentModel
from app.schemas.org import Department, DepartmentCreate, DepartmentUpdate

router = APIRouter(prefix="/departments", tags=["departments"])


@router.get("", response_model=list[Department])
async def list_departments(
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> list[DepartmentModel]:
    result = await db.execute(select(DepartmentModel).where(DepartmentModel.deleted_at.is_(None)))
    return list(result.scalars().all())


@router.get("/{department_id}", response_model=Department)
async def get_department(
    department_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> DepartmentModel:
    department = await db.get(DepartmentModel, department_id)
    if department is None or department.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Department not found")
    return department


@router.post("", response_model=Department, status_code=status.HTTP_201_CREATED)
async def create_department(
    payload: DepartmentCreate,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(require_permission("org_structure", "manage")),
) -> DepartmentModel:
    department = DepartmentModel(**payload.model_dump())
    db.add(department)
    await db.flush()
    await db.refresh(department)
    return department


@router.patch("/{department_id}", response_model=Department)
async def update_department(
    department_id: uuid.UUID,
    payload: DepartmentUpdate,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(require_permission("org_structure", "manage")),
) -> DepartmentModel:
    department = await db.get(DepartmentModel, department_id)
    if department is None or department.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Department not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(department, field, value)

    await db.flush()
    await db.refresh(department)
    return department


@router.delete("/{department_id}", status_code=status.HTTP_204_NO_CONTENT)
async def deactivate_department(
    department_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(require_permission("org_structure", "manage")),
) -> None:
    """Soft-delete only -- departments with teams/positions/history attached
    must never be hard-deleted. This sets deleted_at and is_active=false;
    the row and everything it's linked to stays intact.
    """
    department = await db.get(DepartmentModel, department_id)
    if department is None or department.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Department not found")

    department.deleted_at = datetime.now(timezone.utc)
    department.is_active = False
    await db.flush()
