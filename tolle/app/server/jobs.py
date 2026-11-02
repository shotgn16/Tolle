"""Background AI jobs.

Long AI calls run in worker threads so the HTTP request (and Home Assistant
Ingress) never times out; the UI polls /api/ai/jobs/{id}.

Each job kind has:
  prepare(user_id, params, cfg, progress) -> (messages, images, meta)
  finish(user_id, params, meta, text, thinking, model) -> result dict

For the on-device provider the prepared messages are handed to the client
(status "client"), which runs the model locally and posts the answer back to
/api/ai/jobs/{id}/complete, where finish() runs as normal.
"""
import json
import time
import traceback
from concurrent.futures import ThreadPoolExecutor

from fastapi import HTTPException

from . import db, settings, sources, store
from .ai import prompts
from .ai.providers import AIError, chat
from .bible import parse_refs
from .crypto import dec, dec_json, enc
from .extract import image_b64_for_ai, is_image, pdf_pages_b64

EXECUTOR = ThreadPoolExecutor(max_workers=3, thread_name_prefix="ai")
LEVELS = set(prompts.LEVEL_GUIDE)


# ---------------------------------------------------------------- helpers
def _set(job_id: int, **fields) -> None:
    fields["updated_at"] = time.time()
    cols = ", ".join(f"{k}=?" for k in fields)
    db.ex(f"UPDATE jobs SET {cols} WHERE id=?", (*fields.values(), job_id))


def _ai_choice(cfg: dict, params: dict) -> tuple[str, str, bool]:
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


def _level(params) -> str:
    lv = params.get("level") or "study"
    return lv if lv in LEVELS else "study"


def _budget(cfg, provider) -> int:
    b = int(cfg.get("ai.context_chars") or 24000)
    return min(b, 9000) if provider == "ondevice" else b


def _suggest_refs(cfg, provider, model, subject: str) -> list[dict]:
    """Ask the model for key passages on a topic so sources can be fetched."""
    if provider == "ondevice":
        return []
    try:
        out = chat(cfg, provider, model, [
            {"role": "system", "content": "You list Bible references only."},
            {"role": "user", "content": f"List the 5 most important Bible passages for studying: {subject}\n"
                                        "Reply with references only, one per line, e.g. 'Romans 8:28-30'."},
        ], thinking=False, temperature=0.2)
        return parse_refs(out["text"], limit=5)
    except AIError:
        return []


def _sys(cfg) -> dict:
    return {"role": "system", "content": prompts.system_base(cfg.get("study.perspective") or "")}


def _source_meta(results) -> list[dict]:
    return [{"name": r["name"], "ref": r["ref"], "url": r["url"], "ok": r["ok"]} for r in results]


def _model_meta(meta, params, model, thinking_text):
    return {**meta, "model": model, "provider": params.get("_provider"), "level": params.get("level"),
            "thinking": thinking_text[:20000] if thinking_text else ""}


# ---------------------------------------------------------------- notes analysis
def prep_notes(user_id, params, cfg, progress):
    study = store.get_study(user_id, int(params["study_id"]))
    title = dec(study["title_enc"]) or "Study notes"
    parts = []
    for r in db.q("SELECT * FROM entries WHERE study_id=? AND (author='user' OR type='transcription') ORDER BY id",
                  (study["id"],)):
        e = store.entry_dict(r)
        parts.append(f"--- {e['title'] or e['type']} ---\n{e['content']}")
    for r in db.q("SELECT * FROM files WHERE study_id=? ORDER BY id", (study["id"],)):
        f = store.file_dict(r)
        if f["extracted"].strip():
            parts.append(f"--- File: {f['filename']} ---\n{f['extracted']}")
    notes = "\n\n".join(parts).strip()
    if not notes:
        raise AIError("This study has no readable notes yet. Add a note, upload a file, or use "
                      "'Transcribe with AI' on image files first.")
    notes = notes[:40000]
    refs = parse_refs(notes, limit=8)
    progress(f"Found {len(refs)} passage reference(s). Gathering sources…")
    provider = params["_provider"]
    results = sources.gather(refs, cfg["sources"], cfg["bible.translation"], _budget(cfg, provider), progress)
    msgs = [_sys(cfg), {"role": "user", "content": prompts.notes_analysis(
        title, notes, [r["display"] for r in refs], sources.format_for_prompt(results), _level(params))}]
    return msgs, None, {"sources": _source_meta(results), "refs": [r["display"] for r in refs]}


def fin_notes(user_id, params, meta, text, thinking, model):
    lvl = _level(params)
    eid = store.add_entry(user_id, int(params["study_id"]), "ai", "analysis",
                          f"AI analysis & comparison ({settings.LEVELS[lvl]})", text,
                          _model_meta(meta, params, model, thinking))
    return {"study_id": int(params["study_id"]), "entry_id": eid}


