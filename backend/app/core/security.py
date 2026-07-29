from functools import lru_cache

import jwt
from jwt import PyJWKClient, PyJWTError

from app.core.config import get_settings

# Supabase's project-scoped JWKS -- exposes both the current asymmetric
# signing key (ES256) and, while any previously-issued tokens are still
# valid, the legacy shared secret re-published as a symmetric JWK. Either
# way, verification is: read `kid` from the token header, look up the
# matching key here, verify with it. No shared secret needs to be
# configured or stored by this app at all -- that's the whole point of the
# asymmetric key rotation Supabase project owners are moved onto.
JWKS_PATH = "/auth/v1/.well-known/jwks.json"
ALLOWED_ALGORITHMS = ["ES256", "HS256"]
# PyJWT's default leeway is 0, which validates iat/exp/nbf against this
# machine's clock with zero tolerance. Supabase's servers and this machine
# are two independent clocks (even NTP-synced ones drift by a few seconds),
# so zero leeway means a token can fail as "not yet valid" purely from
# ordinary clock skew, not an actual problem with the token. 60s is the
# conventional tolerance for this.
CLOCK_SKEW_LEEWAY_SECONDS = 60


class InvalidTokenError(Exception):
    pass


@lru_cache
def _jwk_client() -> PyJWKClient:
    settings = get_settings()
    # PyJWKClient caches fetched keys in-process (default lifespan 300s) and
    # only fetches the specific key needed for the presented token's `kid`,
    # not every rotation on every request.
    #
    # The apikey header is required -- Supabase's Kong gateway gates
    # /auth/v1/* behind it like every other Auth API route, including jwks.
    # It's still just the public anon/publishable key, not a secret; this
    # isn't a credential PyJWKClient needs to keep safe, only a gateway
    # admission check.
    return PyJWKClient(
        f"{settings.supabase_url}{JWKS_PATH}",
        cache_keys=True,
        headers={"apikey": settings.supabase_anon_key},
    )


def decode_supabase_jwt(token: str) -> dict:
    """Verify a Supabase Auth access token against the project's published
    JWKS (asymmetric ES256 for current tokens, or the legacy HS256 shared
    secret re-published as a symmetric JWK for tokens issued before this
    project's key rotation -- see JWKS_PATH above). Returns the decoded
    claims (sub = auth.users.id).
    """
    try:
        signing_key = _jwk_client().get_signing_key_from_jwt(token)
        return jwt.decode(
            token,
            signing_key.key,
            algorithms=ALLOWED_ALGORITHMS,
            audience="authenticated",
            leeway=CLOCK_SKEW_LEEWAY_SECONDS,
        )
    except PyJWTError as exc:
        raise InvalidTokenError(str(exc)) from exc
