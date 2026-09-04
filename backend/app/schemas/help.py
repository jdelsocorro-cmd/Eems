import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

HelpArticleStatus = Literal["draft", "published", "archived"]


class HelpCategoryBase(BaseModel):
    company_id: uuid.UUID
    name: str
    sort_order: int = 0
    is_active: bool = True


class HelpCategoryCreate(HelpCategoryBase):
    pass


class HelpCategoryUpdate(BaseModel):
    name: str | None = None
    sort_order: int | None = None
    is_active: bool | None = None


class HelpCategory(HelpCategoryBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    created_at: datetime
    updated_at: datetime


class HelpArticleBase(BaseModel):
    company_id: uuid.UUID
    category_id: uuid.UUID | None = None
    title: str
    body_markdown: str
    tags: list[str] = []
    status: HelpArticleStatus = "draft"


class HelpArticleCreate(HelpArticleBase):
    pass


class HelpArticleUpdate(BaseModel):
    category_id: uuid.UUID | None = None
    title: str | None = None
    body_markdown: str | None = None
    tags: list[str] | None = None
    status: HelpArticleStatus | None = None


class HelpArticle(HelpArticleBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    view_count: int = 0
    created_by: uuid.UUID | None = None
    updated_by: uuid.UUID | None = None
    created_at: datetime
    updated_at: datetime


class HelpArticleRole(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    article_id: uuid.UUID
    role_id: uuid.UUID
    created_at: datetime


class HelpArticleVersion(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    article_id: uuid.UUID
    version_no: int
    title: str
    body_markdown: str
    edited_by: uuid.UUID | None = None
    edited_at: datetime