# ---------------------------------------------------------------- passage research
def prep_passage(user_id, params, cfg, progress):
    passages = (params.get("passages") or "").strip()
    focus = (params.get("focus") or "").strip()
    refs = parse_refs(passages + "\n" + focus, limit=8)
    if not refs:
        raise AIError("I couldn't recognise any Bible references. Try a format like 'John 3:1-16; Romans 8'.")
    provider = params["_provider"]
    results = sources.gather(refs, cfg["sources"], cfg["bible.translation"], _budget(cfg, provider), progress)
    msgs = [_sys(cfg), {"role": "user", "content": prompts.passage_study(
        ", ".join(r["display"] for r in refs), focus, _level(params), sources.format_for_prompt(results),
        params.get("purpose") or "", (params.get("notes") or "").strip())}]
    return msgs, None, {"sources": _source_meta(results), "refs": [r["display"] for r in refs]}


def fin_passage(user_id, params, meta, text, thinking, model):
    lvl = _level(params)
    purpose = prompts.PURPOSES.get(params.get("purpose") or "", ("", "", ""))[0]
    title = ", ".join(meta["refs"]) + (f" — {params['focus']}" if params.get("focus") else "")
    sid = int(params["study_id"]) if params.get("study_id") else store.create_study(
        user_id, "passage", title, {"passages": params.get("passages"), "focus": params.get("focus"), "level": lvl,
                                    "purpose": purpose})
    label = f"{purpose} notes" if purpose else "Passage study"
    eid = store.add_entry(user_id, sid, "ai", "research", f"{label} ({settings.LEVELS[lvl]})", text,
                          _model_meta(meta, params, model, thinking))
    return {"study_id": sid, "entry_id": eid}


# ---------------------------------------------------------------- insights
def prep_insight(user_id, params, cfg, progress):
    query = (params.get("query") or "").strip()
    if not query:
        raise AIError("Please enter a passage, topic or area of life.")
    mode = params.get("mode") or "topic"
    provider, model = params["_provider"], params["_model"]
    refs = parse_refs(query, limit=6)
    if not refs:
        progress("Finding key passages…")
        refs = _suggest_refs(cfg, provider, model, query)
    results = sources.gather(refs, cfg["sources"], cfg["bible.translation"], _budget(cfg, provider), progress)
    msgs = [_sys(cfg), {"role": "user", "content": prompts.insight(
        mode, query, _level(params), sources.format_for_prompt(results))}]
    return msgs, None, {"sources": _source_meta(results), "refs": [r["display"] for r in refs]}


def fin_insight(user_id, params, meta, text, thinking, model):
    lvl = _level(params)
    sid = store.create_study(user_id, "insight", params["query"],
                             {"mode": params.get("mode"), "level": lvl, "query": params["query"]})
    eid = store.add_entry(user_id, sid, "ai", "insight", f"Insight ({settings.LEVELS[lvl]})", text,
                          _model_meta(meta, params, model, thinking))
    return {"study_id": sid, "entry_id": eid}


# ---------------------------------------------------------------- study builder
def prep_builder(user_id, params, cfg, progress):
    provider, model = params["_provider"], params["_model"]
    refs = parse_refs(params.get("passages") or "", limit=6)
    if not refs and params.get("theme"):
        progress("Looking for suitable passages…")
        refs = _suggest_refs(cfg, provider, model, params["theme"])
    results = sources.gather(refs, cfg["sources"], cfg["bible.translation"], _budget(cfg, provider), progress)
    msgs = [_sys(cfg), {"role": "user", "content": prompts.builder(params, sources.format_for_prompt(results))}]
    return msgs, None, {"sources": _source_meta(results), "refs": [r["display"] for r in refs]}


def fin_builder(user_id, params, meta, text, thinking, model):
    aud = prompts.AUDIENCES.get(params.get("audience"), params.get("audience") or "Study")
    title = params.get("title") or f"{aud.capitalize()}: {params.get('passages') or params.get('theme') or 'Study plan'}"
    sid = store.create_study(user_id, "plan", title, {k: params.get(k) for k in (
        "audience", "size", "duration", "sessions", "passages", "theme", "format", "notes", "level")})
    eid = store.add_entry(user_id, sid, "ai", "plan", "Study plan", text, _model_meta(meta, params, model, thinking))
    return {"study_id": sid, "entry_id": eid}


# ---------------------------------------------------------------- calling discernment
def _calling_history(user_id, session_id):
    s = db.q1("SELECT * FROM calling_sessions WHERE id=? AND user_id=?", (session_id, user_id))
    if not s:
        raise HTTPException(404, "Session not found.")
    msgs = db.q("SELECT * FROM calling_messages WHERE session_id=? AND role!='summary' ORDER BY id", (session_id,))
    return s, [{"role": "assistant" if m["role"] == "ai" else "user", "content": dec(m["content_enc"]) or ""}
               for m in msgs]


