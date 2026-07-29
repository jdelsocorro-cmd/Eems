import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentEmployee, get_current_employee, get_db, require_permission
from app.models.org import Company as CompanyModel
from app.schemas.org import Company, CompanyCreate, CompanyUpdate

router = APIRouter(prefix="/companies", tags=["companies"])


@router.get("", response_model=list[Company])
async def list_companies(
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> list[CompanyModel]:
    # No manual WHERE clause needed for scoping -- RLS (companies_select in
    # 006_rls_policies.sql) already restricts this to the caller's own
    # company. The query looks like "select everything" because, from this
    # session's point of view backed by the RLS-scoped connection, it is.
    result = await db.execute(select(CompanyModel))
    return list(result.scalars().all())


@router.get("/{company_id}", response_model=Company)
async def get_company(
    company_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> CompanyModel:
    company = await db.get(CompanyModel, company_id)
    if company is None:
        # RLS makes an out-of-scope row indistinguishable from a
        # nonexistent one -- both come back as "not found", never a 403 that
        # would leak the row's existence.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Company not found")
    return company


@router.post("", response_model=Company, status_code=status.HTTP_201_CREATED)
async def create_company(
    payload: CompanyCreate,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(require_permission("org_structure", "manage")),
) -> CompanyModel:
    company = CompanyModel(**payload.model_dump())
    db.add(company)
    await db.flush()
    await db.refresh(company)
    return company


@router.patch("/{company_id}", response_model=Company)
async def update_company(
    company_id: uuid.UUID,
    payload: CompanyUpdate,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(require_permission("org_structure", "manage")),
) -> CompanyModel:
    company = await db.get(CompanyModel, company_id)
    if company is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Company not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(company, field, value)

    await db.flush()
    await db.refresh(company)
    return company
