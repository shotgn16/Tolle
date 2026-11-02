"""Tolle – HTTP API and static web app."""
import time
from collections import OrderedDict
from contextlib import asynccontextmanager

from fastapi import Body, Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from . import auth, db, jobs, notify, settings, sources, store, tracker
from .ai.providers import ONDEVICE_MODELS, PROVIDERS, AIError, list_models
from .auth import User, admin_user, current_user
from .bible import BOOK_BY_NAME, books_payload, normalise_book, parse_refs
from .config import APP_NAME, DEFAULT_CORS, EXTRA_CORS, IS_ADDON, MAX_UPLOAD_MB, VERSION, WEB_DIR
from .crypto import dec, enc
from .extract import HAS_PDFTOPPM, HAS_TESSERACT, extract_text, is_image

@asynccontextmanager
async def lifespan(_app):
    db.init()
    tracker.start_scheduler()
    yield


app = FastAPI(title=APP_NAME, version=VERSION, docs_url=None, redoc_url=None, lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=DEFAULT_CORS + EXTRA_CORS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["Authorization", "Content-Type", "X-Device-Id", "X-Device-Name"],
)

CSP = ("default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://esm.run https://cdn.jsdelivr.net; "
       "connect-src 'self' https:; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; "
       "worker-src 'self' blob:; font-src 'self' data:; frame-ancestors 'self'; base-uri 'self'; form-action 'self'")


@app.middleware("http")
async def security_headers(request: Request, call_next):
    resp = await call_next(request)
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("Referrer-Policy", "no-referrer")
    resp.headers.setdefault("Content-Security-Policy", CSP)
    if request.url.path.startswith("/api/"):
        resp.headers["Cache-Control"] = "no-store"
    return resp


@app.exception_handler(AIError)
async def _ai_error(_, exc: AIError):
    return JSONResponse({"detail": str(exc)}, status_code=502)


# ================================================================ auth
@app.get("/api/health")
def health():
    return {"ok": True, "version": VERSION}


@app.get("/api/auth/status")
def auth_status():
    return {"needs_setup": auth.user_count() == 0, "app": APP_NAME, "version": VERSION, "addon": IS_ADDON}


@app.post("/api/auth/setup")
def auth_setup(request: Request, body: dict = Body(...)):
    if auth.user_count() > 0:
        raise HTTPException(403, "Setup already completed.")
    auth.create_user(body.get("username", ""), body.get("password", ""), is_admin=True)
    token = auth.login(body["username"], body["password"], request, request.headers.get("x-device-id"))
    return {"token": token}


@app.post("/api/auth/login")
def auth_login(request: Request, body: dict = Body(...)):
    token = auth.login(body.get("username", ""), body.get("password", ""), request, request.headers.get("x-device-id"))
    return {"token": token}


@app.post("/api/auth/logout")
def auth_logout(request: Request, user: User = Depends(current_user)):
    auth.logout(request.headers.get("authorization", "")[7:])
    return {"ok": True}


@app.get("/api/me")
def me(user: User = Depends(current_user)):
    return {"id": user.id, "username": user.username, "is_admin": user.is_admin, "device_id": user.device_id}


@app.post("/api/me/password")
def change_pw(body: dict = Body(...), user: User = Depends(current_user)):
    auth.change_password(user.id, body.get("old", ""), body.get("new", ""))
    return {"ok": True}


@app.get("/api/users")
def users_list(user: User = Depends(admin_user)):
    return [{"id": r["id"], "username": r["username"], "is_admin": bool(r["is_admin"]), "created_at": r["created_at"]}
            for r in db.q("SELECT * FROM users ORDER BY id")]


@app.post("/api/users")
def users_create(body: dict = Body(...), user: User = Depends(admin_user)):
    uid = auth.create_user(body.get("username", ""), body.get("password", ""), bool(body.get("is_admin")))
    return {"id": uid}


