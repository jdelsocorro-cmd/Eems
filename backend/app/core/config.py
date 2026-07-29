from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    supabase_url: str
    supabase_anon_key: str  # "publishable key" in newer Supabase dashboards -- same role, new name
    supabase_service_role_key: str  # "secret key" in newer Supabase dashboards
    supabase_db_url: str
    # No JWT secret here on purpose -- this project uses Supabase's asymmetric
    # JWT signing keys, verified against the public JWKS endpoint instead of a
    # shared secret (see core/security.py). Nothing to configure or leak.

    environment: str = "development"
    cors_origins: str = "http://localhost:5173"

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
