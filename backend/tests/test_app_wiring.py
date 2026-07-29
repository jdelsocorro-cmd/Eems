"""Foundation smoke test -- checks the app builds and routes are registered
without needing a live Supabase connection (there isn't one yet at this
stage of the build). Once a real Supabase project exists, this is where
integration tests against a local `supabase start` instance belong.
"""

import os

os.environ.setdefault("SUPABASE_URL", "https://placeholder.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "placeholder")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "placeholder")
os.environ.setdefault("SUPABASE_JWT_SECRET", "placeholder")
os.environ.setdefault("SUPABASE_DB_URL", "postgresql+asyncpg://user:pass@localhost:5432/postgres")

from app.main import app  # noqa: E402


def test_app_builds():
    assert app.title == "EEMS API"


def test_health_route_registered():
    paths = {route.path for route in app.routes}
    assert "/health" in paths


def test_expected_routes_registered():
    paths = {route.path for route in app.routes}
    assert "/api/v1/companies" in paths
    assert "/api/v1/employees/me" in paths
