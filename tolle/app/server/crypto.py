"""Encryption helpers.

* Every piece of user content (notes, AI output, uploads, settings, API keys,
  prayer/calling conversations) is encrypted at rest with Fernet
  (AES-128-CBC + HMAC-SHA256) using a master key stored in the data folder.
* Passwords are hashed with scrypt and a per-user salt.
* Session tokens are random 256-bit values; only their SHA-256 hash is stored.
"""
import base64
import hashlib
import hmac
import json
import os
import secrets
from typing import Any

from cryptography.fernet import Fernet, InvalidToken

from .config import DATA_DIR

_KEY_FILE = DATA_DIR / "secret.key"


def _load_key() -> bytes:
    env = os.environ.get("TOLLE_MASTER_KEY")
    if env:
        return env.encode()
    if _KEY_FILE.exists():
        return _KEY_FILE.read_bytes().strip()
    key = Fernet.generate_key()
    _KEY_FILE.write_bytes(key)
    try:
        os.chmod(_KEY_FILE, 0o600)
    except OSError:
        pass
    return key


_fernet = Fernet(_load_key())


def enc(value: Any) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        value = json.dumps(value)
    return _fernet.encrypt(value.encode("utf-8")).decode("ascii")


def dec(token: str | None) -> str | None:
    if token is None:
        return None
    try:
        return _fernet.decrypt(token.encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError):
        return None


def dec_json(token: str | None, default: Any = None) -> Any:
    raw = dec(token)
    if raw is None:
        return default
    try:
        return json.loads(raw)
    except ValueError:
        return default


def enc_bytes(data: bytes) -> bytes:
    return _fernet.encrypt(data)


def dec_bytes(data: bytes) -> bytes:
    return _fernet.decrypt(data)


# ---------- passwords ----------
_N, _R, _P = 2**14, 8, 1


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=32)
    return "scrypt${}${}${}${}${}".format(
        _N, _R, _P, base64.b64encode(salt).decode(), base64.b64encode(digest).decode()
    )


def verify_password(password: str, stored: str) -> bool:
    try:
        _, n, r, p, salt_b64, digest_b64 = stored.split("$")
        digest = hashlib.scrypt(
            password.encode(), salt=base64.b64decode(salt_b64),
            n=int(n), r=int(r), p=int(p), dklen=32,
        )
        return hmac.compare_digest(digest, base64.b64decode(digest_b64))
    except Exception:
        return False


# ---------- tokens ----------
def new_token() -> str:
    return secrets.token_urlsafe(32)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()