@app.delete("/api/users/{uid}")
def users_delete(uid: int, user: User = Depends(admin_user)):
    if uid == user.id:
        raise HTTPException(400, "You can't delete yourself.")
    with db.tx() as c:
        for t in ("sessions", "devices", "settings", "notifications", "jobs", "reading_sessions", "app_sessions"):
            c.execute(f"DELETE FROM {t} WHERE user_id=?", (uid,))
        c.execute("DELETE FROM calling_messages WHERE session_id IN (SELECT id FROM calling_sessions WHERE user_id=?)",
                  (uid,))
        c.execute("DELETE FROM calling_sessions WHERE user_id=?", (uid,))
        c.execute("DELETE FROM users WHERE id=?", (uid,))
    for r in db.q("SELECT id FROM studies WHERE user_id=?", (uid,)):
        store.delete_study(uid, r["id"])
    return {"ok": True}


# ================================================================ settings & AI
@app.get("/api/settings")
def settings_get(user: User = Depends(current_user)):
    return {"values": settings.public(user.id), "levels": settings.LEVELS, "providers": PROVIDERS,
            "default_sources": settings.DEFAULT_SOURCES, "addon": IS_ADDON,
            "ocr": {"tesseract": HAS_TESSERACT, "pdf_render": HAS_PDFTOPPM}}


@app.put("/api/settings")
def settings_put(body: dict = Body(...), user: User = Depends(current_user)):
    settings.set_many(user.id, body)
    return {"values": settings.public(user.id)}


@app.get("/api/ai/models")
def ai_models(provider: str | None = None, user: User = Depends(current_user)):
    cfg = settings.get_all(user.id)
    provider = provider or cfg["ai.provider"]
    try:
        return {"provider": provider, "models": list_models(cfg, provider)}
    except AIError as exc:
        raise HTTPException(502, str(exc))
    except Exception as exc:
        raise HTTPException(502, f"Couldn't reach {PROVIDERS.get(provider, provider)}: {exc}")


@app.get("/api/ai/ondevice-models")
def ai_ondevice_models():
    return ONDEVICE_MODELS


@app.post("/api/ai/jobs")
def ai_job_create(body: dict = Body(...), user: User = Depends(current_user)):
    kind = body.pop("kind", "")
    return {"id": jobs.create(user.id, kind, body)}


@app.get("/api/ai/jobs/{job_id}")
def ai_job_get(job_id: int, user: User = Depends(current_user)):
    return jobs.get(user.id, job_id)


@app.post("/api/ai/jobs/{job_id}/complete")
def ai_job_complete(job_id: int, body: dict = Body(...), user: User = Depends(current_user)):
    return jobs.complete_client(user.id, job_id, body.get("text", ""), body.get("thinking", ""))


@app.post("/api/ai/jobs/{job_id}/fail")
def ai_job_fail(job_id: int, body: dict = Body(...), user: User = Depends(current_user)):
    jobs.fail_client(user.id, job_id, body.get("error", "On-device model failed"))
    return {"ok": True}


# ================================================================ studies (notes, passage studies, insights, plans)
@app.get("/api/studies")
def studies_list(kind: str | None = None, user: User = Depends(current_user)):
    sql, args = "SELECT * FROM studies WHERE user_id=?", [user.id]
    if kind:
        sql += " AND kind=?"
        args.append(kind)
    return [store.study_dict(r) for r in db.q(sql + " ORDER BY updated_at DESC LIMIT 500", args)]


@app.post("/api/studies")
def studies_create(body: dict = Body(...), user: User = Depends(current_user)):
    title = (body.get("title") or "").strip() or "Untitled study"
    sid = store.create_study(user.id, body.get("kind", "notes"), title, body.get("meta") or {})
    if body.get("content"):
        store.add_entry(user.id, sid, "user", "note", body.get("note_title") or "My notes", body["content"])
    return {"id": sid}


