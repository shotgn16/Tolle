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
from .ai.providers import AIError, chat
from .bible import parse_refs
from .crypto import dec_json, enc

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
    """How many characters of source material to send to the model."""
    b = int(cfg.get("ai.context_chars") or 24000)
    return min(b, 9000) if provider == "ondevice" else b


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
    return {"role": "system", "content": prompts.system_base(cfg.get("study.perspective") or "")}


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


def _run(job_id: int, user_id: int, kind: str, params: dict) -> None:
    prep, fin = KINDS[kind]
    try:
        _set(job_id, status="running", progress="Preparing…")
        cfg = settings.get_all(user_id)
        provider, model, thinking = ai_choice(cfg, params)
        params.update(_provider=provider, _model=model, _thinking=thinking)
        messages, images, meta = prep(user_id, params, cfg, lambda m: _set(job_id, progress=m))
        if provider == "ondevice":
            _set(job_id, status="client", progress="Waiting for on-device model…",
                 params_enc=enc({**params, "_meta": meta}),
                 messages_enc=enc({"messages": messages, "model": model, "thinking": thinking}))
            return
        _set(job_id, progress=f"Thinking with {model}…" if thinking else f"Writing with {model}…")
        out = chat(cfg, provider, model, messages, images=images, thinking=thinking,
                   temperature=float(cfg.get("ai.temperature") or 0.6))
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
