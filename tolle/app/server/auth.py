"""Username/password accounts, sessions and device detection."""
import time
from collections import defaultdict
from dataclasses import dataclass

from fastapi import Depends, HTTPException, Request

from . import db
from .config import SESSION_DAYS
from .crypto import enc, hash_password, new_token, token_hash, verify_password


@dataclass
class User:
    id: int
    username: str
    is_admin: bool
    device_id: str | None


# ---------- brute-force protection ----------
_failures: dict[str, list[float]] = defaultdict(list)
_WINDOW, _MAX_FAILS = 600, 8


def _check_rate(key: str) -> None:
    now = time.time()
    _failures[key] = [t for t in _failures[key] if now - t < _WINDOW]
    if len(_failures[key]) >= _MAX_FAILS:
        raise HTTPException(429, "Too many failed attempts. Try again in a few minutes.")


def client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else ""


def detect_platform(ua: str) -> str:
    u = ua.lower()
    if "home assistant" in u or "homeassistant" in u:
        return "Home Assistant app"
    if "capacitor" in u or "tolle-mobile" in u:
        return "Tolle mobile app"
    if "iphone" in u or "ipad" in u:
        return "iOS"
    if "android" in u:
        return "Android"
    if "mac os" in u:
        return "macOS"
    if "windows" in u:
        return "Windows"
    if "linux" in u:
        return "Linux"
    return "Unknown"


def touch_device(user_id: int, request: Request, device_id: str | None) -> None:
    if not device_id:
        return
    device_id = device_id[:64]
    ua = request.headers.get("user-agent", "")[:400]
    now = time.time()
    row = db.q1("SELECT id FROM devices WHERE id=? AND user_id=?", (device_id, user_id))
    if row:
        db.ex(
            "UPDATE devices SET last_seen=?, ip_enc=?, user_agent_enc=?, platform=? WHERE id=? AND user_id=?",
            (now, enc(client_ip(request)), enc(ua), detect_platform(ua), device_id, user_id),
        )
    else:
        name = request.headers.get("x-device-name") or detect_platform(ua)
        db.ex(
            "INSERT INTO devices(id,user_id,name_enc,user_agent_enc,platform,ip_enc,first_seen,last_seen,notify) "
            "VALUES(?,?,?,?,?,?,?,?,1)",
            (device_id, user_id, enc(name[:80]), enc(ua), detect_platform(ua), enc(client_ip(request)), now, now),
        )


# ---------- accounts ----------
def user_count() -> int:
    return db.q1("SELECT COUNT(*) AS n FROM users")["n"]


def create_user(username: str, password: str, is_admin: bool = False) -> int:
    username = username.strip()
    if len(username) < 2:
        raise HTTPException(400, "Username must be at least 2 characters.")
    if len(password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters.")
    if db.q1("SELECT id FROM users WHERE username=?", (username,)):
        raise HTTPException(409, "That username is taken.")
    return db.ex(
        "INSERT INTO users(username,pw_hash,is_admin,created_at) VALUES(?,?,?,?)",
        (username, hash_password(password), 1 if is_admin else 0, time.time()),
    )


def login(username: str, password: str, request: Request, device_id: str | None) -> str:
    key = f"{client_ip(request)}|{username.lower()}"
    _check_rate(key)
    row = db.q1("SELECT * FROM users WHERE username=?", (username.strip(),))
    if not row or not verify_password(password, row["pw_hash"]):
        _failures[key].append(time.time())
        raise HTTPException(401, "Incorrect username or password.")
    _failures.pop(key, None)
    token = new_token()
    now = time.time()
    db.ex(
        "INSERT INTO sessions(token_hash,user_id,device_id,created_at,expires_at) VALUES(?,?,?,?,?)",
        (token_hash(token), row["id"], device_id, now, now + SESSION_DAYS * 86400),
    )
    touch_device(row["id"], request, device_id)
    return token


def logout(token: str) -> None:
    db.ex("DELETE FROM sessions WHERE token_hash=?", (token_hash(token),))


def change_password(user_id: int, old: str, new: str) -> None:
    row = db.q1("SELECT pw_hash FROM users WHERE id=?", (user_id,))
    if not row or not verify_password(old, row["pw_hash"]):
        raise HTTPException(401, "Current password is incorrect.")
    if len(new) < 8:
        raise HTTPException(400, "Password must be at least 8 characters.")
    db.ex("UPDATE users SET pw_hash=? WHERE id=?", (hash_password(new), user_id))


def _bearer(request: Request) -> str | None:
    header = request.headers.get("authorization", "")
    if header.lower().startswith("bearer "):
        return header[7:].strip()
    return None


def current_user(request: Request) -> User:
    token = _bearer(request)
    if not token:
        raise HTTPException(401, "Not signed in.")
    row = db.q1(
        "SELECT s.user_id, s.expires_at, u.username, u.is_admin FROM sessions s "
        "JOIN users u ON u.id=s.user_id WHERE s.token_hash=?",
        (token_hash(token),),
    )
    if not row or row["expires_at"] < time.time():
        raise HTTPException(401, "Session expired. Please sign in again.")
    device_id = request.headers.get("x-device-id")
    touch_device(row["user_id"], request, device_id)
    return User(row["user_id"], row["username"], bool(row["is_admin"]), device_id)


def admin_user(user: User = Depends(current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(403, "Admin only.")
    return user