@app.get("/api/studies/{sid}")
def studies_get(sid: int, user: User = Depends(current_user)):
    s = store.study_dict(store.get_study(user.id, sid))
    s["entries"] = [store.entry_dict(r) for r in db.q("SELECT * FROM entries WHERE study_id=? ORDER BY id", (sid,))]
    s["files"] = [store.file_dict(r) for r in db.q("SELECT * FROM files WHERE study_id=? ORDER BY id", (sid,))]
    for f in s["files"]:
        f["preview"] = f.pop("extracted")[:600]
    return s


@app.patch("/api/studies/{sid}")
def studies_update(sid: int, body: dict = Body(...), user: User = Depends(current_user)):
    s = store.get_study(user.id, sid)
    meta = {**(store.study_dict(s, False)["meta"]), **(body.get("meta") or {})}
    db.ex("UPDATE studies SET title_enc=?, meta_enc=?, updated_at=? WHERE id=?",
          (enc(body.get("title") or dec(s["title_enc"])), enc(meta), time.time(), sid))
    return {"ok": True}


@app.delete("/api/studies/{sid}")
def studies_delete(sid: int, user: User = Depends(current_user)):
    store.delete_study(user.id, sid)
    return {"ok": True}


@app.post("/api/studies/{sid}/entries")
def entry_create(sid: int, body: dict = Body(...), user: User = Depends(current_user)):
    store.get_study(user.id, sid)
    eid = store.add_entry(user.id, sid, "user", "note", body.get("title") or "Note", body.get("content") or "")
    return {"id": eid}


@app.patch("/api/entries/{eid}")
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


@app.delete("/api/entries/{eid}")
def entry_delete(eid: int, user: User = Depends(current_user)):
    db.ex("DELETE FROM entries WHERE id=? AND user_id=?", (eid, user.id))
    return {"ok": True}


@app.post("/api/notes/upload")
async def notes_upload(
    files: list[UploadFile] = File(...),
    groups: list[str] = Form(default=[]),
    study_id: int | None = Form(default=None),
    user: User = Depends(current_user),
):
    """Bulk upload. Files sharing a group name become one study.

    mode "one study"      → every file has the same group
    mode "study per file" → every file has its own group
    custom                → the user edits group names (e.g. 1–2 documents per study)
    """
    cfg = settings.get_all(user.id)
    grouped: "OrderedDict[str, list[tuple[UploadFile, bytes]]]" = OrderedDict()
    for i, f in enumerate(files):
        data = await f.read()
        if len(data) > MAX_UPLOAD_MB * 1024 * 1024:
            raise HTTPException(413, f"{f.filename} is larger than {MAX_UPLOAD_MB} MB.")
        group = (groups[i] if i < len(groups) and groups[i].strip() else f.filename.rsplit(".", 1)[0]).strip()
        grouped.setdefault(group, []).append((f, data))

    created, job_ids = [], []
    auto_vision = cfg.get("ai.vision_transcribe") and cfg.get("ai.provider") != "ondevice" and cfg.get("ai.model")
    for group, items in grouped.items():
        sid = study_id or store.create_study(user.id, "notes", group[:200], {"source": "upload"})
        if study_id:
            store.get_study(user.id, study_id)
        for f, data in items:
            mime = f.content_type or ""
            text = extract_text(f.filename, mime, data)
            fid = store.save_file(user.id, sid, f.filename, mime, data, text)
            if auto_vision and (is_image(f.filename, mime) or (f.filename.lower().endswith(".pdf") and len(text) < 30)):
                job_ids.append(jobs.create(user.id, "transcribe", {"file_id": fid}))
        created.append(sid)
    return {"studies": created, "jobs": job_ids}


@app.get("/api/files/{fid}")
def file_download(fid: int, user: User = Depends(current_user)):
    f, data = store.load_file(user.id, fid)
    safe = f["filename"].replace('"', "")
    return Response(data, media_type=f["mime"] or "application/octet-stream",
                    headers={"Content-Disposition": f'inline; filename="{safe}"'})


