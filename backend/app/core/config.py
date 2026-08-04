from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Resolved relative to this file, not the process's cwd -- cwd varies by how
# uvicorn is launched (e.g. --app-dir from a different working directory),
# but backend/.env's location relative to this module never does.
_ENV_FILE = Path(__file__).resolve().parent.parent.parent / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=_ENV_FILE, extra="ignore")

    supabase_url: str
    supabase_anon_key: str  # "publishable key" in newer Supabase dashboards -- same role, new name
    supabase_service_role_key: str  # "secret key" in newer Supabase dashboards
    supabase_db_url: str
    # No JWT secret here on purpose -- this project uses Supabase's asymmetric
    # JWT signing keys, verified against the public JWKS endpoint instead of a
    # shared secret (see core/security.py). Nothing to configure or leak.

    environment: str = "development"
    cors_origins: str = "http://localhost:5173"
    # Where invite/recovery emails send the user to finish setup -- see
    # services/supabase_admin.py. Distinct from cors_origins (which can list
    # several origins); this is the one canonical frontend URL.
    frontend_url: str = "http://localhost:5173"
    # Optional -- if unset, notify_support_ticket_created() logs a warning
    # and no-ops rather than failing ticket creation. See services/slack_notify.py.
    slack_support_webhook_url: str | None = None

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
