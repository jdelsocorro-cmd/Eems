import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict


class CompanyBase(BaseModel):
    name: str
    legal_name: str | None = None
    timezone: str = "UTC"
    is_active: bool = True
    recognition_score_threshold: float = 90


class CompanyCreate(CompanyBase):
    pass


class CompanyUpdate(BaseModel):
    name: str | None = None
    legal_name: str | None = None
    timezone: str | None = None
    is_active: bool | None = None
    recognition_score_threshold: float | None = None


class Company(CompanyBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID


class OrgUnitBase(BaseModel):
    company_id: uuid.UUID
    parent_unit_id: uuid.UUID | None = None
    unit_type: str = "department"
    name: str
    code: str | None = None
    description: str | None = None
    is_active: bool = True


class OrgUnitCreate(OrgUnitBase):
    pass


class OrgUnitUpdate(BaseModel):
    name: str | None = None
    unit_type: str | None = None
    code: str | None = None
    description: str | None = None
    is_active: bool | None = None
    # parent_unit_id deliberately excluded here, same reasoning as
    # PositionUpdate below -- reparenting is a distinct, audited action
    # (POST /org-units/{id}/reparent), not a silent PATCH.


class OrgUnit(OrgUnitBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID


class OrgUnitReparent(BaseModel):
    new_parent_unit_id: uuid.UUID | None
    reason: str | None = None


EmploymentType = Literal["full_time", "part_time", "contractor"]


class PositionBase(BaseModel):
    org_unit_id: uuid.UUID
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
    org_unit_id: uuid.UUID | None = None
    seniority_level: int | None = None
    employment_type: EmploymentType | None = None
    headcount_cap: int | None = None
    is_active: bool | None = None
    # reports_to_position_id is deliberately excluded here -- reparenting is
    # a distinct, more consequential action than a normal field edit (it's
    # what the position_closure/position_hierarchy_history trail exists for)
    # and goes through PositionReparent + POST /positions/{id}/reparent
    # instead of a silent PATCH.
    #
    # org_unit_id (which org unit a position belongs to) has no analogous
    # audit table -- unlike reports_to_position_id, there's no
    # closure-table/cycle-detection concern in moving a position to a
    # different unit, so it's a plain editable field like title/code.


class Position(PositionBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID


class PositionReparent(BaseModel):
    new_reports_to_position_id: uuid.UUID | None
    reason: str | None = None