@app.delete("/api/files/{fid}")
def file_delete(fid: int, user: User = Depends(current_user)):
    r = db.q1("SELECT * FROM files WHERE id=? AND user_id=?", (fid, user.id))
    if r:
        try:
            (store.FILES_DIR / r["path"]).unlink()
        except FileNotFoundError:
            pass
        db.ex("DELETE FROM files WHERE id=?", (fid,))
    return {"ok": True}


# ================================================================ Bible text & references
@app.get("/api/bible/books")
def bible_books():
    return books_payload()


@app.get("/api/bible/chapter")
def bible_chapter(book: str, chapter: int, translation: str | None = None, user: User = Depends(current_user)):
    name = normalise_book(book) or book
    if name not in BOOK_BY_NAME:
        raise HTTPException(400, "Unknown book.")
    return sources.chapter(name, chapter, translation or settings.get(user.id, "bible.translation"))


@app.get("/api/bible/parse")
def bible_parse(text: str):
    return parse_refs(text)


@app.post("/api/sources/test")
def sources_test(body: dict = Body(...), user: User = Depends(current_user)):
    refs = parse_refs(body.get("ref") or "John 3:16")
    if not refs:
        raise HTTPException(400, "Enter a valid reference.")
    res = sources.gather(refs[:1], [dict(body["source"], enabled=True)], settings.get(user.id, "bible.translation"),
                         4000)
    return [{"url": r["url"], "ok": r["ok"], "preview": r["text"][:500]} for r in res]


# ================================================================ calling discernment
@app.get("/api/calling")
def calling_list(user: User = Depends(current_user)):
    return [{"id": r["id"], "title": dec(r["title_enc"]), "focus": dec(r["focus_enc"]), "status": r["status"],
             "created_at": r["created_at"], "updated_at": r["updated_at"]}
            for r in db.q("SELECT * FROM calling_sessions WHERE user_id=? ORDER BY updated_at DESC", (user.id,))]


@app.post("/api/calling")
def calling_create(body: dict = Body(...), user: User = Depends(current_user)):
    now = time.time()
    title = body.get("title") or time.strftime("Reflection %d %b %Y")
    sid = db.ex("INSERT INTO calling_sessions(user_id,title_enc,focus_enc,created_at,updated_at) VALUES(?,?,?,?,?)",
                (user.id, enc(title), enc(body.get("focus") or ""), now, now))
    job = jobs.create(user.id, "calling_turn", {"session_id": sid, **_ai_overrides(body)})
    return {"id": sid, "job": job}


def _ai_overrides(body: dict) -> dict:
    return {k: body[k] for k in ("provider", "model", "thinking") if body.get(k) is not None}


@app.get("/api/calling/{sid}")
def calling_get(sid: int, user: User = Depends(current_user)):
    s = db.q1("SELECT * FROM calling_sessions WHERE id=? AND user_id=?", (sid, user.id))
    if not s:
        raise HTTPException(404, "Session not found.")
    msgs = [{"id": m["id"], "role": m["role"], "content": dec(m["content_enc"]), "created_at": m["created_at"]}
            for m in db.q("SELECT * FROM calling_messages WHERE session_id=? ORDER BY id", (sid,))]
    return {"id": sid, "title": dec(s["title_enc"]), "focus": dec(s["focus_enc"]), "status": s["status"],
            "messages": msgs}


@app.post("/api/calling/{sid}/message")
def calling_message(sid: int, body: dict = Body(...), user: User = Depends(current_user)):
    if not db.q1("SELECT 1 FROM calling_sessions WHERE id=? AND user_id=?", (sid, user.id)):
        raise HTTPException(404, "Session not found.")
    text = (body.get("content") or "").strip()
    if not text:
        raise HTTPException(400, "Write something first.")
    db.ex("INSERT INTO calling_messages(session_id,role,content_enc,created_at) VALUES(?,?,?,?)",
          (sid, "user", enc(text), time.time()))
    return {"job": jobs.create(user.id, "calling_turn", {"session_id": sid, **_ai_overrides(body)})}


