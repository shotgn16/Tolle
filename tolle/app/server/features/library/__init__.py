"""Study library: your studies, notes and uploaded files, plus AI analysis and transcription.

Other features (passage study, insights, study builder) save their results into the same library,
so this feature also provides the generic study and note endpoints they rely on.
"""
import time
from collections import OrderedDict

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response

from ...core import db, jobs, settings, sources, store
from ...core.ai import prompts as core_prompts
from ...core.ai.providers import AIError
from ...core.auth import User, current_user
from ...core.bible import parse_refs
from ...core.config import MAX_UPLOAD_MB
from ...core.crypto import dec, enc
from ...core.extract import extract_text, image_b64_for_ai, is_image, pdf_pages_b64
from .. import Feature
from . import prompts

router = APIRouter(prefix="/api", tags=["library"])


# ---------------------------------------------------------------- studies & notes
@router.get("/studies")
def studies_list(kind: str | None = None, user: User = Depends(current_user)):
    sql, args = "SELECT * FROM studies WHERE user_id=?", [user.id]
    if kind:
        sql += " AND kind=?"
        args.append(kind)
    return [store.study_dict(r) for r in db.q(sql + " ORDER BY updated_at DESC LIMIT 500", args)]


@router.post("/studies")
def studies_create(body: dict = Body(...), user: User = Depends(current_user)):
    title = (body.get("title") or "").strip() or "Untitled study"
    sid = store.create_study(user.id, body.get("kind", "notes"), title, body.get("meta") or {})
    if body.get("content"):
        store.add_entry(user.id, sid, "user", "note", body.get("note_title") or "My notes", body["content"])
    return {"id": sid}


@router.get("/studies/{sid}")
def studies_get(sid: int, user: User = Depends(current_user)):
    s = store.study_dict(store.get_study(user.id, sid))
    s["entries"] = [store.entry_dict(r) for r in db.q("SELECT * FROM entries WHERE study_id=? ORDER BY id", (sid,))]
    s["files"] = [store.file_dict(r) for r in db.q("SELECT * FROM files WHERE study_id=? ORDER BY id", (sid,))]
    for f in s["files"]:
        f["preview"] = f.pop("extracted")[:600]
    return s


@router.patch("/studies/{sid}")
def studies_update(sid: int, body: dict = Body(...), user: User = Depends(current_user)):
    s = store.get_study(user.id, sid)
    meta = {**(store.study_dict(s, False)["meta"]), **(body.get("meta") or {})}
    db.ex("UPDATE studies SET title_enc=?, meta_enc=?, updated_at=? WHERE id=?",
          (enc(body.get("title") or dec(s["title_enc"])), enc(meta), time.time(), sid))
    return {"ok": True}


@router.delete("/studies/{sid}")
def studies_delete(sid: int, user: User = Depends(current_user)):
    store.delete_study(user.id, sid)
    return {"ok": True}


@router.post("/studies/{sid}/entries")
def entry_create(sid: int, body: dict = Body(...), user: User = Depends(current_user)):
    store.get_study(user.id, sid)
    eid = store.add_entry(user.id, sid, "user", "note", body.get("title") or "Note", body.get("content") or "")
    return {"id": eid}


@router.patch("/entries/{eid}")
def entry_update(eid: int, body: dict = Body(...), user: User = Depends(current_user)):
    r = db.q1("SELECT * FROM entries WHERE id=? AND user_id=?", (eid, user.id))
    if not r:
        raise HTTPException(404, "Entry not found.")
    if r["author"] == "ai" and "content" in body:
        raise HTTPException(400, "AI notes are kept as generated. Copy the text into your own note to edit it.")
    db.ex("UPDATE entries SET title_enc=?, content_enc=?, updated_at=? WHERE id=?",
          (enc(body.get("title", dec(r["title_enc"]))), enc(body.get("content", dec(r["content_enc"]))),
           time.time(), eid))
    store.touch_study(r["study_id"])
    return {"ok": True}


@router.delete("/entries/{eid}")
def entry_delete(eid: int, user: User = Depends(current_user)):
    db.ex("DELETE FROM entries WHERE id=? AND user_id=?", (eid, user.id))
    return {"ok": True}


