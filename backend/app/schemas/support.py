import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

SupportCategory = Literal["bug", "ux_issue", "performance", "data_issue", "feature_request", "question", "other"]
SupportTicketStatus = Literal["new", "acknowledged", "in_progress", "resolved", "closed"]
Severity = Literal["low", "medium", "high", "critical"]


class SupportTicketCreate(BaseModel):
    title: str
    description: str
    category: SupportCategory = "other"
    severity: Severity = "medium"
    page_url: str | None = None
    user_agent: str | None = None
    screenshot_path: str | None = None


class SupportTicketUpdate(BaseModel):
    status: SupportTicketStatus | None = None
    severity: Severity | None = None
    category: SupportCategory | None = None
    assigned_to: uuid.UUID | None = None


class SupportTicket(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    company_id: uuid.UUID
    reported_by: uuid.UUID
    title: str
    description: str
    category: SupportCategory
    severity: Severity
    status: SupportTicketStatus
    page_url: str | None = None
    user_agent: str | None = None
    screenshot_path: str | None = None
    assigned_to: uuid.UUID | None = None
    created_at: datetime
    updated_at: datetime


class SupportTicketNoteCreate(BaseModel):
    note: str


class SupportTicketNote(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    ticket_id: uuid.UUID
    employee_id: uuid.UUID
    note: str
    created_at: datetime