@app.post("/api/calling/{sid}/summary")
def calling_summary(sid: int, body: dict = Body(default={}), user: User = Depends(current_user)):
    return {"job": jobs.create(user.id, "calling_summary", {"session_id": sid, **_ai_overrides(body)})}


@app.delete("/api/calling/{sid}")
def calling_delete(sid: int, user: User = Depends(current_user)):
    if db.q1("SELECT 1 FROM calling_sessions WHERE id=? AND user_id=?", (sid, user.id)):
        db.ex("DELETE FROM calling_messages WHERE session_id=?", (sid,))
        db.ex("DELETE FROM calling_sessions WHERE id=?", (sid,))
    return {"ok": True}


# ================================================================ tracker
@app.post("/api/tracker/app")
def tr_app(body: dict = Body(default={}), user: User = Depends(current_user)):
    return {"id": tracker.app_beat(user.id, body.get("id"), user.device_id)}


@app.post("/api/tracker/reading/start")
def tr_start(body: dict = Body(...), user: User = Depends(current_user)):
    return {"id": tracker.reading_start(user.id, body["book"], body["chapter"], user.device_id)}


@app.post("/api/tracker/reading/beat")
def tr_beat(body: dict = Body(...), user: User = Depends(current_user)):
    return {"id": tracker.reading_beat(user.id, body.get("id"), user.device_id)}


@app.post("/api/tracker/reading/manual")
def tr_manual(body: dict = Body(...), user: User = Depends(current_user)):
    return {"id": tracker.manual_log(user.id, body.get("book"), body.get("chapter") or 1, body.get("minutes") or 0,
                                     body.get("at"), body.get("note") or "", user.device_id)}


@app.post("/api/tracker/external")
def tr_external(body: dict = Body(...), user: User = Depends(current_user)):
    return tracker.external_usage(user.id, body.get("app", "Bible app"), float(body.get("minutes") or 0),
                                  body.get("book"), body.get("chapter"), user.device_id)


@app.get("/api/tracker/stats")
def tr_stats(days: int = 14, user: User = Depends(current_user)):
    return tracker.stats(user.id, max(1, min(days, 120)))


@app.delete("/api/tracker/reading/{rid}")
def tr_delete(rid: int, user: User = Depends(current_user)):
    tracker.delete_reading(user.id, rid)
    return {"ok": True}


# ================================================================ devices & notifications
@app.get("/api/devices")
def devices_list(user: User = Depends(current_user)):
    return [{"id": r["id"], "name": dec(r["name_enc"]), "platform": r["platform"], "ip": dec(r["ip_enc"]),
             "user_agent": dec(r["user_agent_enc"]), "first_seen": r["first_seen"], "last_seen": r["last_seen"],
             "notify": bool(r["notify"]), "this_device": r["id"] == user.device_id}
            for r in db.q("SELECT * FROM devices WHERE user_id=? ORDER BY last_seen DESC", (user.id,))]


@app.patch("/api/devices/{did}")
def devices_update(did: str, body: dict = Body(...), user: User = Depends(current_user)):
    if "name" in body:
        db.ex("UPDATE devices SET name_enc=? WHERE id=? AND user_id=?", (enc(body["name"][:80]), did, user.id))
    if "notify" in body:
        db.ex("UPDATE devices SET notify=? WHERE id=? AND user_id=?", (1 if body["notify"] else 0, did, user.id))
    return {"ok": True}


@app.delete("/api/devices/{did}")
def devices_delete(did: str, user: User = Depends(current_user)):
    db.ex("DELETE FROM devices WHERE id=? AND user_id=?", (did, user.id))
    db.ex("DELETE FROM sessions WHERE device_id=? AND user_id=?", (did, user.id))
    return {"ok": True}


@app.post("/api/devices/{did}/test")
def devices_test(did: str, user: User = Depends(current_user)):
    notify.send(user.id, "Tolle test", "Notifications are working on this device.", "#/settings", device_id=did)
    return {"ok": True}


