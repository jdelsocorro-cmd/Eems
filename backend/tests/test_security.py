"""Verifies app.core.security actually validates ES256-signed tokens the way
Supabase's new asymmetric JWT signing keys produce them -- this is new,
previously-untested code (swapped in after discovering the target Supabase
project uses JWKS, not a static HS256 secret), so it gets a real test rather
than just an import check.
"""

import os

os.environ.setdefault("SUPABASE_URL", "https://placeholder.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "placeholder")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "placeholder")
os.environ.setdefault("SUPABASE_DB_URL", "postgresql+asyncpg://user:pass@localhost:5432/postgres")

import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from jwt import PyJWK

from app.core import security  # noqa: E402


@pytest.fixture
def keypair():
    private_key = ec.generate_private_key(ec.SECP256R1())
    return private_key, private_key.public_key()


def _make_token(private_key, kid="test-key-1", **claim_overrides):
    claims = {
        "sub": "11111111-1111-1111-1111-111111111111",
        "aud": "authenticated",
        "role": "authenticated",
        "exp": int(time.time()) + 3600,
        **claim_overrides,
    }
    return jwt.encode(claims, private_key, algorithm="ES256", headers={"kid": kid})


def _patch_jwk_client(monkeypatch, public_key, kid="test-key-1"):
    """Stands in for the real PyJWKClient network fetch -- returns the given
    public key regardless of URL, so the test exercises decode_supabase_jwt's
    own logic without hitting the network.
    """
    jwk = PyJWK.from_json(
        __import__("json").dumps(
            {
                "kty": "EC",
                "crv": "P-256",
                "kid": kid,
                "use": "sig",
                "alg": "ES256",
                "x": _b64(public_key.public_numbers().x),
                "y": _b64(public_key.public_numbers().y),
            }
        )
    )

    class FakeJWKClient:
        def get_signing_key_from_jwt(self, token):
            return jwk

    monkeypatch.setattr(security, "_jwk_client", lambda: FakeJWKClient())


def _b64(number: int) -> str:
    import base64

    byte_length = 32
    raw = number.to_bytes(byte_length, "big")
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def test_valid_es256_token_decodes(monkeypatch, keypair):
    private_key, public_key = keypair
    _patch_jwk_client(monkeypatch, public_key)
    token = _make_token(private_key)

    claims = security.decode_supabase_jwt(token)

    assert claims["sub"] == "11111111-1111-1111-1111-111111111111"
    assert claims["role"] == "authenticated"


def test_expired_token_raises_invalid_token_error(monkeypatch, keypair):
    private_key, public_key = keypair
    _patch_jwk_client(monkeypatch, public_key)
    token = _make_token(private_key, exp=int(time.time()) - 10)

    with pytest.raises(security.InvalidTokenError):
        security.decode_supabase_jwt(token)


def test_token_signed_by_wrong_key_is_rejected(monkeypatch, keypair):
    _, public_key = keypair
    other_private_key = ec.generate_private_key(ec.SECP256R1())
    _patch_jwk_client(monkeypatch, public_key)  # client will offer the WRONG public key
    token = _make_token(other_private_key)  # signed by a different private key

    with pytest.raises(security.InvalidTokenError):
        security.decode_supabase_jwt(token)


def test_wrong_audience_is_rejected(monkeypatch, keypair):
    private_key, public_key = keypair
    _patch_jwk_client(monkeypatch, public_key)
    token = _make_token(private_key, aud="some-other-audience")

    with pytest.raises(security.InvalidTokenError):
        security.decode_supabase_jwt(token)
