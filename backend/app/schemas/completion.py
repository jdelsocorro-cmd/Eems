import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

MilestoneStatus = Literal["not_started", "in_progress", "done"]
CompletionEntityType = Literal["task", "project", "milestone"]
CompletionStatus = Literal["pending", "approved", "rejected"]
RecognitionRelatedEntityType = Literal["task", "project", "milestone", "kpi"]


class MilestoneBase(BaseModel):
    project_id: uuid.UUID
    name: str
    description: str | None = None
    target_date: date | None = None
    status: MilestoneStatus = "not_started"


class MilestoneCreate(MilestoneBase):
    pass


class MilestoneUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    target_date: date | None = None
    status: MilestoneStatus | None = None


class Milestone(MilestoneBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    created_by: uuid.UUID | None = None
    created_at: datetime
    updated_at: datetime


class CompletionEvidenceLink(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    submission_id: uuid.UUID
    url: str
    label: str | None = None
    added_by: uuid.UUID | None = None
    created_at: datetime


class EvidenceLinkInput(BaseModel):
    url: str
    label: str | None = None


class CompletionSubmissionCreate(BaseModel):
    summary: str
    evidence_links: list[EvidenceLinkInput] = []


class CompletionSubmissionApprove(BaseModel):
    completion_score: float


class CompletionSubmissionReject(BaseModel):
    rejection_feedback: str


class CompletionSubmission(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    entity_type: CompletionEntityType
    entity_id: uuid.UUID
    submitted_by: uuid.UUID
    summary: str
    submitted_at: datetime
    status: CompletionStatus
    reviewed_by: uuid.UUID | None = None
    reviewed_at: datetime | None = None
    completion_score: float | None = None
    rejection_feedback: str | None = None


class KpiLinkCreate(BaseModel):
    weight: float = 1


class KpiTask(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    kpi_id: uuid.UUID
    task_id: uuid.UUID
    weight: float
    created_at: datetime


class KpiProject(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    kpi_id: uuid.UUID
    project_id: uuid.UUID
    weight: float
    created_at: datetime


class KpiMilestone(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    kpi_id: uuid.UUID
    milestone_id: uuid.UUID
    weight: float
    created_at: datetime


class RecognitionCreate(BaseModel):
    employee_id: uuid.UUID
    category: str = "kudos"
    message: str
    related_entity_type: RecognitionRelatedEntityType | None = None
    related_entity_id: uuid.UUID | None = None


class Recognition(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    employee_id: uuid.UUID
    given_by: uuid.UUID
    category: str
    message: str
    related_entity_type: RecognitionRelatedEntityType | None = None
    related_entity_id: uuid.UUID | None = None
    created_at: datetime


class PositionScore(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    position_id: uuid.UUID
    period_start: date
    period_end: date
    computed_score: float | None = None
    computed_at: datetime


class RollupComputeRequest(BaseModel):
    company_id: uuid.UUID
    period_start: date
    period_end: date
