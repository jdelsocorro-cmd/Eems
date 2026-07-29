from jose import JWTError, jwt

from app.core.config import get_settings

ALGORITHM = "HS256"


class InvalidTokenError(Exception):
    pass


def decode_supabase_jwt(token: str) -> dict:
    """Verify a Supabase Auth access token locally against the project's JWT
    secret (HS256). Returns the decoded claims (sub = auth.users.id).

    Note: this assumes the Supabase project uses the legacy HS256 shared
    secret signing method (the default). Projects that opt into asymmetric
    (RS256/ES256) signing keys need a JWKS-based verifier instead -- swap
    this function's implementation if that's ever the case, the rest of the
    app only depends on getting claims back out.
    """
    settings = get_settings()
    try:
        return jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=[ALGORITHM],
            audience="authenticated",
        )
    except JWTError as exc:
        raise InvalidTokenError(str(exc)) from exc
