import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, Text, func
from sqlalchemy import Enum as PgEnum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
# severity reuses the existing priority_level enum/object (004_projects_tasks.sql,
# app/models/project.py) rather than redefining a duplicate one -- same values
# already used by projects.priority/tasks.priority mean the same thing here.
from app.models.project import PriorityLevel as Severity

SupportCategory = PgEnum(
    "bug", "ux_issue", "performance", "data_issue", "feature_request", "question", "other",
    name="support_category", create_type=False,
)
SupportTicketStatus = PgEnum(
    "new", "acknowledged", "in_progress", "resolved", "closed", name="support_ticket_status", create_type=False
)


class SupportTicket(Base):
    __tablename__ = "support_tickets"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False)
    reported_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("employees.id"), nullable=False)
    title: Mapped[str] = mapped_column(nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[str] = mapped_column(SupportCategory, nullable=False, default="other")
    severity: Mapped[str] = mapped_column(Severity, nullable=False, default="medium")
    status: Mapped[str] = mapped_column(SupportTicketStatus, nullable=False, default="new")
    page_url: Mapped[str | None] = mapped_column(Text)
    user_agent: Mapped[str | None] = mapped_column(Text)
    screenshot_path: Mapped[str | None] = mapped_column(Text)
    assigned_to: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("employees.id"))
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now())


class SupportTicketNote(Base):
    __tablename__ = "support_ticket_notes"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    ticket_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("support_tickets.id"), nullable=False)
    employee_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("employees.id"), nullable=False)
    note: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
