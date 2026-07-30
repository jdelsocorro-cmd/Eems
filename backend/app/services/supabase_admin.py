import httpx

from app.core.config import get_settings


class SupabaseAdminError(Exception):
    pass


async def invite_user_by_email(email: str) -> str:
    """Calls Supabase Auth's admin invite endpoint -- creates an auth.users
    row and sends a real "you've been invited" email with a signup link.
    Returns the new auth user's id, to be linked as employees.auth_user_id.

    Uses the service_role key -- this is the one legitimate backend use of
    it in this codebase; every other DB access goes through the RLS-scoped
    eems_app connection (see db/session.py).
    """
    settings = get_settings()
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{settings.supabase_url}/auth/v1/invite",
            headers={
                "apikey": settings.supabase_service_role_key,
                "Authorization": f"Bearer {settings.supabase_service_role_key}",
                "Content-Type": "application/json",
            },
            json={"email": email},
        )
    if resp.status_code >= 400:
        raise SupabaseAdminError(f"Failed to invite {email}: {resp.status_code} {resp.text}")
    return resp.json()["id"]


async def ban_auth_user(auth_user_id: str) -> None:
    """Disables sign-in for an offboarded employee's auth account, without
    deleting it -- deleting would cascade-orphan anything still referencing
    auth.users(id) and this is meant to be reversible (rehire).
    """
    settings = get_settings()
    async with httpx.AsyncClient() as client:
        resp = await client.put(
            f"{settings.supabase_url}/auth/v1/admin/users/{auth_user_id}",
            headers={
                "apikey": settings.supabase_service_role_key,
                "Authorization": f"Bearer {settings.supabase_service_role_key}",
                "Content-Type": "application/json",
            },
            json={"ban_duration": "876000h"},  # ~100 years -- effectively indefinite, but reversible
        )
    if resp.status_code >= 400:
        raise SupabaseAdminError(f"Failed to ban auth user {auth_user_id}: {resp.status_code} {resp.text}")
