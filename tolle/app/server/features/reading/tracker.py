"""Bible reading & app-time tracking, the daily reminder and time in the YouVersion app."""
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import HTTPException

from ...core import db, notify, settings
from ...core.bible import BOOK_BY_NAME, normalise_book
from ...core.crypto import dec, enc

GAP = 180      # a heartbeat later than this starts a new session
MAX_STEP = 90  # never credit more than this per heartbeat


def _tz(user_id: int) -> ZoneInfo:
    try:
        return ZoneInfo(settings.get(user_id, "tracker.timezone") or "UTC")
    except Exception:
        return ZoneInfo("UTC")


def _beat(table: str, user_id: int, session_id: int | None, device_id: str | None, extra: dict | None = None) -> int:
    now = time.time()
    if session_id:
        r = db.q1(f"SELECT * FROM {table} WHERE id=? AND user_id=?", (session_id, user_id))
        if r and now - r["last_beat"] < GAP:
            step = min(MAX_STEP, now - r["last_beat"])
            db.ex(f"UPDATE {table} SET last_beat=?, seconds=seconds+? WHERE id=?", (now, int(step), session_id))
            return session_id
        if r and table == "reading_sessions":
            # resume the same chapter after a gap → new session for the same chapter
            extra = {"book": r["book"], "chapter": r["chapter"]}
    if table == "app_sessions":
        return db.ex("INSERT INTO app_sessions(user_id,device_id,started_at,last_beat,seconds) VALUES(?,?,?,?,0)",
                     (user_id, device_id, now, now))
    if not extra:
        raise HTTPException(400, "Missing book/chapter.")
    return db.ex("INSERT INTO reading_sessions(user_id,device_id,book,chapter,started_at,last_beat,seconds,source)"
                 " VALUES(?,?,?,?,?,?,0,'auto')", (user_id, device_id, extra["book"], extra["chapter"], now, now))


def app_beat(user_id, session_id, device_id):
    return _beat("app_sessions", user_id, session_id, device_id)


def reading_start(user_id, book, chapter, device_id):
    book = normalise_book(book) or book
    if book not in BOOK_BY_NAME:
        raise HTTPException(400, "Unknown book.")
    return _beat("reading_sessions", user_id, None, device_id, {"book": book, "chapter": int(chapter)})


def reading_beat(user_id, session_id, device_id):
    return _beat("reading_sessions", user_id, session_id, device_id)


def manual_log(user_id, book, chapter, minutes, at: float | None, note: str, device_id, source="manual"):
    book = normalise_book(book or "") or book
    if book not in BOOK_BY_NAME:
        raise HTTPException(400, "Unknown book.")
    start = at or time.time()
    secs = max(0, int(float(minutes or 0) * 60))
    return db.ex("INSERT INTO reading_sessions(user_id,device_id,book,chapter,started_at,last_beat,seconds,source,note_enc)"
                 " VALUES(?,?,?,?,?,?,?,?,?)",
                 (user_id, device_id, book, int(chapter), start, start + secs, secs, source, enc(note or "")))


def external_usage(user_id, app_name: str, minutes: float, book: str | None, chapter: int | None, device_id):
    """Reported by the native Android helper: time spent in another Bible app."""
    if book and chapter:
        return {"logged": manual_log(user_id, book, chapter, minutes, None, f"via {app_name}", device_id, "external")}
    db.ex("INSERT INTO app_sessions(user_id,device_id,started_at,last_beat,seconds) VALUES(?,?,?,?,?)",
          (user_id, f"external:{app_name}", time.time() - minutes * 60, time.time(), int(minutes * 60)))
    notify.send(user_id, "What did you read?",
                f"You spent {round(minutes)} min in {app_name}. Tap to log the chapter.", "#/tracker?log=1",
                device_id=device_id)
    return {"prompted": True}


