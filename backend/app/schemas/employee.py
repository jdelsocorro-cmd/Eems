import uuid
from datetime import date
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
