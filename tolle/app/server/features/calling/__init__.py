"""Calling: a guided conversation of prayer, Scripture and reflection to help discern God's calling."""
import time

from fastapi import APIRouter, Body, Depends, HTTPException

from ...core import db, jobs
from ...core.ai.providers import AIError
from ...core.auth import User, current_user
from ...core.crypto import dec, enc
from .. import Feature
from . import prompts

SCHEMA = """
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
"""

router = APIRouter(prefix="/api/calling", tags=["calling"])


@router.get("")
def calling_list(user: User = Depends(current_user)):
    return [{"id": r["id"], "title": dec(r["title_enc"]), "focus": dec(r["focus_enc"]), "status": r["status"],
             "created_at": r["created_at"], "updated_at": r["updated_at"]}
            for r in db.q("SELECT * FROM calling_sessions WHERE user_id=? ORDER BY updated_at DESC", (user.id,))]


@router.post("")
def calling_create(body: dict = Body(...), user: User = Depends(current_user)):
    now = time.time()
    title = body.get("title") or time.strftime("Reflection %d %b %Y")
    sid = db.ex("INSERT INTO calling_sessions(user_id,title_enc,focus_enc,created_at,updated_at) VALUES(?,?,?,?,?)",
                (user.id, enc(title), enc(body.get("focus") or ""), now, now))
    job = jobs.create(user.id, "calling_turn", {"session_id": sid, **jobs.ai_overrides(body)})
    return {"id": sid, "job": job}


@router.get("/{sid}")
def calling_get(sid: int, user: User = Depends(current_user)):
    s = db.q1("SELECT * FROM calling_sessions WHERE id=? AND user_id=?", (sid, user.id))
    if not s:
        raise HTTPException(404, "Session not found.")
    msgs = [{"id": m["id"], "role": m["role"], "content": dec(m["content_enc"]), "created_at": m["created_at"]}
            for m in db.q("SELECT * FROM calling_messages WHERE session_id=? ORDER BY id", (sid,))]
    return {"id": sid, "title": dec(s["title_enc"]), "focus": dec(s["focus_enc"]), "status": s["status"],
            "messages": msgs}


@router.post("/{sid}/message")
def calling_message(sid: int, body: dict = Body(...), user: User = Depends(current_user)):
    if not db.q1("SELECT 1 FROM calling_sessions WHERE id=? AND user_id=?", (sid, user.id)):
        raise HTTPException(404, "Session not found.")
    text = (body.get("content") or "").strip()
    if not text:
        raise HTTPException(400, "Write something first.")
    db.ex("INSERT INTO calling_messages(session_id,role,content_enc,created_at) VALUES(?,?,?,?)",
          (sid, "user", enc(text), time.time()))
    return {"job": jobs.create(user.id, "calling_turn", {"session_id": sid, **jobs.ai_overrides(body)})}


@router.post("/{sid}/summary")
def calling_summary(sid: int, body: dict = Body(default={}), user: User = Depends(current_user)):
    return {"job": jobs.create(user.id, "calling_summary", {"session_id": sid, **jobs.ai_overrides(body)})}


@router.delete("/{sid}")
def calling_delete(sid: int, user: User = Depends(current_user)):
    if db.q1("SELECT 1 FROM calling_sessions WHERE id=? AND user_id=?", (sid, user.id)):
        db.ex("DELETE FROM calling_messages WHERE session_id=?", (sid,))
        db.ex("DELETE FROM calling_sessions WHERE id=?", (sid,))
    return {"ok": True}


# ---------------------------------------------------------------- AI jobs
def _history(user_id, session_id):
    s = db.q1("SELECT * FROM calling_sessions WHERE id=? AND user_id=?", (session_id, user_id))
    if not s:
        raise HTTPException(404, "Session not found.")
    msgs = db.q("SELECT * FROM calling_messages WHERE session_id=? AND role!='summary' ORDER BY id", (session_id,))
    return s, [{"role": "assistant" if m["role"] == "ai" else "user", "content": dec(m["content_enc"]) or ""}
               for m in msgs]


def prep_turn(user_id, params, cfg, progress):
    s, history = _history(user_id, int(params["session_id"]))
    msgs = [{"role": "system", "content": prompts.calling_system(cfg.get("study.perspective") or "")}]
    if not history:
        msgs.append({"role": "user", "content": prompts.calling_opening(dec(s["focus_enc"]) or "")})
    else:
        msgs += history[-40:]
        if msgs[1]["role"] == "assistant":
            msgs.insert(1, {"role": "user", "content": "(Session start)"})
    return msgs, None, {}


def fin_turn(user_id, params, meta, text, thinking, model):
    sid = int(params["session_id"])
    mid = db.ex("INSERT INTO calling_messages(session_id,role,content_enc,created_at) VALUES(?,?,?,?)",
                (sid, "ai", enc(text), time.time()))
    db.ex("UPDATE calling_sessions SET updated_at=? WHERE id=?", (time.time(), sid))
    return {"session_id": sid, "message_id": mid}


def prep_summary(user_id, params, cfg, progress):
    _, history = _history(user_id, int(params["session_id"]))
    if len(history) < 2:
        raise AIError("Talk a little more before asking for a summary.")
    convo = "\n\n".join(f"{'GUIDE' if m['role'] == 'assistant' else 'ME'}: {m['content']}" for m in history)
    msgs = [{"role": "system", "content": prompts.calling_system(cfg.get("study.perspective") or "")},
            {"role": "user", "content": f"{prompts.calling_summary()}\n\n<CONVERSATION>\n{convo[-30000:]}\n</CONVERSATION>"}]
    return msgs, None, {}


def fin_summary(user_id, params, meta, text, thinking, model):
    sid = int(params["session_id"])
    mid = db.ex("INSERT INTO calling_messages(session_id,role,content_enc,created_at) VALUES(?,?,?,?)",
                (sid, "summary", enc(text), time.time()))
    return {"session_id": sid, "message_id": mid}


def _delete_user(conn, user_id: int) -> None:
    conn.execute("DELETE FROM calling_messages WHERE session_id IN (SELECT id FROM calling_sessions WHERE user_id=?)",
                 (user_id,))
    conn.execute("DELETE FROM calling_sessions WHERE user_id=?", (user_id,))


FEATURE = Feature(
    id="calling",
    name="Calling",
    description="Guided prayer and reflection to discern your calling",
    router=router,
    schema=SCHEMA,
    jobs={"calling_turn": (prep_turn, fin_turn), "calling_summary": (prep_summary, fin_summary)},
    delete_user=_delete_user,
)
