from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.exc import DBAPIError

from app.api.v1.routers import (
    companies,
    dashboards,
    employee_roles,
    employees,
    goals,
    health,
    kpi_templates,
    kpis,
    org_units,
    position_assignments,
    positions,
    projects,
    roles,
    scores,
    tasks,
)
from app.core.config import get_settings
from app.core.error_handlers import rls_violation_handler

settings = get_settings()

app = FastAPI(title="EEMS API", version="0.1.0")
app.add_exception_handler(DBAPIError, rls_violation_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(companies.router, prefix="/api/v1")
app.include_router(org_units.router, prefix="/api/v1")
app.include_router(positions.router, prefix="/api/v1")
app.include_router(position_assignments.router, prefix="/api/v1")
app.include_router(employees.router, prefix="/api/v1")
app.include_router(roles.router, prefix="/api/v1")
app.include_router(employee_roles.router, prefix="/api/v1")
app.include_router(projects.router, prefix="/api/v1")
app.include_router(tasks.router, prefix="/api/v1")
app.include_router(goals.router, prefix="/api/v1")
app.include_router(kpi_templates.router, prefix="/api/v1")
app.include_router(kpis.router, prefix="/api/v1")
app.include_router(scores.router, prefix="/api/v1")
app.include_router(dashboards.router, prefix="/api/v1")
