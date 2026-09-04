import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr

# Same set positions.employment_type uses (schemas/org.py) -- kept as its own
# alias since this describes the person, not the position they currently
# hold.
EmploymentType = Literal["full_time", "part_time", "contractor"]


class EmployeeMe(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    employee_number: str | None
    first_name: str
    last_name: str
    work_email: str
    status: str
    hire_date: date | None


class TouchLoginResponse(BaseModel):
    """is_first_login is true exactly once per employee, ever -- the call
    where last_login_at was still null going in. The frontend uses this to
    show a one-time welcome banner instead of tracking a separate
    "has seen welcome" flag.
    """

    is_first_login: bool


class EmployeeBase(BaseModel):
    first_name: str
    last_name: str
    work_email: EmailStr
    employee_number: str | None = None
    personal_email: str | None = None
    phone: str | None = None
    hire_date: date | None = None
    employment_type: EmploymentType | None = None


class EmployeeCreate(EmployeeBase):
    # If true, sends a real Supabase Auth invite email and links the
    # resulting auth user to this employee record immediately -- if false,
    # the record is created "pending" (auth_user_id null) for HR to
    # pre-provision someone who hasn't been invited yet. See
    # services/supabase_admin.py.
    send_invite: bool = True


class EmployeeUpdate(BaseModel):
    first_name: str | None = None
    last_name: str | None = None
    personal_email: str | None = None
    phone: str | None = None
    avatar_url: str | None = None
    hire_date: date | None = None
    employment_type: EmploymentType | None = None


class Employee(EmployeeBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    auth_user_id: uuid.UUID | None
    avatar_url: str | None
    termination_date: date | None
    status: str
    password_reset_requested_at: datetime | None


class EmployeeOffboard(BaseModel):
    termination_date: date | None = None
    reason: str | None = None


class PositionAssignmentBase(BaseModel):
    position_id: uuid.UUID
    employee_id: uuid.UUID
    assignment_type: str = "permanent"


class PositionAssignmentCreate(PositionAssignmentBase):
    pass


class PositionAssignment(PositionAssignmentBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    start_date: date
    end_date: date | None
    is_primary: bool


class EmployeeProfileSummaryManager(BaseModel):
    id: uuid.UUID
    first_name: str
    last_name: str


class EmployeeProfileSummary(BaseModel):
    """Overview tab for Employee 360 (and reusable anywhere else a
    position/org-unit/manager header is needed) -- one composite read
    instead of each caller independently joining position_assignments +
    positions + org_units by hand, the way UserManagement.tsx currently
    does client-side.
    """

    id: uuid.UUID
    employee_number: str | None
    first_name: str
    last_name: str
    work_email: str
    status: str
    hire_date: date | None
    tenure_days: int | None
    position_title: str | None
    org_unit_name: str | None
    manager: EmployeeProfileSummaryManager | None
