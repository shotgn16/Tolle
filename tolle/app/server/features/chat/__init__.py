"""Bible chat: talk about life, faith or a passage and get wise, biblical answers – a conversation, not a study."""
import time

from fastapi import APIRouter, Body, Depends, HTTPException

from ...core import db, jobs
from ...core.auth import User, current_user
from ...core.crypto import dec, enc
from .. import Feature
from . import prompts

SCHEMA = """
CREATE TABLE IF NOT EXISTS chat_threads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title_enc TEXT,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id INTEGER NOT NULL,
    role TEXT NOT NULL,              -- user | ai
    content_enc TEXT,
    created_at REAL NOT NULL
);
"""

HISTORY_CHARS = 24000   # how much of a long conversation the AI is shown (the most recent part)

router = APIRouter(prefix="/api/chat", tags=["chat"])


def _thread(user_id: int, tid: int):
    t = db.q1("SELECT * FROM chat_threads WHERE id=? AND user_id=?", (tid, user_id))
    if not t:
        raise HTTPException(404, "Conversation not found.")
    return t


def _add(tid: int, role: str, text: str) -> int:
    now = time.time()
    mid = db.ex("INSERT INTO chat_messages(thread_id,role,content_enc,created_at) VALUES(?,?,?,?)", (tid, role, enc(text), now))
    db.ex("UPDATE chat_threads SET updated_at=? WHERE id=?", (now, tid))
    return mid


@router.get("")
def chat_list(user: User = Depends(current_user)):
    out = []
    for t in db.q("SELECT * FROM chat_threads WHERE user_id=? ORDER BY updated_at DESC", (user.id,)):
        last = db.q1("SELECT content_enc, role FROM chat_messages WHERE thread_id=? ORDER BY id DESC LIMIT 1", (t["id"],))
        out.append({"id": t["id"], "title": dec(t["title_enc"]), "updated_at": t["updated_at"], "created_at": t["created_at"],
                    "last": (dec(last["content_enc"]) or "")[:140] if last else ""})
    return out


@router.get("/starters")
def chat_starters(user: User = Depends(current_user)):
    return prompts.STARTERS


@router.post("")
def chat_create(body: dict = Body(...), user: User = Depends(current_user)):
    text = (body.get("content") or "").strip()
    if not text:
        raise HTTPException(400, "Write something first.")
    now = time.time()
    tid = db.ex("INSERT INTO chat_threads(user_id,title_enc,created_at,updated_at) VALUES(?,?,?,?)",
                (user.id, enc(prompts.title_for(text)), now, now))
    _add(tid, "user", text)
    return {"id": tid, "job": jobs.create(user.id, "chat_reply", {"thread_id": tid, **jobs.ai_overrides(body)})}


@router.get("/{tid}")
def chat_get(tid: int, user: User = Depends(current_user)):
    t = _thread(user.id, tid)
    msgs = [{"id": m["id"], "role": m["role"], "content": dec(m["content_enc"]), "created_at": m["created_at"]}
            for m in db.q("SELECT * FROM chat_messages WHERE thread_id=? ORDER BY id", (tid,))]
    return {"id": tid, "title": dec(t["title_enc"]), "messages": msgs}


@router.post("/{tid}/message")
def chat_message(tid: int, body: dict = Body(...), user: User = Depends(current_user)):
    _thread(user.id, tid)
    text = (body.get("content") or "").strip()
    if not text:
        raise HTTPException(400, "Write something first.")
    _add(tid, "user", text)
    return {"job": jobs.create(user.id, "chat_reply", {"thread_id": tid, **jobs.ai_overrides(body)})}


@router.post("/{tid}/retry")
def chat_retry(tid: int, body: dict = Body(default={}), user: User = Depends(current_user)):
    """Ask again: drop the last AI reply (if any) and answer the last message afresh."""
    _thread(user.id, tid)
    last = db.q1("SELECT id, role FROM chat_messages WHERE thread_id=? ORDER BY id DESC LIMIT 1", (tid,))
    if last and last["role"] == "ai":
        db.ex("DELETE FROM chat_messages WHERE id=?", (last["id"],))
    return {"job": jobs.create(user.id, "chat_reply", {"thread_id": tid, **jobs.ai_overrides(body)})}


@router.patch("/{tid}")
def chat_rename(tid: int, body: dict = Body(...), user: User = Depends(current_user)):
    _thread(user.id, tid)
    title = (body.get("title") or "").strip()
    if title:
        db.ex("UPDATE chat_threads SET title_enc=? WHERE id=?", (enc(title[:120]), tid))
    return {"ok": True}


@router.delete("/{tid}")
def chat_delete(tid: int, user: User = Depends(current_user)):
    if db.q1("SELECT 1 FROM chat_threads WHERE id=? AND user_id=?", (tid, user.id)):
        db.ex("DELETE FROM chat_messages WHERE thread_id=?", (tid,))
        db.ex("DELETE FROM chat_threads WHERE id=?", (tid,))
    return {"ok": True}


# ---------------------------------------------------------------- AI job
def history_for(messages: list[dict], budget: int = HISTORY_CHARS) -> list[dict]:
    """The most recent part of the conversation that fits the budget, starting with something the person said."""
    out, used = [], 0
    for m in reversed(messages):
        used += len(m["content"])
        if out and used > budget:
            break
        out.append(m)
    out.reverse()
    while out and out[0]["role"] != "user":
        out.pop(0)
    return out


def prep_reply(user_id, params, cfg, progress):
    tid = int(params["thread_id"])
    _thread(user_id, tid)
    rows = db.q("SELECT role, content_enc FROM chat_messages WHERE thread_id=? ORDER BY id", (tid,))
    msgs = [{"role": "assistant" if r["role"] == "ai" else "user", "content": dec(r["content_enc"]) or ""} for r in rows]
    budget = min(HISTORY_CHARS, int(cfg.get("ai.context_chars") or HISTORY_CHARS))
    return [{"role": "system", "content": prompts.chat_system(cfg.get("study.perspective") or "")}, *history_for(msgs, budget)], None, {}


def fin_reply(user_id, params, meta, text, thinking, model):
    tid = int(params["thread_id"])
    return {"thread_id": tid, "message_id": _add(tid, "ai", text)}


def summary(user_id: int) -> dict:
    t = db.q1("SELECT id, title_enc, updated_at FROM chat_threads WHERE user_id=? ORDER BY updated_at DESC LIMIT 1", (user_id,))
    return {"chat": {"recent": {"id": t["id"], "title": dec(t["title_enc"]), "updated_at": t["updated_at"]} if t else None}}


def _delete_user(conn, user_id: int) -> None:
    conn.execute("DELETE FROM chat_messages WHERE thread_id IN (SELECT id FROM chat_threads WHERE user_id=?)", (user_id,))
    conn.execute("DELETE FROM chat_threads WHERE user_id=?", (user_id,))


FEATURE = Feature(
    id="chat",
    name="Bible chat",
    description="Talk about life and faith, with wisdom from the Bible",
    router=router,
    schema=SCHEMA,
    jobs={"chat_reply": (prep_reply, fin_reply)},
    summary=summary,
    delete_user=_delete_user,
)
