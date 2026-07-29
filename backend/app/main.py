from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.routers import companies, employees, health
from app.core.config import get_settings

settings = get_settings()

app = FastAPI(title="EEMS API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(companies.router, prefix="/api/v1")
app.include_router(employees.router, prefix="/api/v1")
