import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, model_validator

GoalType = Literal["company", "org_unit", "individual"]
GoalStatus = Literal["draft", "active", "completed", "archived", "cancelled"]
KpiDirection = Literal["higher_is_better", "lower_is_better", "target_is_exact"]
KpiStatus = Literal["active", "completed", "archived"]
ScoreComputedBy = Literal["system", "manual"]


class GoalBase(BaseModel):
    company_id: uuid.UUID
    title: str
    description: str | None = None
    goal_type: GoalType
    org_unit_id: uuid.UUID | None = None
    employee_id: uuid.UUID | None = None
    owner_employee_id: uuid.UUID | None = None
    parent_goal_id: uuid.UUID | None = None
    period_start: date
    period_end: date
    status: GoalStatus = "draft"

    @model_validator(mode="after")
    def check_owner_matches_type(self) -> "GoalBase":
        # Mirrors the DB's chk_goals_owner_matches_type check constraint --
        # validated here too so the client gets a clean 422 instead of a raw
        # constraint-violation 500.
        owners = {
            "company": (self.org_unit_id is None and self.employee_id is None),
            "org_unit": (self.org_unit_id is not None and self.employee_id is None),
            "individual": (self.org_unit_id is None and self.employee_id is not None),
        }
        if not owners[self.goal_type]:
            raise ValueError(f"goal_type '{self.goal_type}' requires exactly its own owning field set")
        return self


class GoalCreate(GoalBase):
    pass


class GoalUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    status: GoalStatus | None = None
    owner_employee_id: uuid.UUID | None = None
    period_start: date | None = None
    period_end: date | None = None


class Goal(GoalBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    created_by: uuid.UUID | None = None
    created_at: datetime
    updated_at: datetime


class KpiTemplateBase(BaseModel):
    company_id: uuid.UUID | None = None
    name: str
    description: str | None = None
    unit: str
    direction: KpiDirection
    default_weight: float = 0
    applicable_scope_type: str | None = None
    applicable_scope_id: uuid.UUID | None = None
    is_active: bool = True


class KpiTemplateCreate(KpiTemplateBase):
    pass


class KpiTemplateUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    unit: str | None = None
    direction: KpiDirection | None = None
    default_weight: float | None = None
    is_active: bool | None = None


class KpiTemplate(KpiTemplateBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    created_by: uuid.UUID | None = None
    created_at: datetime
    updated_at: datetime


class KpiBase(BaseModel):
    employee_id: uuid.UUID
    goal_id: uuid.UUID | None = None
    kpi_template_id: uuid.UUID | None = None
    task_id: uuid.UUID | None = None
    name: str
    unit: str
    direction: KpiDirection
    target_value: float
    weight: float
    period_start: date
    period_end: date


class KpiCreate(KpiBase):
    current_value: float = 0


class KpiUpdate(BaseModel):
    # Split so the router can tell "sensitive" edits (need kpi/update_target,
    # logged to kpi_change_log) apart from routine progress logging (needs
    # only kpi/update_value, logged to kpi_value_history) -- see
    # app.enforce_kpi_sensitive_changes() in 005_goals_kpis.sql, which
    # enforces the same split at the DB layer as a backstop.
    current_value: float | None = None
    target_value: float | None = None
    weight: float | None = None
    direction: KpiDirection | None = None
    status: KpiStatus | None = None
    name: str | None = None


class Kpi(KpiBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    current_value: float
    status: KpiStatus
    created_by: uuid.UUID | None = None
    created_at: datetime
    updated_at: datetime


class KpiValueHistoryEntry(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    kpi_id: uuid.UUID
    old_value: float | None = None
    new_value: float
    changed_by: uuid.UUID | None = None
    changed_at: datetime
    note: str | None = None


class KpiChangeLogEntry(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    kpi_id: uuid.UUID
    field_changed: str
    old_value: str | None = None
    new_value: str | None = None
    changed_by: uuid.UUID | None = None
    changed_at: datetime
    reason: str | None = None


class KpiScore(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    employee_id: uuid.UUID
    period_start: date
    period_end: date
    computed_score: float | None = None
    kpi_snapshot: list[dict]
    computed_at: datetime
    computed_by: ScoreComputedBy


class ScoreComputeRequest(BaseModel):
    employee_id: uuid.UUID
    period_start: date
    period_end: date
