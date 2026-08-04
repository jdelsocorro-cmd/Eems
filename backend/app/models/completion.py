import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Numeric, String, Text, func
from sqlalchemy import Enum as PgEnum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

MilestoneStatus = PgEnum("not_started", "in_progress", "done", name="milestone_status", create_type=False)
CompletionEntityType = PgEnum("task", "project", "milestone", name="completion_entity_type", create_type=False)
CompletionStatus = PgEnum("pending", "approved", "rejected", name="completion_status", create_type=False)
RecognitionRelatedEntityType = PgEnum(
    "task", "project", "milestone", "kpi", name="recognition_related_entity_type", create_type=False
)


class Milestone(Base):
    __tablename__ = "milestones"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    target_date: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(MilestoneStatus, nullable=False, default="not_started")
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("employees.id"))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class CompletionSubmission(Base):
    __tablename__ = "completion_submissions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    entity_type: Mapped[str] = mapped_column(CompletionEntityType, nullable=False)
    entity_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    submitted_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("employees.id"), nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    status: Mapped[str] = mapped_column(CompletionStatus, nullable=False, default="pending")
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("employees.id"))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completion_score: Mapped[float | None] = mapped_column(Numeric(5, 2))
    rejection_feedback: Mapped[str | None] = mapped_column(Text)


class CompletionEvidenceLink(Base):
    __tablename__ = "completion_evidence_links"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    submission_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("completion_submissions.id"), nullable=False
    )
    url: Mapped[str] = mapped_column(Text, nullable=False)
    label: Mapped[str | None] = mapped_column(String)
    added_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("employees.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class KpiTask(Base):
    __tablename__ = "kpi_tasks"

    kpi_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("kpis.id"), primary_key=True)
    task_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tasks.id"), primary_key=True)
    weight: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class KpiProject(Base):
    __tablename__ = "kpi_projects"

    kpi_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("kpis.id"), primary_key=True)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"), primary_key=True)
    weight: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class KpiMilestone(Base):
    __tablename__ = "kpi_milestones"

    kpi_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("kpis.id"), primary_key=True)
    milestone_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("milestones.id"), primary_key=True)
    weight: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Recognition(Base):
    __tablename__ = "recognitions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    employee_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("employees.id"), nullable=False)
    given_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("employees.id"), nullable=False)
    category: Mapped[str] = mapped_column(String, nullable=False, default="kudos")
    message: Mapped[str] = mapped_column(Text, nullable=False)
    related_entity_type: Mapped[str | None] = mapped_column(RecognitionRelatedEntityType)
    related_entity_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PositionScore(Base):
    __tablename__ = "position_scores"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    position_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("positions.id"), nullable=False)
    period_start: Mapped[date] = mapped_column(Date, nullable=False)
    period_end: Mapped[date] = mapped_column(Date, nullable=False)
    computed_score: Mapped[float | None] = mapped_column(Numeric(6, 2))
    computed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