# ---------------------------------------------------------------- uploads
@router.post("/notes/upload")
async def notes_upload(
    files: list[UploadFile] = File(...),
    groups: list[str] = Form(default=[]),
    study_id: int | None = Form(default=None),
    user: User = Depends(current_user),
):
    """Bulk upload. Files that share a group name become one study."""
    cfg = settings.get_all(user.id)
    grouped: "OrderedDict[str, list[tuple[UploadFile, bytes]]]" = OrderedDict()
    for i, f in enumerate(files):
        data = await f.read()
        if len(data) > MAX_UPLOAD_MB * 1024 * 1024:
            raise HTTPException(413, f"{f.filename} is larger than {MAX_UPLOAD_MB} MB.")
        group = (groups[i] if i < len(groups) and groups[i].strip() else f.filename.rsplit(".", 1)[0]).strip()
        grouped.setdefault(group, []).append((f, data))

    if study_id:
        store.get_study(user.id, study_id)
    created, job_ids = [], []
    auto_vision = cfg.get("ai.vision_transcribe") and cfg.get("ai.provider") != "ondevice" and cfg.get("ai.model")
    for group, items in grouped.items():
        sid = study_id or store.create_study(user.id, "notes", group[:200], {"source": "upload"})
        for f, data in items:
            mime = f.content_type or ""
            text = extract_text(f.filename, mime, data)
            fid = store.save_file(user.id, sid, f.filename, mime, data, text)
            if auto_vision and (is_image(f.filename, mime) or (f.filename.lower().endswith(".pdf") and len(text) < 30)):
                job_ids.append(jobs.create(user.id, "transcribe", {"file_id": fid}))
        if sid not in created:
            created.append(sid)
    return {"studies": created, "jobs": job_ids}


@router.get("/files/{fid}")
def file_download(fid: int, user: User = Depends(current_user)):
    f, data = store.load_file(user.id, fid)
    safe = f["filename"].replace('"', "")
    return Response(data, media_type=f["mime"] or "application/octet-stream",
                    headers={"Content-Disposition": f'inline; filename="{safe}"'})


@router.delete("/files/{fid}")
def file_delete(fid: int, user: User = Depends(current_user)):
    r = db.q1("SELECT * FROM files WHERE id=? AND user_id=?", (fid, user.id))
    if r:
        try:
            (store.FILES_DIR / r["path"]).unlink()
        except FileNotFoundError:
            pass
        db.ex("DELETE FROM files WHERE id=?", (fid,))
    return {"ok": True}


# ---------------------------------------------------------------- AI: analyse notes
def prep_analyze(user_id, params, cfg, progress):
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
    results = sources.gather(refs, cfg["sources"], cfg["bible.translation"],
                             jobs.budget(cfg, params["_provider"]), progress)
    msgs = [jobs.system_message(cfg), {"role": "user", "content": prompts.notes_analysis(
        title, notes, [r["display"] for r in refs], sources.format_for_prompt(results), jobs.level(params))}]
    return msgs, None, {"sources": jobs.source_meta(results), "refs": [r["display"] for r in refs]}


def fin_analyze(user_id, params, meta, text, thinking, model):
    eid = store.add_entry(user_id, int(params["study_id"]), "ai", "analysis",
                          f"AI analysis & comparison ({jobs.level_name(params)})", text,
                          jobs.model_meta(meta, params, model, thinking))
    return {"study_id": int(params["study_id"]), "entry_id": eid}


# ---------------------------------------------------------------- AI: read images / scanned PDFs
def prep_transcribe(user_id, params, cfg, progress):
    if params["_provider"] == "ondevice":
        raise AIError("On-device models can't read images yet. Pick a vision model (e.g. Ollama gemma3, "
                      "GPT-4o/5, Gemini or Claude) for transcription.")
    f, data = store.load_file(user_id, int(params["file_id"]))
    if is_image(f["filename"], f["mime"]):
        images = [image_b64_for_ai(data)]
    elif f["filename"].lower().endswith(".pdf"):
        images = pdf_pages_b64(data)
        if not images:
            raise AIError("This PDF's pages couldn't be rendered.")
    else:
        raise AIError("Only images and PDFs can be transcribed.")
    msgs = [{"role": "user", "content": core_prompts.transcribe_image()}]
    return msgs, images, {"file_id": f["id"], "filename": f["filename"], "study_id": f["study_id"]}


def fin_transcribe(user_id, params, meta, text, thinking, model):
    db.ex("UPDATE files SET extracted_enc=? WHERE id=? AND user_id=?", (enc(text), meta["file_id"], user_id))
    eid = store.add_entry(user_id, meta["study_id"], "ai", "transcription", f"AI transcription of {meta['filename']}",
                          text, jobs.model_meta(meta, params, model, thinking))
    return {"study_id": meta["study_id"], "entry_id": eid}


def _summary(user_id: int) -> dict:
    recent = [store.study_dict(r) for r in db.q(
        "SELECT * FROM studies WHERE user_id=? ORDER BY updated_at DESC LIMIT 6", (user_id,))]
    counts = {r["kind"]: r["n"] for r in db.q(
        "SELECT kind, COUNT(*) n FROM studies WHERE user_id=? GROUP BY kind", (user_id,))}
    return {"recent": recent, "counts": counts}


def _delete_user(conn, user_id: int) -> None:
    for r in conn.execute("SELECT id FROM studies WHERE user_id=?", (user_id,)).fetchall():
        store.delete_study(user_id, r["id"])


FEATURE = Feature(
    id="library",
    name="Study notes",
    description="Write and upload study notes; AI analysis and transcription. Every study is saved here, "
                "so this one is always on.",
    essential=True,
    router=router,
    jobs={"notes_analyze": (prep_analyze, fin_analyze), "transcribe": (prep_transcribe, fin_transcribe)},
    summary=_summary,
    delete_user=_delete_user,
)
