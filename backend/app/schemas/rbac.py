import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, model_validator

# Must mirror the Postgres rbac_scope_type enum (rewritten in
# 025_migrate_positions_projects_goals_to_org_units.sql, which collapsed
# the separate 'department'/'team' scope branches into one 'org_unit'
# scope) -- this Literal was missed during that migration, so every grant
# at anything but 'company' or 'self' scope was rejected by this schema
# before ever reaching the database. Found live: granting "Manager" at
# org_unit scope failed with "Input should be 'company', 'department',
# 'team', 'position_subtree' or 'self'".
ScopeType = Literal["company", "org_unit", "position_subtree", "self"]


class Permission(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    resource: str
    action: str
    description: str | None


class RoleBase(BaseModel):
    name: str
    description: str | None = None


class RoleCreate(RoleBase):
    company_id: uuid.UUID


class RoleUpdate(BaseModel):
    name: str | None = None
    description: str | None = None


class Role(RoleBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    company_id: uuid.UUID | None
    is_system: bool


class RolePermissionCreate(BaseModel):
    permission_id: uuid.UUID


class EmployeeRoleCreate(BaseModel):
    employee_id: uuid.UUID
    role_id: uuid.UUID
    scope_type: ScopeType
    scope_id: uuid.UUID | None = None
    expires_at: datetime | None = None

    @model_validator(mode="after")
    def check_scope_id(self) -> "EmployeeRoleCreate":
        if self.scope_type == "self" and self.scope_id is not None:
            raise ValueError("scope_id must be omitted when scope_type is 'self'")
        if self.scope_type != "self" and self.scope_id is None:
            raise ValueError(f"scope_id is required when scope_type is '{self.scope_type}'")
        return self


class EmployeeRole(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    employee_id: uuid.UUID
    role_id: uuid.UUID
    scope_type: ScopeType
    scope_id: uuid.UUID | None
    granted_by: uuid.UUID | None
    granted_at: datetime
    expires_at: datetime | None
