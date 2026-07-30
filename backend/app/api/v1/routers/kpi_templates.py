import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentEmployee, get_current_employee, get_db
from app.models.goal import KpiTemplate as KpiTemplateModel
from app.schemas.goal import KpiTemplate, KpiTemplateCreate, KpiTemplateUpdate

router = APIRouter(prefix="/kpi-templates", tags=["kpi-templates"])


@router.get("", response_model=list[KpiTemplate])
async def list_kpi_templates(
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> list[KpiTemplateModel]:
    result = await db.execute(select(KpiTemplateModel).where(KpiTemplateModel.is_active.is_(True)))
    return list(result.scalars().all())


@router.post("", response_model=KpiTemplate, status_code=status.HTTP_201_CREATED)
async def create_kpi_template(
    payload: KpiTemplateCreate,
    db: AsyncSession = Depends(get_db),
    current: CurrentEmployee = Depends(get_current_employee),
) -> KpiTemplateModel:
    """company_id must be set by the caller -- kpi_templates_mutate
    (021_scope_aware_goals_kpi_templates_mutate.sql) rejects company_id is
    null entirely, so global library templates aren't API-mutable, only
    company-specific ones the caller holds kpi_template.manage on.
    """
    template = KpiTemplateModel(**payload.model_dump(), created_by=uuid.UUID(current.employee_id))
    db.add(template)
    await db.flush()
    await db.refresh(template)
    return template


@router.patch("/{template_id}", response_model=KpiTemplate)
async def update_kpi_template(
    template_id: uuid.UUID,
    payload: KpiTemplateUpdate,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> KpiTemplateModel:
    template = await db.get(KpiTemplateModel, template_id)
    if template is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="KPI template not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(template, field, value)

    await db.flush()
    await db.refresh(template)
    return template
