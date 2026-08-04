import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentEmployee, get_current_employee, get_db
from app.models.completion import CompletionSubmission as CompletionSubmissionModel
from app.models.project import Task as TaskModel
from app.models.project import TaskComment as TaskCommentModel
from app.models.project import TaskStatusHistory as TaskStatusHistoryModel
from app.schemas.completion import CompletionSubmission, CompletionSubmissionCreate
from app.schemas.project import Task, TaskComment, TaskCommentCreate, TaskCreate, TaskStatusHistoryEntry, TaskUpdate
from app.services import completion_workflow

router = APIRouter(prefix="/tasks", tags=["tasks"])


@router.get("", response_model=list[Task])
async def list_tasks(
    project_id: uuid.UUID | None = Query(default=None),
    assignee_employee_id: uuid.UUID | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> list[TaskModel]:
    stmt = select(TaskModel).where(TaskModel.deleted_at.is_(None))
    if project_id is not None:
        stmt = stmt.where(TaskModel.project_id == project_id)
    if assignee_employee_id is not None:
        stmt = stmt.where(TaskModel.assignee_employee_id == assignee_employee_id)
    result = await db.execute(stmt)
    return list(result.scalars().all())


@router.get("/{task_id}", response_model=Task)
async def get_task(
    task_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> TaskModel:
    task = await db.get(TaskModel, task_id)
    if task is None or task.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    return task


@router.post("", response_model=Task, status_code=status.HTTP_201_CREATED)
async def create_task(
    payload: TaskCreate,
    db: AsyncSession = Depends(get_db),
    current: CurrentEmployee = Depends(get_current_employee),
) -> TaskModel:
    """No require_permission guard and no default owner trick needed here --
    tasks_insert's own RLS check (assigner_employee_id = self, and
    assignee_employee_id = self or in the assigner's position-subtree via
    accessible_employee_ids) is both the authorization AND, since it's a
    check on the row's own columns, what makes RETURNING work without a
    chicken-and-egg problem.
    """
    task = TaskModel(
        **payload.model_dump(),
        assigner_employee_id=uuid.UUID(current.employee_id),
        created_by=uuid.UUID(current.employee_id),
    )
    db.add(task)
    await db.flush()
    await db.refresh(task)
    return task


@router.patch("/{task_id}", response_model=Task)
async def update_task(
    task_id: uuid.UUID,
    payload: TaskUpdate,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> TaskModel:
    task = await db.get(TaskModel, task_id)
    if task is None or task.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(task, field, value)

    await db.flush()
    await db.refresh(task)
    return task


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def archive_task(
    task_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> None:
    task = await db.get(TaskModel, task_id)
    if task is None or task.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")

    task.deleted_at = datetime.now(timezone.utc)
    await db.flush()


@router.post("/{task_id}/submit-completion", response_model=CompletionSubmission, status_code=status.HTTP_201_CREATED)
async def submit_task_completion(
    task_id: uuid.UUID,
    payload: CompletionSubmissionCreate,
    db: AsyncSession = Depends(get_db),
    current: CurrentEmployee = Depends(get_current_employee),
) -> CompletionSubmissionModel:
    """completion_submissions_insert's own RLS (must be this task's
    assignee) is the real authorization -- no guard needed here beyond
    that, same pattern as create_task above.
    """
    return await completion_workflow.create_submission(db, "task", task_id, uuid.UUID(current.employee_id), payload)


@router.get("/{task_id}/history", response_model=list[TaskStatusHistoryEntry])
async def get_task_history(
    task_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> list[TaskStatusHistoryModel]:
    result = await db.execute(
        select(TaskStatusHistoryModel)
        .where(TaskStatusHistoryModel.task_id == task_id)
        .order_by(TaskStatusHistoryModel.changed_at)
    )
    return list(result.scalars().all())


@router.get("/{task_id}/comments", response_model=list[TaskComment])
async def list_task_comments(
    task_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> list[TaskCommentModel]:
    result = await db.execute(
        select(TaskCommentModel)
        .where(TaskCommentModel.task_id == task_id, TaskCommentModel.deleted_at.is_(None))
        .order_by(TaskCommentModel.created_at)
    )
    return list(result.scalars().all())


@router.post("/{task_id}/comments", response_model=TaskComment, status_code=status.HTTP_201_CREATED)
async def create_task_comment(
    task_id: uuid.UUID,
    payload: TaskCommentCreate,
    db: AsyncSession = Depends(get_db),
    current: CurrentEmployee = Depends(get_current_employee),
) -> TaskCommentModel:
    comment = TaskCommentModel(task_id=task_id, employee_id=uuid.UUID(current.employee_id), **payload.model_dump())
    db.add(comment)
    await db.flush()
    await db.refresh(comment)
    return comment