def stats(user_id: int, days: int = 14) -> dict:
    tz = _tz(user_id)
    today = datetime.now(tz).date()
    start_day = today - timedelta(days=days - 1)
    since = datetime.combine(start_day, datetime.min.time(), tz).timestamp()
    out = {(start_day + timedelta(d)).isoformat(): {"app_minutes": 0, "reading_minutes": 0, "chapters": []}
           for d in range(days)}
    for r in db.q("SELECT started_at, seconds FROM app_sessions WHERE user_id=? AND started_at>=?", (user_id, since)):
        day = datetime.fromtimestamp(r["started_at"], tz).date().isoformat()
        if day in out:
            out[day]["app_minutes"] += r["seconds"] / 60
    for r in db.q("SELECT * FROM reading_sessions WHERE user_id=? AND started_at>=? ORDER BY started_at",
                  (user_id, since)):
        if r["source"] == "auto" and r["seconds"] < 20:
            continue  # chapter only glanced at
        dt = datetime.fromtimestamp(r["started_at"], tz)
        day = dt.date().isoformat()
        if day in out:
            out[day]["reading_minutes"] += r["seconds"] / 60
            out[day]["chapters"].append({"id": r["id"], "book": r["book"], "chapter": r["chapter"],
                                         "label": f"{r['book']} {r['chapter']}" if r["book"] else "Time in the Bible app",
                                         "time": dt.strftime("%H:%M"), "minutes": round(r["seconds"] / 60, 1),
                                         "source": r["source"], "note": dec(r["note_enc"]) or ""})
    for d in out.values():
        d["app_minutes"] = round(d["app_minutes"], 1)
        d["reading_minutes"] = round(d["reading_minutes"], 1)
    # streak: consecutive days (ending today or yesterday) with any reading
    streak, day = 0, today
    read_days = {datetime.fromtimestamp(r["started_at"], tz).date() for r in db.q(
        "SELECT started_at FROM reading_sessions WHERE user_id=? AND started_at>=? AND (source!='auto' OR seconds>=20)",
        (user_id, time.time() - 400 * 86400))}
    if today not in read_days:
        day = today - timedelta(days=1)
    while day in read_days:
        streak += 1
        day -= timedelta(days=1)
    return {"days": out, "today": today.isoformat(), "streak": streak,
            "goal": settings.get(user_id, "tracker.daily_goal_minutes")}


def delete_reading(user_id: int, rid: int) -> None:
    db.ex("DELETE FROM reading_sessions WHERE id=? AND user_id=?", (rid, user_id))


# ---------------------------------------------------------------- reminder scheduler
_sent: set[tuple[int, str]] = set()

def reminder_tick() -> None:
    for u in db.q("SELECT id FROM users"):
        uid = u["id"]
        if not settings.get(uid, "tracker.reminder_enabled"):
            continue
        tz = _tz(uid)
        now = datetime.now(tz)
        try:
            hh, mm = (int(x) for x in (settings.get(uid, "tracker.reminder_time") or "20:00").split(":"))
        except ValueError:
            continue
        due = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
        if not (due <= now < due + timedelta(hours=2)):
            continue
        midnight = now.replace(hour=0, minute=0, second=0, microsecond=0).timestamp()
        if db.q1("SELECT 1 FROM reading_sessions WHERE user_id=? AND started_at>=?", (uid, midnight)):
            continue
        key = (uid, now.date().isoformat())
        if key in _sent or db.q1(
                "SELECT 1 FROM notifications WHERE user_id=? AND action='#/tracker?log=1&r=1' AND created_at>=?",
                (uid, midnight)):
            continue
        _sent.add(key)
        notify.send(uid, "Time in the Word?", "You haven't logged any Bible reading today. "
                    "Open the reader, or tap to log a chapter.", "#/tracker?log=1&r=1")


# ---------------------------------------------------------------- time in the Bible app (YouVersion etc.)
# Sessions have no book/chapter (the app can't tell us which passage), so they are stored as
# reading_sessions with book NULL and source 'bible-app'. When one ends, Tolle can ask what you read.
IOS_CAP = 45 * 60
_open: dict[tuple[int, str], int] = {}


