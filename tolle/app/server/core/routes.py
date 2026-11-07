"""Core API: accounts, settings, AI, devices, notifications and the dashboard.

Feature-specific endpoints live with each feature in ``server/features/<id>/``.
"""
from fastapi import APIRouter, Body, Depends, HTTPException, Request

from .. import features
from . import auth, db, jobs, notify, settings, sources
from .ai.providers import ONDEVICE_MODELS, PROVIDERS, AIError, list_models
from .auth import User, admin_user, current_user
from .bible import books_payload, parse_refs
from .config import APP_NAME, IS_ADDON, RUN_MODE, VERSION
from .crypto import dec, enc
from .extract import HAS_PDF_RENDER, HAS_TESSERACT

router = APIRouter(prefix="/api")


# ================================================================ app & accounts
@router.get("/health")
def health():
    return {"ok": True, "version": VERSION}


@router.get("/features")
def feature_list():
    """Features installed on this server. The app only shows the enabled ones."""
    off = features.disabled()
    return [{"id": f.id, "name": f.name, "description": f.description, "enabled": f.id not in off,
             "essential": f.essential}
            for f in features.load()]


@router.put("/admin/features")
def feature_switch(body: dict = Body(...), user: User = Depends(admin_user)):
    features.set_disabled(list(body.get("disabled", [])))
    return feature_list()


@router.get("/admin/instructions")
def instructions_get(user: User = Depends(admin_user)):
    from .ai import instructions
    return instructions.listing()


@router.put("/admin/instructions")
def instructions_put(body: dict = Body(...), user: User = Depends(admin_user)):
    from .ai import instructions
    instructions.save(body)
    return instructions.listing()


@router.get("/auth/status")
def auth_status():
    return {"needs_setup": auth.user_count() == 0, "app": APP_NAME, "version": VERSION, "addon": IS_ADDON,
            "mode": RUN_MODE}


@router.post("/auth/setup")
def auth_setup(request: Request, body: dict = Body(...)):
    if auth.user_count() > 0:
        raise HTTPException(403, "Setup already completed.")
    auth.create_user(body.get("username", ""), body.get("password", ""), is_admin=True)
    token = auth.login(body["username"], body["password"], request, request.headers.get("x-device-id"))
    return {"token": token}


@router.post("/auth/login")
def auth_login(request: Request, body: dict = Body(...)):
    token = auth.login(body.get("username", ""), body.get("password", ""), request, request.headers.get("x-device-id"))
    return {"token": token}


@router.post("/auth/logout")
def auth_logout(request: Request, user: User = Depends(current_user)):
    auth.logout(request.headers.get("authorization", "")[7:])
    return {"ok": True}


@router.get("/me")
def me(user: User = Depends(current_user)):
    return {"id": user.id, "username": user.username, "is_admin": user.is_admin, "device_id": user.device_id}


@router.post("/me/password")
def change_pw(body: dict = Body(...), user: User = Depends(current_user)):
    auth.change_password(user.id, body.get("old", ""), body.get("new", ""))
    return {"ok": True}


@router.get("/users")
def users_list(user: User = Depends(admin_user)):
    return [{"id": r["id"], "username": r["username"], "is_admin": bool(r["is_admin"]), "created_at": r["created_at"]}
            for r in db.q("SELECT * FROM users ORDER BY id")]


@router.post("/users")
def users_create(body: dict = Body(...), user: User = Depends(admin_user)):
    uid = auth.create_user(body.get("username", ""), body.get("password", ""), bool(body.get("is_admin")))
    return {"id": uid}


@router.delete("/users/{uid}")
def users_delete(uid: int, user: User = Depends(admin_user)):
    if uid == user.id:
        raise HTTPException(400, "You can't delete yourself.")
    with db.tx() as c:
        for f in features.load():
            if f.delete_user:
                f.delete_user(c, uid)
        for t in ("sessions", "devices", "settings", "notifications", "jobs"):
            c.execute(f"DELETE FROM {t} WHERE user_id=?", (uid,))
        c.execute("DELETE FROM users WHERE id=?", (uid,))
    return {"ok": True}


# ================================================================ settings & AI
@router.get("/settings")
def settings_get(user: User = Depends(current_user)):
    return {"values": settings.public(user.id), "levels": settings.LEVELS, "providers": PROVIDERS,
            "default_sources": settings.DEFAULT_SOURCES, "addon": IS_ADDON, "mode": RUN_MODE,
            "ocr": {"tesseract": HAS_TESSERACT, "pdf_render": HAS_PDF_RENDER}}


@router.put("/settings")
def settings_put(body: dict = Body(...), user: User = Depends(current_user)):
    settings.set_many(user.id, body)
    return {"values": settings.public(user.id)}


@router.get("/ai/models")
def ai_models(provider: str | None = None, user: User = Depends(current_user)):
    cfg = settings.get_all(user.id)
    provider = provider or cfg["ai.provider"]
    try:
        return {"provider": provider, "models": list_models(cfg, provider)}
    except AIError as exc:
        raise HTTPException(502, str(exc))
    except Exception as exc:
        raise HTTPException(502, f"Couldn't reach {PROVIDERS.get(provider, provider)}: {exc}")


@router.get("/ai/ondevice-models")
def ai_ondevice_models():
    return ONDEVICE_MODELS


@router.post("/ai/jobs")
def ai_job_create(body: dict = Body(...), user: User = Depends(current_user)):
    kind = body.pop("kind", "")
    return {"id": jobs.create(user.id, kind, body)}


@router.get("/ai/jobs")
def ai_job_list(user: User = Depends(current_user)):
    return jobs.list_jobs(user.id)