@app.get("/api/notifications/pending")
def notif_pending(user: User = Depends(current_user)):
    return notify.pending(user.id, user.device_id)


@app.post("/api/notifications/test")
def notif_test(user: User = Depends(current_user)):
    errors = notify.send(user.id, "Tolle test", "This is a test notification.", "#/settings")
    return {"ok": not errors, "errors": errors}


@app.get("/api/notifications/ha-services")
def notif_ha_services(user: User = Depends(current_user)):
    try:
        return {"services": notify.ha_notify_services(user.id), "addon": IS_ADDON}
    except Exception as exc:
        raise HTTPException(502, f"Couldn't reach Home Assistant: {exc}")


# ================================================================ API key endpoints (iPhone Shortcuts, share sheet)
def api_key_user(request: Request) -> int:
    import hmac
    key = request.headers.get("x-api-key", "")
    if len(key) < 20:
        raise HTTPException(401, "Missing or invalid X-Api-Key header.")
    for u in db.q("SELECT id FROM users"):
        mine = settings.get(u["id"], "api.key") or ""
        if mine and hmac.compare_digest(mine, key):
            return u["id"]
    raise HTTPException(401, "Unknown API key.")


@app.get("/api/me/api-key")
def my_api_key(user: User = Depends(current_user)):
    key = settings.get(user.id, "api.key")
    if not key:
        from .crypto import new_token
        key = new_token()
        settings.set_many(user.id, {"api.key": key})
    return {"key": key}


@app.post("/api/me/api-key")
def new_api_key(user: User = Depends(current_user)):
    from .crypto import new_token
    key = new_token()
    settings.set_many(user.id, {"api.key": key})
    return {"key": key}


@app.post("/api/v1/bible/app")
def v1_bible_app(request: Request, body: dict = Body(...)):
    """iPhone Shortcuts automation: {"event": "opened" | "closed"} when the Bible app opens or closes."""
    uid = api_key_user(request)
    return tracker.bible_app_event(uid, str(body.get("event", "")).lower(), "ios:" + str(body.get("device", "iphone"))[:40])


@app.post("/api/v1/bible/read")
def v1_bible_read(request: Request, body: dict = Body(...)):
    """Share from YouVersion (or anything): {"reference": "John 3:16-18 NIV"} or a bible.com link."""
    uid = api_key_user(request)
    text = str(body.get("reference") or body.get("text") or "")
    refs = parse_refs(_bible_com_link(text) or text)
    if not refs:
        raise HTTPException(400, "No Bible reference found in that text.")
    logged = []
    for r in refs[:5]:
        last = r.get("chapter_end") or r["chapter"]
        for ch in range(r["chapter"], last + 1):
            tracker.manual_log(uid, r["book"], ch, 0, None, f"shared: {r['display']}", None, "shared")
            logged.append(f"{r['book']} {ch}")
    return {"ok": True, "logged": logged}


