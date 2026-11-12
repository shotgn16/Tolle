"""Background AI jobs – the engine every AI feature uses.

Long AI calls run in worker threads so the HTTP request (and Home Assistant Ingress) never times
out; the web app polls ``/api/ai/jobs/{id}``.

A feature registers job kinds as ``{"kind": (prepare, finish)}``:

    prepare(user_id, params, cfg, progress) -> (messages, images, meta)
        Build the chat messages. ``progress("text")`` updates the status line the user sees.
    finish(user_id, params, meta, text, thinking, model) -> dict
        Save the answer (usually as a purple AI note) and return ids for the web app.

For the on-device provider the prepared messages are handed to the browser/phone (status
"client"), which runs the model and posts the answer back to /api/ai/jobs/{id}/complete.

The helpers below (``ai_choice``, ``level``, ``budget`` …) are shared by the features.
"""
import time
import traceback
from concurrent.futures import ThreadPoolExecutor
from typing import Callable

from fastapi import HTTPException

from . import db, settings
from .ai import prompts, repetition
from .ai.providers import AIError, chat, out_tokens
from .bible import parse_refs
from .crypto import dec, dec_json, enc

EXECUTOR = ThreadPoolExecutor(max_workers=3, thread_name_prefix="ai")
KINDS: dict[str, tuple[Callable, Callable]] = {}
OWNER: dict[str, str] = {}   # job kind -> feature id


def register(kinds: dict[str, tuple[Callable, Callable]], feature_id: str | None = None) -> None:
    KINDS.update(kinds)
    if feature_id:
        OWNER.update({k: feature_id for k in kinds})


# ---------------------------------------------------------------- helpers for features
def ai_choice(cfg: dict, params: dict) -> tuple[str, str, bool]:
    provider = params.get("provider") or cfg["ai.provider"]
    if params.get("model"):
        model = params["model"]
    elif provider == "ondevice":
        model = cfg["ondevice.model"]
    else:
        model = cfg["ai.model"]
    thinking = params.get("thinking")
    if thinking is None:
        thinking = cfg["ai.thinking"]
    return provider, model, bool(thinking)


def level(params) -> str:
    lv = params.get("level") or "study"
    return lv if lv in prompts.LEVEL_GUIDE else "study"


def level_name(params) -> str:
    return settings.LEVELS[level(params)]


def budget(cfg, provider) -> int:
    """How many characters of source material to send to the model.

    The Source text budget setting, but never more than fits: for Ollama, what's left of the context window
    after the answer and the instructions (about 3.2 characters per token); on a phone, 9,000.
    """
    b = int(cfg.get("ai.context_chars") or 40000)
    if provider == "ondevice":
        return min(b, 9000)
    if provider == "ollama":
        from .ai.providers import out_tokens
        ctx = int(cfg.get("ollama.num_ctx") or 16384)
        fits = int((ctx - out_tokens(cfg) - 2500) * 3.2)
        return max(4000, min(b, fits))
    return b


def suggest_refs(cfg, provider, model, subject: str, n: int = 5) -> list[dict]:
    """Ask the model for key passages on a topic so sources can be fetched."""
    if provider == "ondevice":
        return []
    try:
        out = chat(cfg, provider, model, [
            {"role": "system", "content": "You list Bible references only."},
            {"role": "user", "content": f"List the {n} most important Bible passages for studying: {subject}\n"
                                        "Reply with references only, one per line, e.g. 'Romans 8:28-30'."},
        ], thinking=False, temperature=0.2)
        return parse_refs(out["text"], limit=n)
    except AIError:
        return []


def system_message(cfg) -> dict:
    return {"role": "system", "content": prompts.system_base(cfg.get("study.perspective") or "", prompts.compact(cfg))}


def source_meta(results) -> list[dict]:
    return [{"name": r["name"], "ref": r["ref"], "url": r["url"], "ok": r["ok"]} for r in results]


