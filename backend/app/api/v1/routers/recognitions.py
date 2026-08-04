import uuid

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentEmployee, get_current_employee, get_db
from app.models.completion import Recognition as RecognitionModel
from app.schemas.completion import Recognition, RecognitionCreate

router = APIRouter(prefix="/recognitions", tags=["recognitions"])


@router.get("", response_model=list[Recognition])
async def list_recognitions(
    employee_id: uuid.UUID | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> list[RecognitionModel]:
    stmt = select(RecognitionModel).order_by(RecognitionModel.created_at.desc())
    if employee_id is not None:
        stmt = stmt.where(RecognitionModel.employee_id == employee_id)
    result = await db.execute(stmt)
    return list(result.scalars().all())


@router.post("", response_model=Recognition, status_code=status.HTTP_201_CREATED)
async def create_recognition(
    payload: RecognitionCreate,
    db: AsyncSession = Depends(get_db),
    current: CurrentEmployee = Depends(get_current_employee),
) -> RecognitionModel:
    """No require_permission guard -- recognitions_insert's own RLS (any
    employee in a company you belong to) is the real authorization,
    deliberately low-friction, same reasoning as tasks_insert having none.
    Always a deliberate human action -- see 032_recognitions.sql -- nothing
    in this codebase creates a recognition automatically.
    """
    recognition = RecognitionModel(**payload.model_dump(), given_by=uuid.UUID(current.employee_id))
    db.add(recognition)
    await db.flush()
    await db.refresh(recognition)
    return recognition
