import uuid
from typing import Literal

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


class DepartmentBase(BaseModel):
    company_id: uuid.UUID
    name: str
    code: str
    description: str | None = None
    is_active: bool = True


class DepartmentCreate(DepartmentBase):
    pass


class DepartmentUpdate(BaseModel):
    name: str | None = None
    code: str | None = None
    description: str | None = None
    is_active: bool | None = None


class Department(DepartmentBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID


class TeamBase(BaseModel):
    department_id: uuid.UUID
    name: str
    code: str
    description: str | None = None
    is_active: bool = True


class TeamCreate(TeamBase):
    pass


class TeamUpdate(BaseModel):
    name: str | None = None
    code: str | None = None
    description: str | None = None
    is_active: bool | None = None


class Team(TeamBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID


EmploymentType = Literal["full_time", "part_time", "contractor"]


class PositionBase(BaseModel):
    team_id: uuid.UUID
    title: str
    code: str
    reports_to_position_id: uuid.UUID | None = None
    seniority_level: int = 0
    employment_type: EmploymentType = "full_time"
    headcount_cap: int = 1
    is_active: bool = True


class PositionCreate(PositionBase):
    pass


class PositionUpdate(BaseModel):
    title: str | None = None
    code: str | None = None
    seniority_level: int | None = None
    employment_type: EmploymentType | None = None
    headcount_cap: int | None = None
    is_active: bool | None = None
    # reports_to_position_id is deliberately excluded here -- reparenting is
    # a distinct, more consequential action than a normal field edit (it's
    # what the position_closure/position_hierarchy_history trail exists for)
    # and goes through PositionReparent + POST /positions/{id}/reparent
    # instead of a silent PATCH.


class Position(PositionBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID


class PositionReparent(BaseModel):
    new_reports_to_position_id: uuid.UUID | None
    reason: str | None = None
