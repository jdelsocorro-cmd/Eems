from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_remote_address
from sqlalchemy.exc import DBAPIError

from app.api.v1.routers import (
    bulk_import,
    companies,
    completion,
    dashboards,
    employee_roles,
    employees,
    goals,
    health,
    help,
    kpi_links,
    kpi_templates,
    kpis,
    milestones,
    org_units,
    position_assignments,
    positions,
    projects,
    recognitions,
    review_delegations,
    roles,
    scores,
    support,
    task_categories,
    tasks,
)
from app.core.config import get_settings
from app.core.error_handlers import db_error_handler

settings = get_settings()

# A security review found no rate limiting anywhere in this backend --
# nothing stopping a single authenticated-but-malicious (or just buggy)
# client from hammering an expensive endpoint (the leadership rollup
# computation, bulk CSV staging, the goal-cascade bulk insert) or brute-
# force-adjacent probing. keyed by client IP (not by employee_id) since
# rate limiting is meant to catch abuse at the network layer, before/
# alongside the RLS-enforced authorization layer, not as a substitute for
# it. 120/minute is a blanket floor generous enough for normal interactive
# use (react-query's own caching means a real user's browser doesn't fire
# anywhere close to that) while still bounding a runaway script.
limiter = Limiter(key_func=get_remote_address, default_limits=["120/minute"])

# docs/redoc default to enabled at fixed paths in every environment --
# harmless on their own (RLS is the real authorization boundary regardless
# of whether an attacker can read the OpenAPI schema), but free
# reconnaissance of every endpoint/request shape is still worth not handing
# out in production. Kept on for local/staging so development isn't
# hindered.
app = FastAPI(
    title="EEMS API",
    version="0.1.0",
    docs_url="/docs" if settings.environment != "production" else None,
    redoc_url="/redoc" if settings.environment != "production" else None,
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)
app.add_exception_handler(DBAPIError, db_error_handler)

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
app.include_router(task_categories.router, prefix="/api/v1")
app.include_router(milestones.router, prefix="/api/v1")
app.include_router(completion.router, prefix="/api/v1")
app.include_router(goals.router, prefix="/api/v1")
app.include_router(kpi_templates.router, prefix="/api/v1")
app.include_router(kpis.router, prefix="/api/v1")
app.include_router(kpi_links.router, prefix="/api/v1")
app.include_router(recognitions.router, prefix="/api/v1")
app.include_router(scores.router, prefix="/api/v1")
app.include_router(dashboards.router, prefix="/api/v1")
app.include_router(help.router, prefix="/api/v1")
app.include_router(support.router, prefix="/api/v1")
app.include_router(review_delegations.router, prefix="/api/v1")
app.include_router(bulk_import.router, prefix="/api/v1")
