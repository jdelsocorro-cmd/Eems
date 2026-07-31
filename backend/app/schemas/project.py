import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

ProjectStatus = Literal["planning", "active", "on_hold", "completed", "cancelled"]
PriorityLevel = Literal["low", "medium", "high", "critical"]
ProjectMemberRole = Literal["owner", "contributor", "viewer"]
TaskStatus = Literal["todo", "in_progress", "in_review", "blocked", "done", "cancelled"]


class ProjectBase(BaseModel):
    company_id: uuid.UUID
    org_unit_id: uuid.UUID | None = None
    name: str
    description: str | None = None
    status: ProjectStatus = "planning"
    priority: PriorityLevel = "medium"
    color: str | None = None
    start_date: date | None = None
    target_end_date: date | None = None


class ProjectCreate(ProjectBase):
    # owner_employee_id is optional and defaults to the caller in the
    # router -- letting it be set explicitly covers an exec creating a
    # project on someone else's behalf, see the RETURNING-visibility note in
    # 017_scope_aware_projects_mutate.sql for why that path needs read_all
    # or update_all to work, not just project.create.
    owner_employee_id: uuid.UUID | None = None


class ProjectUpdate(BaseModel):
    org_unit_id: uuid.UUID | None = None
    name: str | None = None
    description: str | None = None
    status: ProjectStatus | None = None
    owner_employee_id: uuid.UUID | None = None
    priority: PriorityLevel | None = None
    color: str | None = None
    start_date: date | None = None
    target_end_date: date | None = None
    actual_end_date: date | None = None


class Project(ProjectBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    owner_employee_id: uuid.UUID
    actual_end_date: date | None = None
    created_by: uuid.UUID | None = None
    created_at: datetime
    updated_at: datetime


class ProjectMemberCreate(BaseModel):
    employee_id: uuid.UUID
    role_in_project: ProjectMemberRole = "contributor"


class ProjectMember(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    project_id: uuid.UUID
    employee_id: uuid.UUID
    role_in_project: ProjectMemberRole
    added_at: datetime


class TaskBase(BaseModel):
    project_id: uuid.UUID | None = None
    parent_task_id: uuid.UUID | None = None
    title: str
    description: str | None = None
    priority: PriorityLevel = "medium"
    assignee_employee_id: uuid.UUID | None = None
    start_date: date | None = None
    due_date: date | None = None
    estimated_hours: float | None = None
    sort_order: int = 0


class TaskCreate(TaskBase):
    pass


class TaskUpdate(BaseModel):
    project_id: uuid.UUID | None = None
    parent_task_id: uuid.UUID | None = None
    title: str | None = None
    description: str | None = None
    status: TaskStatus | None = None
    priority: PriorityLevel | None = None
    assignee_employee_id: uuid.UUID | None = None
    start_date: date | None = None
    due_date: date | None = None
    estimated_hours: float | None = None
    actual_hours: float | None = None
    sort_order: int | None = None


class Task(TaskBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    status: TaskStatus
    assigner_employee_id: uuid.UUID | None = None
    actual_hours: float | None = None
    created_by: uuid.UUID | None = None
    created_at: datetime
    updated_at: datetime


class TaskStatusHistoryEntry(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    task_id: uuid.UUID
    old_status: TaskStatus | None = None
    new_status: TaskStatus
    changed_by: uuid.UUID | None = None
    changed_at: datetime


class TaskCommentCreate(BaseModel):
    body: str


class TaskComment(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    task_id: uuid.UUID
    employee_id: uuid.UUID
    body: str
    created_at: datetime
    updated_at: datetime
