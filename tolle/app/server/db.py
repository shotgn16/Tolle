"""SQLite storage. Sensitive columns end in _enc and hold Fernet ciphertext."""
import sqlite3
import threading
import time
from contextlib import contextmanager

from .config import DATA_DIR

DB_PATH = DATA_DIR / "tolle.db"
_lock = threading.RLock()

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL COLLATE NOCASE,
    pw_hash TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    device_id TEXT,
    created_at REAL NOT NULL,
    expires_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS devices (
    id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    name_enc TEXT,
    user_agent_enc TEXT,
    platform TEXT,
    ip_enc TEXT,
    first_seen REAL,
    last_seen REAL,
    notify INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (id, user_id)
);
CREATE TABLE IF NOT EXISTS settings (
    user_id INTEGER NOT NULL,
    key TEXT NOT NULL,
    value_enc TEXT,
    PRIMARY KEY (user_id, key)
);
CREATE TABLE IF NOT EXISTS studies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    kind TEXT NOT NULL,              -- notes | passage | insight | plan
    title_enc TEXT,
    meta_enc TEXT,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    study_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    author TEXT NOT NULL,            -- user | ai
    type TEXT NOT NULL,              -- note | upload | analysis | research | insight | plan | transcription
    title_enc TEXT,
    content_enc TEXT,
    meta_enc TEXT,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    study_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    filename_enc TEXT,
    mime TEXT,
    size INTEGER,
    path TEXT NOT NULL,
    extracted_enc TEXT,
    created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS calling_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title_enc TEXT,
    focus_enc TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS calling_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    role TEXT NOT NULL,              -- user | ai | summary
    content_enc TEXT,
    created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS reading_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    device_id TEXT,
    book TEXT,
    chapter INTEGER,
    started_at REAL NOT NULL,
    last_beat REAL NOT NULL,
    seconds INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'auto', -- auto | manual | external
    note_enc TEXT
);
CREATE TABLE IF NOT EXISTS app_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    device_id TEXT,
    started_at REAL NOT NULL,
    last_beat REAL NOT NULL,
    seconds INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    device_id TEXT,
    title_enc TEXT,
    body_enc TEXT,
    action TEXT,
    created_at REAL NOT NULL,
    delivered_at REAL,
    read_at REAL
);
CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,            -- queued | running | client | done | error
    params_enc TEXT,
    messages_enc TEXT,
    result_enc TEXT,
    error TEXT,
    progress TEXT,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS source_cache (
    url TEXT PRIMARY KEY,
    fetched_at REAL NOT NULL,
    ok INTEGER NOT NULL,
    text_enc TEXT
);
CREATE INDEX IF NOT EXISTS idx_entries_study ON entries(study_id);
CREATE INDEX IF NOT EXISTS idx_reading_user ON reading_sessions(user_id, started_at);
CREATE INDEX IF NOT EXISTS idx_app_user ON app_sessions(user_id, started_at);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, delivered_at);
"""


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=30, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


_conn = None


def conn() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        _conn = _connect()
    return _conn


@contextmanager
def tx():
    with _lock:
        c = conn()
        try:
            yield c
            c.commit()
        except Exception:
            c.rollback()
            raise


def q(sql: str, params=()) -> list[sqlite3.Row]:
    with _lock:
        return conn().execute(sql, params).fetchall()


def q1(sql: str, params=()):
    with _lock:
        return conn().execute(sql, params).fetchone()


def ex(sql: str, params=()) -> int:
    with tx() as c:
        cur = c.execute(sql, params)
        return cur.lastrowid


def init() -> None:
    with tx() as c:
        c.executescript(SCHEMA)
        # Jobs interrupted by a restart can never finish.
        c.execute(
            "UPDATE jobs SET status='error', error='Interrupted by restart', updated_at=? "
            "WHERE status IN ('queued','running')",
            (time.time(),),
        )