def model_meta(meta, params, model, thinking_text) -> dict:
    return {**meta, "model": model, "provider": params.get("_provider"), "level": params.get("level"),
            "thinking": thinking_text[:20000] if thinking_text else ""}


def ai_overrides(body: dict) -> dict:
    """Per-request provider/model/thinking choices sent by the model picker."""
    return {k: body[k] for k in ("provider", "model", "thinking") if body.get(k) is not None}


# ---------------------------------------------------------------- lifecycle
def _set(job_id: int, **fields) -> None:
    fields["updated_at"] = time.time()
    cols = ", ".join(f"{k}=?" for k in fields)
    db.ex(f"UPDATE jobs SET {cols} WHERE id=?", (*fields.values(), job_id))


def create(user_id: int, kind: str, params: dict) -> int:
    if kind not in KINDS:
        raise HTTPException(400, f"Unknown job kind {kind}")
    from .. import features
    if kind in OWNER and not features.is_enabled(OWNER[kind]):
        raise HTTPException(404, "This part of Tolle is switched off.")
    now = time.time()
    job_id = db.ex("INSERT INTO jobs(user_id,kind,status,params_enc,created_at,updated_at,progress) "
                   "VALUES(?,?,?,?,?,?,?)", (user_id, kind, "queued", enc(params), now, now, "Queued"))
    EXECUTOR.submit(_run, job_id, user_id, kind, params)
    return job_id


# What a task is about, for the Tasks screen: the first of these that the request has.
_SUBJECT_KEYS = ("title", "passages", "query", "theme", "focus", "filename")


def _run(job_id: int, user_id: int, kind: str, params: dict) -> None:
    prep, fin = KINDS[kind]
    try:
        _set(job_id, status="running", progress="Preparing…")
        cfg = settings.get_all(user_id)
        provider, model, thinking = ai_choice(cfg, params)
        params.update(_provider=provider, _model=model, _thinking=thinking)
        messages, images, meta = prep(user_id, params, cfg, lambda m: _set(job_id, progress=m))
        messages = prompts.adapt_messages(cfg, messages)
        if provider == "ondevice":
            _set(job_id, status="client", progress="Waiting for on-device model…",
                 params_enc=enc({**params, "_meta": meta}),
                 messages_enc=enc({"messages": messages, "model": model, "thinking": thinking,
                                   "max_tokens": out_tokens(cfg), "auto_continue": int(cfg.get("ai.auto_continue", 3) or 0)}))
            return
        _set(job_id, progress=f"Thinking with {model}…" if thinking else f"Writing with {model}…")
        out = chat(cfg, provider, model, messages, images=images, thinking=thinking,
                   temperature=float(cfg.get("ai.temperature") or 0.6), progress=lambda m: _set(job_id, progress=m))
        if not out["text"]:
            raise AIError("The model returned an empty answer.")
        result = fin(user_id, params, meta, out["text"], out.get("thinking", ""), model)
        _set(job_id, status="done", progress="Done", result_enc=enc(result))
    except (AIError, HTTPException) as exc:
        _set(job_id, status="error", error=str(getattr(exc, "detail", exc)))
    except Exception as exc:
        traceback.print_exc()
        _set(job_id, status="error", error=f"{type(exc).__name__}: {exc}")


def get(user_id: int, job_id: int) -> dict:
    r = db.q1("SELECT * FROM jobs WHERE id=? AND user_id=?", (job_id, user_id))
    if not r:
        raise HTTPException(404, "Job not found.")
    out = {"id": r["id"], "kind": r["kind"], "status": r["status"], "progress": r["progress"],
           "error": r["error"], "result": dec_json(r["result_enc"], None)}
    if r["status"] == "client":
        out["client"] = dec_json(r["messages_enc"], None)
    return out


