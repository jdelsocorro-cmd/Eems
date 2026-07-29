import uuid
from datetime import date

from pydantic import BaseModel, ConfigDict


class EmployeeMe(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    employee_number: str | None
    first_name: str
    last_name: str
    work_email: str
    status: str
    hire_date: date | None