def _bible_com_link(text: str) -> str | None:
    """https://www.bible.com/bible/111/JHN.3.16-18.NIV → 'John 3:16-18'."""
    import re as _re
    m = _re.search(r"bible\.com/(?:[a-z-]+/)?bible/\d+/([1-3]?[A-Z]{2,3})\.(\d+)(?:\.(\d+)(?:-(\d+))?)?", text)
    if not m:
        return None
    usfm = {"GEN": "Genesis", "EXO": "Exodus", "LEV": "Leviticus", "NUM": "Numbers", "DEU": "Deuteronomy", "JOS": "Joshua",
            "JDG": "Judges", "RUT": "Ruth", "1SA": "1 Samuel", "2SA": "2 Samuel", "1KI": "1 Kings", "2KI": "2 Kings",
            "1CH": "1 Chronicles", "2CH": "2 Chronicles", "EZR": "Ezra", "NEH": "Nehemiah", "EST": "Esther", "JOB": "Job",
            "PSA": "Psalms", "PRO": "Proverbs", "ECC": "Ecclesiastes", "SNG": "Song of Solomon", "ISA": "Isaiah",
            "JER": "Jeremiah", "LAM": "Lamentations", "EZK": "Ezekiel", "DAN": "Daniel", "HOS": "Hosea", "JOL": "Joel",
            "AMO": "Amos", "OBA": "Obadiah", "JON": "Jonah", "MIC": "Micah", "NAM": "Nahum", "HAB": "Habakkuk",
            "ZEP": "Zephaniah", "HAG": "Haggai", "ZEC": "Zechariah", "MAL": "Malachi", "MAT": "Matthew", "MRK": "Mark",
            "LUK": "Luke", "JHN": "John", "ACT": "Acts", "ROM": "Romans", "1CO": "1 Corinthians", "2CO": "2 Corinthians",
            "GAL": "Galatians", "EPH": "Ephesians", "PHP": "Philippians", "COL": "Colossians", "1TH": "1 Thessalonians",
            "2TH": "2 Thessalonians", "1TI": "1 Timothy", "2TI": "2 Timothy", "TIT": "Titus", "PHM": "Philemon",
            "HEB": "Hebrews", "JAS": "James", "1PE": "1 Peter", "2PE": "2 Peter", "1JN": "1 John", "2JN": "2 John",
            "3JN": "3 John", "JUD": "Jude", "REV": "Revelation"}
    book = usfm.get(m.group(1))
    if not book:
        return None
    ref = f"{book} {m.group(2)}"
    if m.group(3):
        ref += f":{m.group(3)}" + (f"-{m.group(4)}" if m.group(4) else "")
    return ref


@app.get("/api/notifications/ha-app-sensors")
def ha_app_sensors(user: User = Depends(current_user)):
    """Phones with the Companion app's 'Last used app' sensor."""
    conf = notify._ha(user.id)
    if not conf:
        return {"sensors": []}
    base, token = conf
    import httpx
    try:
        r = httpx.get(f"{base}/states", headers={"Authorization": f"Bearer {token}"}, timeout=15)
        r.raise_for_status()
    except Exception as exc:
        raise HTTPException(502, f"Couldn't reach Home Assistant: {exc}")
    states = r.json()
    ids = {x["entity_id"] for x in states}
    out = []
    for x in states:
        eid = x["entity_id"]
        if eid.startswith("sensor.") and eid.endswith("_last_used_app"):
            device = eid.removeprefix("sensor.").removesuffix("_last_used_app")
            out.append({"entity_id": eid, "name": x.get("attributes", {}).get("friendly_name", eid),
                        "screen_sensor": f"binary_sensor.{device}_interactive" in ids})
    return {"sensors": sorted(out, key=lambda s: s["name"])}


# ================================================================ dashboard
@app.get("/api/dashboard")
def dashboard(user: User = Depends(current_user)):
    recent = [store.study_dict(r) for r in db.q(
        "SELECT * FROM studies WHERE user_id=? ORDER BY updated_at DESC LIMIT 6", (user.id,))]
    counts = {r["kind"]: r["n"] for r in db.q("SELECT kind, COUNT(*) n FROM studies WHERE user_id=? GROUP BY kind",
                                              (user.id,))}
    st = tracker.stats(user.id, 7)
    cfg = settings.get_all(user.id)
    return {"recent": recent, "counts": counts, "tracker": st,
            "ai": {"provider": cfg["ai.provider"],
                   "model": cfg["ondevice.model"] if cfg["ai.provider"] == "ondevice" else cfg["ai.model"],
                   "thinking": cfg["ai.thinking"]}}


# ================================================================ static web app
@app.get("/", include_in_schema=False)
def index():
    return FileResponse(WEB_DIR / "index.html", headers={"Cache-Control": "no-cache"})


app.mount("/", StaticFiles(directory=WEB_DIR), name="web")