def _subject(user_id: int, params: dict) -> str:
    for k in _SUBJECT_KEYS:
        v = str(params.get(k) or "").strip()
        if v:
            return v[:120]
    if params.get("study_id"):
        r = db.q1("SELECT title_enc FROM studies WHERE id=? AND user_id=?", (params["study_id"], user_id))
        if r:
            return _plain(r["title_enc"])[:120]
    if params.get("thread_id"):
        r = db.q1("SELECT title_enc FROM chat_threads WHERE id=? AND user_id=?", (params["thread_id"], user_id))
        if r:
            return _plain(r["title_enc"])[:120]
    if params.get("session_id"):
        r = db.q1("SELECT title_enc FROM calling_sessions WHERE id=? AND user_id=?", (params["session_id"], user_id))
        if r:
            return _plain(r["title_enc"])[:120]
    return ""


def _plain(value) -> str:
    try:
        return dec(value) or ""
    except Exception:
        return ""


def _link(kind: str, params: dict, result: dict | None) -> str:
    res = result or {}
    if res.get("thread_id") or kind.startswith("chat"):
        tid = res.get("thread_id") or params.get("thread_id")
        return f"#/chat/{tid}" if tid else ""
    if res.get("session_id") or kind.startswith("calling"):
        sid = res.get("session_id") or params.get("session_id")
        return f"#/calling/{sid}" if sid else ""
    sid = res.get("study_id") or params.get("study_id")
    return f"#/study/{sid}" if sid else ""


def list_jobs(user_id: int, limit: int = 40) -> list[dict]:
    """Recent AI tasks for the Tasks screen, newest first."""
    rows = db.q("SELECT * FROM jobs WHERE user_id=? AND hidden=0 AND created_at>? ORDER BY id DESC LIMIT ?",
                 (user_id, time.time() - 14 * 86400, limit))
    out = []
    for r in rows:
        status, error = r["status"], r["error"]
        params = dec_json(r["params_enc"], {}) or {}
        result = dec_json(r["result_enc"], None)
        out.append({"id": r["id"], "kind": r["kind"], "status": status, "progress": r["progress"], "error": error,
                    "subject": _subject(user_id, params), "link": _link(r["kind"], params, result) if status == "done" else "",
                    "created_at": r["created_at"], "updated_at": r["updated_at"]})
    return out


def dismiss(user_id: int, job_id: int | None = None) -> None:
    """Hide one finished task, or (job_id None) every finished task, from the Tasks screen."""
    if job_id is None:
        db.ex("UPDATE jobs SET hidden=1 WHERE user_id=? AND status IN ('done','error')", (user_id,))
    else:
        db.ex("UPDATE jobs SET hidden=1 WHERE id=? AND user_id=? AND status IN ('done','error')", (job_id, user_id))


def complete_client(user_id: int, job_id: int, text: str, thinking: str = "") -> dict:
    r = db.q1("SELECT * FROM jobs WHERE id=? AND user_id=?", (job_id, user_id))
    if not r or r["status"] != "client":
        raise HTTPException(409, "This job isn't waiting for an on-device answer.")
    if not text.strip():
        raise HTTPException(400, "Empty answer.")
    params = dec_json(r["params_enc"], {})
    meta = params.pop("_meta", {})
    text, changed = repetition.clean(text)
    if changed:
        text = text.rstrip() + ("\n\n*The model started repeating itself here, so Tolle cut the repeats. Try again or "
                                "choose a lower depth for a complete answer.*")
    _, fin = KINDS[r["kind"]]
    result = fin(user_id, params, meta, text, thinking, params.get("_model", "on-device"))
    _set(job_id, status="done", progress="Done", result_enc=enc(result))
    return get(user_id, job_id)


def fail_client(user_id: int, job_id: int, error: str) -> None:
    db.ex("UPDATE jobs SET status='error', error=?, updated_at=? WHERE id=? AND user_id=? AND status='client'",
          (error[:500], time.time(), job_id, user_id))
