import uuid

from pydantic import BaseModel, ConfigDict


class CompanyBase(BaseModel):
    name: str
    legal_name: str | None = None
    timezone: str = "UTC"
    is_active: bool = True


class CompanyCreate(CompanyBase):
    pass


class CompanyUpdate(BaseModel):
    name: str | None = None
    legal_name: str | None = None
    timezone: str | None = None
    is_active: bool | None = None


class Company(CompanyBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
