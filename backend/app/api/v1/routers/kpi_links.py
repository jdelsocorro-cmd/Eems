import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentEmployee, get_current_employee, get_db
from app.models.completion import KpiMilestone as KpiMilestoneModel
from app.models.completion import KpiProject as KpiProjectModel
from app.models.completion import KpiTask as KpiTaskModel
from app.schemas.completion import KpiLinkCreate, KpiMilestone, KpiProject, KpiTask

router = APIRouter(prefix="/kpis", tags=["kpi-links"])

# Same shape three times over (task/project/milestone) -- kept as three thin
# route groups rather than one generic polymorphic route, since kpi_tasks/
# kpi_projects/kpi_milestones are real, separately-FK'd tables (031_kpi_
# links.sql), not one polymorphic table -- a generic route would just
# reintroduce the "which table" branching this schema design deliberately
# avoided.


@router.get("/{kpi_id}/tasks", response_model=list[KpiTask])
async def list_kpi_tasks(
    kpi_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> list[KpiTaskModel]:
    result = await db.execute(select(KpiTaskModel).where(KpiTaskModel.kpi_id == kpi_id))
    return list(result.scalars().all())


@router.post("/{kpi_id}/tasks/{task_id}", response_model=KpiTask, status_code=status.HTTP_201_CREATED)
async def link_kpi_task(
    kpi_id: uuid.UUID,
    task_id: uuid.UUID,
    payload: KpiLinkCreate,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> KpiTaskModel:
    link = KpiTaskModel(kpi_id=kpi_id, task_id=task_id, weight=payload.weight)
    db.add(link)
    await db.flush()
    await db.refresh(link)
    return link


@router.delete("/{kpi_id}/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def unlink_kpi_task(
    kpi_id: uuid.UUID,
    task_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> None:
    """RETURNING-then-check, not a bare DELETE -- an RLS-blocked DELETE
    silently matches zero rows rather than erroring, same bug class
    roles.py's revoke_role_permission and projects.py's
    remove_project_member both already guard against.
    """
    result = await db.execute(
        text("delete from kpi_tasks where kpi_id = :kpi_id and task_id = :task_id returning kpi_id"),
        {"kpi_id": str(kpi_id), "task_id": str(task_id)},
    )
    if result.mappings().one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Link not found, or you don't have rights to remove it")
    await db.flush()


@router.get("/{kpi_id}/projects", response_model=list[KpiProject])
async def list_kpi_projects(
    kpi_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> list[KpiProjectModel]:
    result = await db.execute(select(KpiProjectModel).where(KpiProjectModel.kpi_id == kpi_id))
    return list(result.scalars().all())


@router.post("/{kpi_id}/projects/{project_id}", response_model=KpiProject, status_code=status.HTTP_201_CREATED)
async def link_kpi_project(
    kpi_id: uuid.UUID,
    project_id: uuid.UUID,
    payload: KpiLinkCreate,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> KpiProjectModel:
    link = KpiProjectModel(kpi_id=kpi_id, project_id=project_id, weight=payload.weight)
    db.add(link)
    await db.flush()
    await db.refresh(link)
    return link


@router.delete("/{kpi_id}/projects/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def unlink_kpi_project(
    kpi_id: uuid.UUID,
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> None:
    result = await db.execute(
        text("delete from kpi_projects where kpi_id = :kpi_id and project_id = :project_id returning kpi_id"),
        {"kpi_id": str(kpi_id), "project_id": str(project_id)},
    )
    if result.mappings().one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Link not found, or you don't have rights to remove it")
    await db.flush()


@router.get("/{kpi_id}/milestones", response_model=list[KpiMilestone])
async def list_kpi_milestones(
    kpi_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> list[KpiMilestoneModel]:
    result = await db.execute(select(KpiMilestoneModel).where(KpiMilestoneModel.kpi_id == kpi_id))
    return list(result.scalars().all())


@router.post("/{kpi_id}/milestones/{milestone_id}", response_model=KpiMilestone, status_code=status.HTTP_201_CREATED)
async def link_kpi_milestone(
    kpi_id: uuid.UUID,
    milestone_id: uuid.UUID,
    payload: KpiLinkCreate,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> KpiMilestoneModel:
    link = KpiMilestoneModel(kpi_id=kpi_id, milestone_id=milestone_id, weight=payload.weight)
    db.add(link)
    await db.flush()
    await db.refresh(link)
    return link


@router.delete("/{kpi_id}/milestones/{milestone_id}", status_code=status.HTTP_204_NO_CONTENT)
async def unlink_kpi_milestone(
    kpi_id: uuid.UUID,
    milestone_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> None:
    result = await db.execute(
        text("delete from kpi_milestones where kpi_id = :kpi_id and milestone_id = :milestone_id returning kpi_id"),
        {"kpi_id": str(kpi_id), "milestone_id": str(milestone_id)},
    )
    if result.mappings().one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Link not found, or you don't have rights to remove it")
    await db.flush()