def _finish(user_id: int, key: str, seconds: int | None = None) -> None:
    sid = _open.pop((user_id, key), None)
    if not sid:
        return
    r = db.q1("SELECT * FROM reading_sessions WHERE id=?", (sid,))
    if not r:
        return
    if seconds is not None:
        db.ex("UPDATE reading_sessions SET seconds=?, last_beat=? WHERE id=?", (seconds, r["started_at"] + seconds, sid))
    else:
        seconds = r["seconds"]
    minimum = int(settings.get(user_id, "tracker.min_session_seconds") or 45)
    if seconds < minimum:
        db.ex("DELETE FROM reading_sessions WHERE id=?", (sid,))
        return
    if settings.get(user_id, "tracker.ask_after_session"):
        notify.send(user_id, "What did you read?",
                    f"You spent {max(1, round(seconds / 60))} min in the Bible app. Tap to log the passage.",
                    "#/tracker?log=1")


def bible_app_beat(user_id: int, key: str) -> None:
    """Called every minute while the Bible app is in front (Home Assistant sensors)."""
    now = time.time()
    sid = _open.get((user_id, key))
    r = db.q1("SELECT * FROM reading_sessions WHERE id=?", (sid,)) if sid else None
    if r and now - r["last_beat"] < 150:  # allow popping out for ~2 minutes
        db.ex("UPDATE reading_sessions SET last_beat=?, seconds=seconds+? WHERE id=?",
              (now, int(min(90, now - r["last_beat"])), sid))
        return
    if r:
        _finish(user_id, key)
    _open[(user_id, key)] = db.ex(
        "INSERT INTO reading_sessions(user_id,device_id,book,chapter,started_at,last_beat,seconds,source)"
        " VALUES(?,?,NULL,NULL,?,?,0,'bible-app')", (user_id, key, now, now))


def bible_app_idle(user_id: int, key: str) -> None:
    sid = _open.get((user_id, key))
    r = db.q1("SELECT last_beat FROM reading_sessions WHERE id=?", (sid,)) if sid else None
    if r and time.time() - r["last_beat"] >= 150:
        _finish(user_id, key)


def bible_app_event(user_id: int, event: str, key: str = "ios") -> dict:
    """iPhone Shortcuts automations: 'opened' / 'closed' events."""
    now = time.time()
    if event == "opened":
        if (user_id, key) in _open:
            _finish(user_id, key)
        _open[(user_id, key)] = db.ex(
            "INSERT INTO reading_sessions(user_id,device_id,book,chapter,started_at,last_beat,seconds,source)"
            " VALUES(?,?,NULL,NULL,?,?,0,'bible-app')", (user_id, key, now, now))
        return {"ok": True, "session": "started"}
    if event == "closed":
        sid = _open.get((user_id, key))
        r = db.q1("SELECT started_at FROM reading_sessions WHERE id=?", (sid,)) if sid else None
        if not r:
            return {"ok": True, "session": "none"}
        _finish(user_id, key, int(min(IOS_CAP, now - r["started_at"])))
        return {"ok": True, "session": "ended"}
    raise HTTPException(400, "event must be 'opened' or 'closed'")


def _ha_state(base: str, token: str, entity: str):
    import httpx
    r = httpx.get(f"{base}/states/{entity}", headers={"Authorization": f"Bearer {token}"}, timeout=10)
    return r.json() if r.status_code == 200 else None


def ha_app_tick() -> None:
    for u in db.q("SELECT id FROM users"):
        uid = u["id"]
        sensors = settings.get(uid, "tracker.ha_app_sensors") or []
        if not sensors:
            continue
        conf = notify.ha_connection(uid)
        if not conf:
            continue
        base, token = conf
        match = (settings.get(uid, "tracker.app_match") or "com.sirma.mobile.bible.android").lower()
        for sensor in sensors:
            try:
                app = _ha_state(base, token, sensor)
                device = sensor.removeprefix("sensor.").removesuffix("_last_used_app")
                screen = _ha_state(base, token, f"binary_sensor.{device}_interactive")
            except Exception:
                continue
            in_app = bool(app) and match in str(app.get("state", "")).lower()
            screen_on = screen is None or screen.get("state") == "on"
            key = f"ha:{sensor}"
            if in_app and screen_on:
                bible_app_beat(uid, key)
            else:
                bible_app_idle(uid, key)