@router.post("/ai/jobs/clear")
def ai_job_clear(user: User = Depends(current_user)):
    jobs.dismiss(user.id)
    return {"ok": True}


@router.delete("/ai/jobs/{job_id}")
def ai_job_dismiss(job_id: int, user: User = Depends(current_user)):
    jobs.dismiss(user.id, job_id)
    return {"ok": True}


@router.get("/ai/jobs/{job_id}")
def ai_job_get(job_id: int, user: User = Depends(current_user)):
    return jobs.get(user.id, job_id)


@router.post("/ai/jobs/{job_id}/complete")
def ai_job_complete(job_id: int, body: dict = Body(...), user: User = Depends(current_user)):
    return jobs.complete_client(user.id, job_id, body.get("text", ""), body.get("thinking", ""))


@router.post("/ai/jobs/{job_id}/fail")
def ai_job_fail(job_id: int, body: dict = Body(...), user: User = Depends(current_user)):
    jobs.fail_client(user.id, job_id, body.get("error", "On-device model failed"))
    return {"ok": True}


# ================================================================ Bible references & sources
@router.get("/bible/books")
def bible_books():
    return books_payload()


@router.get("/bible/parse")
def bible_parse(text: str):
    return parse_refs(text)


@router.post("/sources/test")
def sources_test(body: dict = Body(...), user: User = Depends(current_user)):
    refs = parse_refs(body.get("ref") or "John 3:16")
    if not refs:
        raise HTTPException(400, "Enter a valid reference.")
    res = sources.gather(refs[:1], [dict(body["source"], enabled=True)], settings.get(user.id, "bible.translation"),
                         4000)
    return [{"url": r["url"], "ok": r["ok"], "preview": r["text"][:500]} for r in res]


# ================================================================ devices & notifications
@router.get("/devices")
def devices_list(user: User = Depends(current_user)):
    return [{"id": r["id"], "name": dec(r["name_enc"]), "platform": r["platform"], "ip": dec(r["ip_enc"]),
             "user_agent": dec(r["user_agent_enc"]), "first_seen": r["first_seen"], "last_seen": r["last_seen"],
             "notify": bool(r["notify"]), "this_device": r["id"] == user.device_id}
            for r in db.q("SELECT * FROM devices WHERE user_id=? ORDER BY last_seen DESC", (user.id,))]


@router.patch("/devices/{did}")
def devices_update(did: str, body: dict = Body(...), user: User = Depends(current_user)):
    if "name" in body:
        db.ex("UPDATE devices SET name_enc=? WHERE id=? AND user_id=?", (enc(body["name"][:80]), did, user.id))
    if "notify" in body:
        db.ex("UPDATE devices SET notify=? WHERE id=? AND user_id=?", (1 if body["notify"] else 0, did, user.id))
    return {"ok": True}


@router.delete("/devices/{did}")
def devices_delete(did: str, user: User = Depends(current_user)):
    db.ex("DELETE FROM devices WHERE id=? AND user_id=?", (did, user.id))
    db.ex("DELETE FROM sessions WHERE device_id=? AND user_id=?", (did, user.id))
    return {"ok": True}


@router.post("/devices/{did}/test")
def devices_test(did: str, user: User = Depends(current_user)):
    notify.send(user.id, f"{APP_NAME} test", "Notifications are working on this device.", "#/settings", device_id=did)
    return {"ok": True}


@router.get("/notifications/pending")
def notif_pending(user: User = Depends(current_user)):
    return notify.pending(user.id, user.device_id)


@router.post("/notifications/test")
def notif_test(user: User = Depends(current_user)):
    errors = notify.send(user.id, f"{APP_NAME} test", "This is a test notification.", "#/settings")
    return {"ok": not errors, "errors": errors}


@router.get("/notifications/ha-services")
def notif_ha_services(user: User = Depends(current_user)):
    try:
        return {"services": notify.ha_notify_services(user.id), "addon": IS_ADDON}
    except Exception as exc:
        raise HTTPException(502, f"Couldn't reach Home Assistant: {exc}")


# ================================================================ connecting phones
@router.get("/server/pairing")
def pairing(request: Request, user: User = Depends(current_user)):
    """Addresses phones can use to reach this server, each with a QR code for the Tolle app."""
    from urllib.parse import quote

    import qrcode
    import qrcode.image.svg

    from .config import HOST, PORT
    urls: list[str] = []
    if RUN_MODE not in ("personal",) and HOST != "127.0.0.1":
        from ..installer.system import lan_addresses
        urls = [f"http://{ip}:{PORT}" for ip in lan_addresses()]
    seen = f"{request.url.scheme}://{request.url.netloc}"
    if not any(h in seen for h in ("127.0.0.1", "localhost")) and "/api/hassio_ingress" not in str(request.url):
        urls.insert(0, seen)
    out = []
    for u in dict.fromkeys(urls):
        img = qrcode.make(f"tolle://connect?server={quote(u, safe='')}", image_factory=qrcode.image.svg.SvgPathImage,
                          box_size=10, border=1)
        out.append({"url": u, "svg": img.to_string(encoding="unicode")})
    return {"mode": RUN_MODE, "addresses": out}


# ================================================================ dashboard
@router.get("/dashboard")
def dashboard(user: User = Depends(current_user)):
    out: dict = {}
    off = features.disabled()
    for f in features.load():
        if f.summary and f.id not in off:
            out.update(f.summary(user.id))
    cfg = settings.get_all(user.id)
    out["ai"] = {"provider": cfg["ai.provider"],
                 "model": cfg["ondevice.model"] if cfg["ai.provider"] == "ondevice" else cfg["ai.model"],
                 "thinking": cfg["ai.thinking"]}
    return out
