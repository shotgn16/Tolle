"""Notifications.

Delivery channels:
1. Tolle devices – any browser / installed app signed in to Tolle polls
   /api/notifications/pending and shows a system notification. The user picks
   which detected devices receive them (Settings → Devices).
2. Home Assistant notify services – e.g. notify.mobile_app_<phone>. Works out
   of the box in the add-on (Supervisor API); Docker installs add an HA URL and
   long-lived access token in Settings.
"""
import time

import httpx

from . import db, settings
from .config import IS_ADDON, SUPERVISOR_TOKEN
from .crypto import dec, enc


def ha_connection(user_id: int) -> tuple[str, str] | None:
    if IS_ADDON:
        return "http://supervisor/core/api", SUPERVISOR_TOKEN
    url = (settings.get(user_id, "notify.ha_url") or "").rstrip("/")
    token = settings.get(user_id, "notify.ha_token")
    if url and token:
        return f"{url}/api", token
    return None


def ha_notify_services(user_id: int) -> list[str]:
    conf = ha_connection(user_id)
    if not conf:
        return []
    base, token = conf
    r = httpx.get(f"{base}/services", headers={"Authorization": f"Bearer {token}"}, timeout=15)
    r.raise_for_status()
    for domain in r.json():
        if domain.get("domain") == "notify":
            return sorted(domain.get("services", {}).keys())
    return []


def _send_ha(user_id: int, title: str, body: str, action: str | None) -> list[str]:
    conf = ha_connection(user_id)
    services = settings.get(user_id, "notify.ha_services") or []
    if not conf or not services:
        return []
    base, token = conf
    errors = []
    payload = {"title": title, "message": body}
    if action:
        payload["data"] = {"clickAction": action, "url": action}
    for svc in services:
        try:
            r = httpx.post(f"{base}/services/notify/{svc}", json=payload,
                           headers={"Authorization": f"Bearer {token}"}, timeout=15)
            if r.status_code >= 300:
                errors.append(f"{svc}: HTTP {r.status_code}")
        except httpx.HTTPError as exc:
            errors.append(f"{svc}: {exc}")
    return errors


def send(user_id: int, title: str, body: str, action: str | None = None,
         device_id: str | None = None) -> list[str]:
    """Queue for Tolle devices (one row per target device) and push to HA."""
    now = time.time()
    if device_id:
        targets = [device_id]
    else:
        targets = [r["id"] for r in db.q("SELECT id FROM devices WHERE user_id=? AND notify=1", (user_id,))]
    for t in targets:
        db.ex("INSERT INTO notifications(user_id,device_id,title_enc,body_enc,action,created_at) VALUES(?,?,?,?,?,?)",
              (user_id, t, enc(title), enc(body), action, now))
    return [] if device_id else _send_ha(user_id, title, body, action)


def pending(user_id: int, device_id: str | None) -> list[dict]:
    rows = db.q("SELECT * FROM notifications WHERE user_id=? AND device_id=? AND delivered_at IS NULL "
                "ORDER BY id LIMIT 20", (user_id, device_id or ""))
    now = time.time()
    out = []
    for r in rows:
        db.ex("UPDATE notifications SET delivered_at=? WHERE id=?", (now, r["id"]))
        out.append({"id": r["id"], "title": dec(r["title_enc"]), "body": dec(r["body_enc"]),
                    "action": r["action"], "created_at": r["created_at"]})
    return out
