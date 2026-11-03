"""Bible reader and reading tracker.

* The built-in Bible reader logs the chapters you open and how long you read.
* Reading done elsewhere can be logged by hand, shared from YouVersion, or measured as time in the
  YouVersion app (Home Assistant Companion sensors on Android, Shortcuts on iPhone).
* A daily reminder nudges you if you haven't read yet.
"""
import hmac

import httpx
from fastapi import APIRouter, Body, Depends, HTTPException, Request

from ...core import db, notify, settings, sources
from ...core.auth import User, current_user
from ...core.bible import BOOK_BY_NAME, normalise_book, parse_refs
from ...core.crypto import new_token
from .. import Feature
from . import tracker
from .youversion import bible_com_link

SCHEMA = """
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
CREATE INDEX IF NOT EXISTS idx_reading_user ON reading_sessions(user_id, started_at);
CREATE INDEX IF NOT EXISTS idx_app_user ON app_sessions(user_id, started_at);
"""

DEFAULTS = {
    "tracker.reminder_enabled": False,
    "tracker.reminder_time": "20:00",
    "tracker.timezone": "Europe/London",
    "tracker.timezone_auto": True,     # follow the device's time zone
    "tracker.daily_goal_minutes": 15,
    # Time in the YouVersion app (same approach as LifeHub):
    # Android – Home Assistant Companion "Last used app" (+ "Interactive") sensors
    "tracker.ha_app_sensors": [],      # e.g. ["sensor.pixel_8_last_used_app"]
    "tracker.app_match": "com.sirma.mobile.bible.android",
    "tracker.min_session_seconds": 45,
    "tracker.ask_after_session": True, # one "What did you read?" notification after a session
    # Tolle Android app only (optional plugin): other Bible apps whose usage time is measured
    "tracker.external_apps": [{"name": "YouVersion", "package": "com.sirma.mobile.bible.android"}],
}

router = APIRouter(prefix="/api", tags=["reading"])


# ---------------------------------------------------------------- Bible text
@router.get("/bible/chapter")
def bible_chapter(book: str, chapter: int, translation: str | None = None, user: User = Depends(current_user)):
    name = normalise_book(book) or book
    if name not in BOOK_BY_NAME:
        raise HTTPException(400, "Unknown book.")
    return sources.chapter(name, chapter, translation or settings.get(user.id, "bible.translation"))


# ---------------------------------------------------------------- tracking
@router.post("/tracker/app")
def tr_app(body: dict = Body(default={}), user: User = Depends(current_user)):
    return {"id": tracker.app_beat(user.id, body.get("id"), user.device_id)}


@router.post("/tracker/reading/start")
def tr_start(body: dict = Body(...), user: User = Depends(current_user)):
    return {"id": tracker.reading_start(user.id, body["book"], body["chapter"], user.device_id)}


@router.post("/tracker/reading/beat")
def tr_beat(body: dict = Body(...), user: User = Depends(current_user)):
    return {"id": tracker.reading_beat(user.id, body.get("id"), user.device_id)}


@router.post("/tracker/reading/manual")
def tr_manual(body: dict = Body(...), user: User = Depends(current_user)):
    return {"id": tracker.manual_log(user.id, body.get("book"), body.get("chapter") or 1, body.get("minutes") or 0,
                                     body.get("at"), body.get("note") or "", user.device_id)}


@router.post("/tracker/external")
def tr_external(body: dict = Body(...), user: User = Depends(current_user)):
    return tracker.external_usage(user.id, body.get("app", "Bible app"), float(body.get("minutes") or 0),
                                  body.get("book"), body.get("chapter"), user.device_id)


@router.get("/tracker/stats")
def tr_stats(days: int = 14, user: User = Depends(current_user)):
    return tracker.stats(user.id, max(1, min(days, 120)))


@router.delete("/tracker/reading/{rid}")
def tr_delete(rid: int, user: User = Depends(current_user)):
    tracker.delete_reading(user.id, rid)
    return {"ok": True}


# ---------------------------------------------------------------- YouVersion: Home Assistant sensors
@router.get("/tracker/ha-app-sensors")
def ha_app_sensors(user: User = Depends(current_user)):
    """Phones with the Companion app's 'Last used app' sensor."""
    conf = notify.ha_connection(user.id)
    if not conf:
        return {"sensors": []}
    base, token = conf
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


# ---------------------------------------------------------------- API key (Shortcuts, share sheet)
def api_key_user(request: Request) -> int:
    key = request.headers.get("x-api-key", "")
    if len(key) < 20:
        raise HTTPException(401, "Missing or invalid X-Api-Key header.")
    for u in db.q("SELECT id FROM users"):
        mine = settings.get(u["id"], "api.key") or ""
        if mine and hmac.compare_digest(mine, key):
            return u["id"]
    raise HTTPException(401, "Unknown API key.")


@router.get("/me/api-key")
def my_api_key(user: User = Depends(current_user)):
    key = settings.get(user.id, "api.key")
    if not key:
        key = new_token()
        settings.set_many(user.id, {"api.key": key})
    return {"key": key}


@router.post("/me/api-key")
def new_api_key(user: User = Depends(current_user)):
    key = new_token()
    settings.set_many(user.id, {"api.key": key})
    return {"key": key}


@router.post("/v1/bible/app")
def v1_bible_app(request: Request, body: dict = Body(...)):
    """iPhone Shortcuts automation: {"event": "opened" | "closed"} when the Bible app opens or closes."""
    uid = api_key_user(request)
    return tracker.bible_app_event(uid, str(body.get("event", "")).lower(), "ios:" + str(body.get("device", "iphone"))[:40])


@router.post("/v1/bible/read")
def v1_bible_read(request: Request, body: dict = Body(...)):
    """Share from YouVersion (or anything): {"reference": "John 3:16-18 NIV"} or a bible.com link."""
    uid = api_key_user(request)
    text = str(body.get("reference") or body.get("text") or "")
    refs = parse_refs(bible_com_link(text) or text)
    if not refs:
        raise HTTPException(400, "No Bible reference found in that text.")
    logged = []
    for r in refs[:5]:
        last = r.get("chapter_end") or r["chapter"]
        for ch in range(r["chapter"], last + 1):
            tracker.manual_log(uid, r["book"], ch, 0, None, f"shared: {r['display']}", None, "shared")
            logged.append(f"{r['book']} {ch}")
    return {"ok": True, "logged": logged}


def _delete_user(conn, user_id: int) -> None:
    conn.execute("DELETE FROM reading_sessions WHERE user_id=?", (user_id,))
    conn.execute("DELETE FROM app_sessions WHERE user_id=?", (user_id,))


FEATURE = Feature(
    id="reading",
    name="Bible & reading tracker",
    description="Bible reader, reading time, streaks, reminders and YouVersion tracking",
    router=router,
    schema=SCHEMA,
    settings=DEFAULTS,
    ticks=[tracker.reminder_tick, tracker.ha_app_tick],
    summary=lambda user_id: {"tracker": tracker.stats(user_id, 7)},
    delete_user=_delete_user,
)
