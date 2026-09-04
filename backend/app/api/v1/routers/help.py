import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentEmployee, get_current_employee, get_db, require_permission
from app.models.help import HelpArticle as HelpArticleModel
from app.models.help import HelpArticleRole as HelpArticleRoleModel
from app.models.help import HelpArticleVersion as HelpArticleVersionModel
from app.models.help import HelpCategory as HelpCategoryModel
from app.schemas.help import (
    HelpArticle,
    HelpArticleCreate,
    HelpArticleRole,
    HelpArticleUpdate,
    HelpArticleVersion,
    HelpCategory,
    HelpCategoryCreate,
    HelpCategoryUpdate,
)

router = APIRouter(prefix="/help", tags=["help"])


@router.get("/categories", response_model=list[HelpCategory])
async def list_help_categories(
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> list[HelpCategoryModel]:
    """No manual company filter -- help_categories_select's own RLS
    (employee_accessible_company_ids) already scopes this to exactly what
    the caller's company(ies) have, the same "looks like select everything
    because RLS already scoped it" pattern used throughout this codebase.
    """
    result = await db.execute(
        select(HelpCategoryModel).where(HelpCategoryModel.is_active.is_(True)).order_by(HelpCategoryModel.sort_order)
    )
    return list(result.scalars().all())


@router.post("/categories", response_model=HelpCategory, status_code=status.HTTP_201_CREATED)
async def create_help_category(
    payload: HelpCategoryCreate,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(require_permission("help_articles", "manage")),
) -> HelpCategoryModel:
    category = HelpCategoryModel(**payload.model_dump())
    db.add(category)
    await db.flush()
    await db.refresh(category)
    return category


@router.patch("/categories/{category_id}", response_model=HelpCategory)
async def update_help_category(
    category_id: uuid.UUID,
    payload: HelpCategoryUpdate,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(require_permission("help_articles", "manage")),
) -> HelpCategoryModel:
    category = await db.get(HelpCategoryModel, category_id)
    if category is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Help category not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(category, field, value)
    await db.flush()
    await db.refresh(category)
    return category


@router.get("/articles", response_model=list[HelpArticle])
async def list_help_articles(
    category_id: uuid.UUID | None = Query(default=None),
    tag: str | None = Query(default=None),
    q: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> list[HelpArticleModel]:
    """search_vector is a generated column, not mapped on the ORM model --
    matching against it (and ranking by it) is done via raw text() fragments
    passed straight through to the DB, still composed with the ORM's normal
    category/tag filters and still fully subject to help_articles_select's
    RLS (a text() WHERE fragment doesn't bypass RLS, it's just another
    predicate ANDed onto the same query Postgres evaluates the policy against).
    """
    stmt = select(HelpArticleModel)
    if q:
        stmt = (
            stmt.where(text("search_vector @@ websearch_to_tsquery('english', :q)"))
            .order_by(text("ts_rank(search_vector, websearch_to_tsquery('english', :q)) desc"))
            .params(q=q)
        )
    else:
        stmt = stmt.order_by(HelpArticleModel.title)
    if category_id is not None:
        stmt = stmt.where(HelpArticleModel.category_id == category_id)
    if tag is not None:
        stmt = stmt.where(HelpArticleModel.tags.any(tag))
    result = await db.execute(stmt)
    return list(result.scalars().all())


@router.get("/articles/{article_id}", response_model=HelpArticle)
async def get_help_article(
    article_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> HelpArticleModel:
    article = await db.get(HelpArticleModel, article_id)
    if article is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Help article not found")
    return article


@router.post("/articles/{article_id}/view", status_code=status.HTTP_204_NO_CONTENT)
async def record_help_article_view(
    article_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> None:
    """Fire-and-forget view counter, called by the frontend when an article
    is actually opened (not on every list fetch). Goes through app.
    increment_help_article_view() rather than a plain UPDATE -- an ordinary
    employee reading a published article holds no help_articles.manage
    grant, so help_articles_mutate's RLS would otherwise block this exact
    write (see 047_engagement_tracking.sql for why the function is scoped
    the way it is).
    """
    await db.execute(text("select app.increment_help_article_view(:id)"), {"id": str(article_id)})
    await db.flush()


@router.post("/articles", response_model=HelpArticle, status_code=status.HTTP_201_CREATED)
async def create_help_article(
    payload: HelpArticleCreate,
    db: AsyncSession = Depends(get_db),
    current: CurrentEmployee = Depends(require_permission("help_articles", "manage")),
) -> HelpArticleModel:
    article = HelpArticleModel(**payload.model_dump(), created_by=uuid.UUID(current.employee_id))
    db.add(article)
    await db.flush()
    await db.refresh(article)
    return article


@router.patch("/articles/{article_id}", response_model=HelpArticle)
async def update_help_article(
    article_id: uuid.UUID,
    payload: HelpArticleUpdate,
    db: AsyncSession = Depends(get_db),
    current: CurrentEmployee = Depends(require_permission("help_articles", "manage")),
) -> HelpArticleModel:
    """RETURNING-then-check, not a bare db.get()+setattr() -- help_articles_
    select is broader than help_articles_mutate (an ordinary employee can
    SELECT a published article they have no edit rights to), so a naive
    fetch-then-update would find the row via the broad select policy and
    then have its UPDATE silently blocked (0 rows) by the narrower mutate
    policy -- the same failure class documented on completion_submissions'
    approve/reject endpoints.
    """
    fields = payload.model_dump(exclude_unset=True)
    if not fields:
        article = await db.get(HelpArticleModel, article_id)
        if article is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Help article not found")
        return article

    set_clauses = ", ".join(f"{col} = :{col}" for col in fields)
    result = await db.execute(
        text(f"update help_articles set {set_clauses}, updated_by = :updated_by where id = :id returning id"),
        {**fields, "updated_by": current.employee_id, "id": str(article_id)},
    )
    if result.mappings().one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Help article not found, or you don't have rights to edit it",
        )
    article = await db.get(HelpArticleModel, article_id)
    await db.refresh(article)
    return article


@router.get("/articles/{article_id}/versions", response_model=list[HelpArticleVersion])
async def list_help_article_versions(
    article_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(require_permission("help_articles", "manage")),
) -> list[HelpArticleVersionModel]:
    result = await db.execute(
        select(HelpArticleVersionModel)
        .where(HelpArticleVersionModel.article_id == article_id)
        .order_by(HelpArticleVersionModel.version_no.desc())
    )
    return list(result.scalars().all())


@router.get("/articles/{article_id}/roles", response_model=list[HelpArticleRole])
async def list_help_article_roles(
    article_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(get_current_employee),
) -> list[HelpArticleRoleModel]:
    result = await db.execute(select(HelpArticleRoleModel).where(HelpArticleRoleModel.article_id == article_id))
    return list(result.scalars().all())


@router.post("/articles/{article_id}/roles/{role_id}", response_model=HelpArticleRole, status_code=status.HTTP_201_CREATED)
async def restrict_help_article_to_role(
    article_id: uuid.UUID,
    role_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(require_permission("help_articles", "manage")),
) -> HelpArticleRoleModel:
    link = HelpArticleRoleModel(article_id=article_id, role_id=role_id)
    db.add(link)
    await db.flush()
    await db.refresh(link)
    return link


@router.delete("/articles/{article_id}/roles/{role_id}", status_code=status.HTTP_204_NO_CONTENT)
async def unrestrict_help_article_role(
    article_id: uuid.UUID,
    role_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _current: CurrentEmployee = Depends(require_permission("help_articles", "manage")),
) -> None:
    result = await db.execute(
        text("delete from help_article_roles where article_id = :article_id and role_id = :role_id returning article_id"),
        {"article_id": str(article_id), "role_id": str(role_id)},
    )
    if result.mappings().one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Role restriction not found")
    await db.flush()