def prep_calling(user_id, params, cfg, progress):
    s, history = _calling_history(user_id, int(params["session_id"]))
    msgs = [{"role": "system", "content": prompts.calling_system(cfg.get("study.perspective") or "")}]
    if not history:
        msgs.append({"role": "user", "content": prompts.calling_opening(dec(s["focus_enc"]) or "")})
    else:
        msgs += history[-40:]
        if msgs[1]["role"] == "assistant":
            msgs.insert(1, {"role": "user", "content": "(Session start)"})
    return msgs, None, {}


def fin_calling(user_id, params, meta, text, thinking, model):
    sid = int(params["session_id"])
    mid = db.ex("INSERT INTO calling_messages(session_id,role,content_enc,created_at) VALUES(?,?,?,?)",
                (sid, "ai", enc(text), time.time()))
    db.ex("UPDATE calling_sessions SET updated_at=? WHERE id=?", (time.time(), sid))
    return {"session_id": sid, "message_id": mid}


def prep_calling_summary(user_id, params, cfg, progress):
    _, history = _calling_history(user_id, int(params["session_id"]))
    if len(history) < 2:
        raise AIError("Talk a little more before asking for a summary.")
    convo = "\n\n".join(f"{'GUIDE' if m['role'] == 'assistant' else 'ME'}: {m['content']}" for m in history)
    msgs = [{"role": "system", "content": prompts.calling_system(cfg.get("study.perspective") or "")},
            {"role": "user", "content": f"{prompts.calling_summary()}\n\n<CONVERSATION>\n{convo[-30000:]}\n</CONVERSATION>"}]
    return msgs, None, {}


def fin_calling_summary(user_id, params, meta, text, thinking, model):
    sid = int(params["session_id"])
    mid = db.ex("INSERT INTO calling_messages(session_id,role,content_enc,created_at) VALUES(?,?,?,?)",
                (sid, "summary", enc(text), time.time()))
    return {"session_id": sid, "message_id": mid}


# ---------------------------------------------------------------- AI transcription of images / scanned PDFs
def prep_transcribe(user_id, params, cfg, progress):
    if params["_provider"] == "ondevice":
        raise AIError("On-device models can't read images yet. Pick a vision model (e.g. Ollama gemma3/llava, "
                      "GPT-4o/5, Gemini or Claude) for transcription.")
    f, data = store.load_file(user_id, int(params["file_id"]))
    if is_image(f["filename"], f["mime"]):
        images = [image_b64_for_ai(data)]
    elif f["filename"].lower().endswith(".pdf"):
        images = pdf_pages_b64(data)
        if not images:
            raise AIError("PDF page rendering isn't available on this install.")
    else:
        raise AIError("Only images and PDFs can be transcribed.")
    msgs = [{"role": "user", "content": prompts.transcribe_image()}]
    return msgs, images, {"file_id": f["id"], "filename": f["filename"], "study_id": f["study_id"]}


def fin_transcribe(user_id, params, meta, text, thinking, model):
    db.ex("UPDATE files SET extracted_enc=? WHERE id=? AND user_id=?", (enc(text), meta["file_id"], user_id))
    eid = store.add_entry(user_id, meta["study_id"], "ai", "transcription", f"AI transcription of {meta['filename']}",
                          text, _model_meta(meta, params, model, thinking))
    return {"study_id": meta["study_id"], "entry_id": eid}


KINDS = {
    "notes_analyze": (prep_notes, fin_notes),
    "passage_study": (prep_passage, fin_passage),
    "insight": (prep_insight, fin_insight),
    "builder": (prep_builder, fin_builder),
    "calling_turn": (prep_calling, fin_calling),
    "calling_summary": (prep_calling_summary, fin_calling_summary),
    "transcribe": (prep_transcribe, fin_transcribe),
}


# ---------------------------------------------------------------- lifecycle
def create(user_id: int, kind: str, params: dict) -> int:
    if kind not in KINDS:
        raise HTTPException(400, f"Unknown job kind {kind}")
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
        provider, model, thinking = _ai_choice(cfg, params)
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
    _, fin = KINDS[r["kind"]]
    result = fin(user_id, params, meta, text, thinking, params.get("_model", "on-device"))
    _set(job_id, status="done", progress="Done", result_enc=enc(result))
    return get(user_id, job_id)


def fail_client(user_id: int, job_id: int, error: str) -> None:
    db.ex("UPDATE jobs SET status='error', error=?, updated_at=? WHERE id=? AND user_id=? AND status='client'",
          (error[:500], time.time(), job_id, user_id))
