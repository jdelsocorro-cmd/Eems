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
            # redirect_to must also be present in the Supabase project's
            # Auth > URL Configuration > Redirect URLs allowlist, or
            # Supabase silently falls back to the project's default Site
            # URL instead -- found the hard way when the very first real
            # invite (not a test fixture with email_confirm=true, which
            # skips this path entirely) landed on an unrelated localhost
            # app that happened to be running on the default Site URL's port.
            params={"redirect_to": f"{settings.frontend_url}/accept-invite"},
            json={"email": email},
        )
    if resp.status_code >= 400:
        raise SupabaseAdminError(f"Failed to invite {email}: {resp.status_code} {resp.text}")
    return resp.json()["id"]


async def generate_screenshot_signed_url(object_path: str, expires_in: int = 300) -> str:
    """Short-lived signed URL for a support-ticket screenshot in the private
    support-screenshots bucket (035_support_tickets.sql) -- the bucket has no
    select policy at all, so this service-role call (bypasses RLS, same as
    every other use of the service_role key in this module) is the only way
    to ever read one back, and only a caller who already passed the
    support_tickets.review permission check gets to call it.
    """
    settings = get_settings()
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{settings.supabase_url}/storage/v1/object/sign/support-screenshots/{object_path}",
            headers={
                "apikey": settings.supabase_service_role_key,
                "Authorization": f"Bearer {settings.supabase_service_role_key}",
                "Content-Type": "application/json",
            },
            json={"expiresIn": expires_in},
        )
    if resp.status_code >= 400:
        raise SupabaseAdminError(f"Failed to sign screenshot URL for {object_path}: {resp.status_code} {resp.text}")
    signed_path = resp.json()["signedURL"]
    return f"{settings.supabase_url}/storage/v1{signed_path}"


async def send_password_recovery(email: str) -> None:
    """Calls Supabase Auth's public recovery endpoint -- sends the same
    "reset your password" email a self-service Forgot Password link would,
    with a redirect back to /reset-password (which reuses AcceptInvite's
    set-a-new-password form: both an invite link and a recovery link land a
    session-carrying token in the URL, so the same "you're now authenticated
    as this user, set a password" flow already works for either).

    /auth/v1/recover only needs an apikey, not admin privilege -- using the
    service_role key here anyway, purely for consistency with every other
    call in this module (all of which do need it), not because this
    endpoint requires it.
    """
    settings = get_settings()
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{settings.supabase_url}/auth/v1/recover",
            headers={
                "apikey": settings.supabase_service_role_key,
                "Authorization": f"Bearer {settings.supabase_service_role_key}",
                "Content-Type": "application/json",
            },
            params={"redirect_to": f"{settings.frontend_url}/reset-password"},
            json={"email": email},
        )
    if resp.status_code >= 400:
        raise SupabaseAdminError(f"Failed to send password recovery to {email}: {resp.status_code} {resp.text}")


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
