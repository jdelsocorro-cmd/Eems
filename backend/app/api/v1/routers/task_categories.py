import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentEmployee, get_current_employee, get_db
from app.models.project import TaskCategory as TaskCategoryModel
from app.schemas.project import TaskCategory, TaskCategoryCreate, TaskCategoryUpdate

router = APIRouter(prefix="/task-categories", tags=["task-categories"])


@router.get("", response_model=list[TaskCategory])
async def list_task_categories(
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> list[TaskCategoryModel]:
    result = await db.execute(
        select(TaskCategoryModel).where(TaskCategoryModel.is_active.is_(True)).order_by(TaskCategoryModel.name)
    )
    return list(result.scalars().all())


@router.post("", response_model=TaskCategory, status_code=status.HTTP_201_CREATED)
async def create_task_category(
    payload: TaskCategoryCreate,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> TaskCategoryModel:
    """No require_permission guard, matching task creation itself -- this is
    a shared label any employee can add inline from the task form (RLS
    task_categories_insert in 027_task_categories.sql is the real gate,
    scoped to the caller's own company). Renaming/deactivating an existing
    one is a separate, permission-gated action (PATCH below).
    """
    category = TaskCategoryModel(**payload.model_dump())
    db.add(category)
    await db.flush()
    await db.refresh(category)
    return category


@router.patch("/{task_category_id}", response_model=TaskCategory)
async def update_task_category(
    task_category_id: uuid.UUID,
    payload: TaskCategoryUpdate,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> TaskCategoryModel:
    """RLS (task_categories_update) is the real gate here, requiring
    org_structure.manage on the category's company -- an uncontrolled rename
    would silently break everyone else's reporting.
    """
    category = await db.get(TaskCategoryModel, task_category_id)
    if category is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task category not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(category, field, value)

    await db.flush()
    await db.refresh(category)
    return category
