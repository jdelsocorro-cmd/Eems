import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Numeric, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy import Enum as PgEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

# create_type=False everywhere below -- these enum types already exist in
# Postgres (created by the SQL migrations, the schema's source of truth).
# Letting SQLAlchemy attempt CREATE TYPE would just fail against a DB that
# already has them.
EmploymentType = PgEnum("full_time", "part_time", "contractor", name="employment_type", create_type=False)


class Company(Base):
    __tablename__ = "companies"
    # implicit_returning=False: company creation triggers
    # app.grant_company_creator_admin() (BEFORE INSERT, see
    # supabase/migrations/013_scope_aware_org_structure_mutate.sql), which
    # grants the creator a scoped role on the new company so RLS can see it
    # at all. Postgres evaluates INSERT...RETURNING's row-visibility check
    # using the INSERT statement's own snapshot, which doesn't pick up that
    # trigger's side effect on employee_roles within the same statement --
    # confirmed by testing: identical INSERT without RETURNING succeeds, and
    # a separate SELECT run afterward in the same transaction correctly sees
    # the row. Disabling implicit RETURNING here makes flush() do a plain
    # INSERT, and refresh() reload server-generated defaults via that kind
    # of separate SELECT instead.
    __table_args__ = {"implicit_returning": False}

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String, nullable=False)
    legal_name: Mapped[str | None] = mapped_column(String)
    timezone: Mapped[str] = mapped_column(String, nullable=False, default="UTC")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    recognition_score_threshold: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False, default=90)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class OrgUnit(Base):
    __tablename__ = "org_units"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False)
    parent_unit_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("org_units.id"))
    unit_type: Mapped[str] = mapped_column(String, nullable=False, default="department")
    name: Mapped[str] = mapped_column(String, nullable=False)
    code: Mapped[str | None] = mapped_column(String)
    description: Mapped[str | None] = mapped_column(String)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Position(Base):
    __tablename__ = "positions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_unit_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("org_units.id"), nullable=False)
    title: Mapped[str] = mapped_column(String, nullable=False)
    code: Mapped[str] = mapped_column(String, nullable=False)
    reports_to_position_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("positions.id")
    )
    seniority_level: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    employment_type: Mapped[str] = mapped_column(EmploymentType, nullable=False, default="full_time")
    headcount_cap: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
