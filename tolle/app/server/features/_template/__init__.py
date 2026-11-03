"""TEMPLATE – copy this folder to start a new feature.

1. Copy ``server/features/_template`` to ``server/features/<your_id>`` and
   ``web/features/_template`` to ``web/features/<your_id>``.
2. Change ``id`` below (and in the web ``index.js``) to ``<your_id>``.
3. Add ``"<your_id>"`` to ``ENABLED`` in ``server/features/__init__.py`` and import your
   ``index.js`` in ``web/features/index.js``.
4. Restart Tolle. Your screen appears in the menu.

This example is a tiny "prayer list": add requests, mark them answered, and ask the AI for a
short prayer. It shows each building block: a table, routes, a setting and an AI job.
"""
import time

from fastapi import APIRouter, Body, Depends, HTTPException

from ...core import db, jobs
from ...core.auth import User, current_user
from ...core.crypto import dec, enc
from .. import Feature

FEATURE_ID = "_template"

# 1. Database tables (columns ending in _enc hold encrypted text).
SCHEMA = """
CREATE TABLE IF NOT EXISTS prayer_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    text_enc TEXT,
    answered INTEGER NOT NULL DEFAULT 0,
    created_at REAL NOT NULL
);
"""

# 2. Settings with their defaults (read with core.settings.get(user_id, key)).
DEFAULTS = {"prayer.include_in_dashboard": True}

# 3. HTTP routes. Every route that touches user data should depend on current_user.
router = APIRouter(prefix="/api/prayer", tags=["prayer"])


@router.get("")
def list_requests(user: User = Depends(current_user)):
    return [{"id": r["id"], "text": dec(r["text_enc"]), "answered": bool(r["answered"])}
            for r in db.q("SELECT * FROM prayer_requests WHERE user_id=? ORDER BY id DESC", (user.id,))]


@router.post("")
def add_request(body: dict = Body(...), user: User = Depends(current_user)):
    text = (body.get("text") or "").strip()
    if not text:
        raise HTTPException(400, "Write a prayer request first.")
    rid = db.ex("INSERT INTO prayer_requests(user_id,text_enc,created_at) VALUES(?,?,?)",
                (user.id, enc(text), time.time()))
    return {"id": rid}


# 4. An AI job: prepare() builds the messages, finish() stores the answer and returns ids.
def prepare(user_id, params, cfg, progress):
    progress("Reading your prayer list…")
    items = [dec(r["text_enc"]) for r in db.q(
        "SELECT text_enc FROM prayer_requests WHERE user_id=? AND answered=0", (user_id,))]
    return [jobs.system_message(cfg),
            {"role": "user", "content": "Write a short prayer (under 150 words) covering:\n- " + "\n- ".join(items)}], None, {}


def finish(user_id, params, meta, text, thinking, model):
    return {"prayer": text}


FEATURE = Feature(
    id=FEATURE_ID,
    name="Prayer list (template)",
    description="Example feature – copy me",
    router=router,
    schema=SCHEMA,
    settings=DEFAULTS,
    jobs={"prayer_compose": (prepare, finish)},
    delete_user=lambda conn, uid: conn.execute("DELETE FROM prayer_requests WHERE user_id=?", (uid,)),
)
