import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentEmployee, get_current_employee, get_db, require_permission
from app.models.project import Project as ProjectModel
from app.models.project import ProjectMember as ProjectMemberModel
from app.schemas.project import Project, ProjectCreate, ProjectMember, ProjectMemberCreate, ProjectUpdate

router = APIRouter(prefix="/projects", tags=["projects"])


@router.get("", response_model=list[Project])
async def list_projects(
    owner_employee_id: uuid.UUID | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> list[ProjectModel]:
    stmt = select(ProjectModel).where(ProjectModel.deleted_at.is_(None))
    if owner_employee_id is not None:
        stmt = stmt.where(ProjectModel.owner_employee_id == owner_employee_id)
    result = await db.execute(stmt)
    return list(result.scalars().all())


@router.get("/{project_id}", response_model=Project)
async def get_project(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> ProjectModel:
    project = await db.get(ProjectModel, project_id)
    if project is None or project.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


@router.post("", response_model=Project, status_code=status.HTTP_201_CREATED)
async def create_project(
    payload: ProjectCreate,
    db: AsyncSession = Depends(get_db),
    current: CurrentEmployee = Depends(require_permission("project", "create")),
) -> ProjectModel:
    """owner_employee_id defaults to the caller -- this is what makes the
    RETURNING-visibility check on INSERT pass for free (projects_select
    allows owner_employee_id = self directly off the new row), no auto-grant
    trigger needed the way company creation required. See
    017_scope_aware_projects_mutate.sql for the one edge case this doesn't
    cover (creating a project on someone else's behalf without also holding
    read_all/update_all).
    """
    data = payload.model_dump()
    if data.get("owner_employee_id") is None:
        data["owner_employee_id"] = uuid.UUID(current.employee_id)
    project = ProjectModel(**data, created_by=uuid.UUID(current.employee_id))
    db.add(project)
    await db.flush()
    await db.refresh(project)
    return project


@router.patch("/{project_id}", response_model=Project)
async def update_project(
    project_id: uuid.UUID,
    payload: ProjectUpdate,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> ProjectModel:
    """No require_permission guard -- projects_update's own RLS policy
    (owner or company-scoped project.update_all) is the actual authorization
    here, same pattern as roles.update_role.
    """
    project = await db.get(ProjectModel, project_id)
    if project is None or project.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(project, field, value)

    await db.flush()
    await db.refresh(project)
    return project


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def archive_project(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> None:
    project = await db.get(ProjectModel, project_id)
    if project is None or project.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    project.deleted_at = datetime.now(timezone.utc)
    await db.flush()


@router.get("/{project_id}/members", response_model=list[ProjectMember])
async def list_project_members(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> list[ProjectMemberModel]:
    result = await db.execute(select(ProjectMemberModel).where(ProjectMemberModel.project_id == project_id))
    return list(result.scalars().all())


@router.post("/{project_id}/members", response_model=ProjectMember, status_code=status.HTTP_201_CREATED)
async def add_project_member(
    project_id: uuid.UUID,
    payload: ProjectMemberCreate,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> ProjectMemberModel:
    member = ProjectMemberModel(project_id=project_id, **payload.model_dump())
    db.add(member)
    await db.flush()
    await db.refresh(member)
    return member


@router.delete("/{project_id}/members/{employee_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_project_member(
    project_id: uuid.UUID,
    employee_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> None:
    """RETURNING-then-check, not a bare DELETE -- an RLS-blocked DELETE
    silently matches zero rows rather than erroring (see roles.py
    revoke_role_permission for the full explanation of this bug class).
    """
    result = await db.execute(
        text("delete from project_members where project_id = :project_id and employee_id = :employee_id returning project_id"),
        {"project_id": str(project_id), "employee_id": str(employee_id)},
    )
    if result.mappings().one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project member not found, or you don't have rights to remove them",
        )
    await db.flush()
