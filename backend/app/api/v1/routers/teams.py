import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentEmployee, get_current_employee, get_db, require_permission
from app.models.org import Team as TeamModel
from app.schemas.org import Team, TeamCreate, TeamUpdate

router = APIRouter(prefix="/teams", tags=["teams"])


@router.get("", response_model=list[Team])
async def list_teams(
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> list[TeamModel]:
    result = await db.execute(select(TeamModel).where(TeamModel.deleted_at.is_(None)))
    return list(result.scalars().all())


@router.get("/{team_id}", response_model=Team)
async def get_team(
    team_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> TeamModel:
    team = await db.get(TeamModel, team_id)
    if team is None or team.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found")
    return team


@router.post("", response_model=Team, status_code=status.HTTP_201_CREATED)
async def create_team(
    payload: TeamCreate,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(require_permission("org_structure", "manage")),
) -> TeamModel:
    team = TeamModel(**payload.model_dump())
    db.add(team)
    await db.flush()
    await db.refresh(team)
    return team


@router.patch("/{team_id}", response_model=Team)
async def update_team(
    team_id: uuid.UUID,
    payload: TeamUpdate,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(require_permission("org_structure", "manage")),
) -> TeamModel:
    team = await db.get(TeamModel, team_id)
    if team is None or team.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(team, field, value)

    await db.flush()
    await db.refresh(team)
    return team


@router.delete("/{team_id}", status_code=status.HTTP_204_NO_CONTENT)
async def deactivate_team(
    team_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(require_permission("org_structure", "manage")),
) -> None:
    team = await db.get(TeamModel, team_id)
    if team is None or team.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found")

    team.deleted_at = datetime.now(timezone.utc)
    team.is_active = False
    await db.flush()
