from __future__ import annotations
import base64, hashlib
from cryptography.fernet import Fernet, InvalidToken
from app.core.config import settings

# C5: versioned envelopes ("v1:...") so the key can rotate without
# invalidating every stored token at once. Legacy rows (no prefix) still
# decrypt with the current key.
_VERSION = "v1"


def _derive_key(secret: str | None = None) -> bytes:
    digest = hashlib.sha256((secret if secret is not None else settings.SECRET_KEY).encode()).digest()
    return base64.urlsafe_b64encode(digest)


def _fernet() -> Fernet:
    # C5: build lazily — module-level Fernet went stale when SECRET_KEY
    # reloaded (tests, settings override).
    return Fernet(_derive_key())


def encrypt_token(plaintext: str) -> str:
    if not plaintext: return ""
    return f"{_VERSION}:" + _fernet().encrypt(plaintext.encode()).decode()


def decrypt_token(ciphertext: str | None) -> str | None:
    if not ciphertext: return None
    token = ciphertext
    if token.startswith(f"{_VERSION}:"):
        token = token[len(_VERSION) + 1:]
    # else: legacy unprefixed row — try current key as before.
    try: return _fernet().decrypt(token.encode()).decode()
    except (InvalidToken, ValueError): return None
