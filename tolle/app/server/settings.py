"""Per-user settings, stored encrypted. Defaults live here."""
from typing import Any

from . import db
import json

from .crypto import dec_json, enc

DEFAULT_SOURCES = [
    {
        "id": "bible_text", "name": "Bible text (bible-api.com)", "kind": "text", "enabled": True,
        "url": "https://bible-api.com/{ref_q}?translation={translation}",
        "scope": "passage",
    },
    {
        # Same address LifeHub uses: one page with all of StudyLight's commentators on the verse.
        "id": "studylight", "name": "StudyLight – commentaries", "kind": "commentary", "enabled": True,
        "url": "https://www.studylight.org/commentary/{book_slug}/{chapter}-{verse}.html",
        "scope": "verse",
    },
    {
        "id": "bst_mhc", "name": "BibleStudyTools – Matthew Henry Complete", "kind": "commentary", "enabled": True,
        "url": "https://www.biblestudytools.com/commentaries/matthew-henry-complete/{book_slug}/{chapter}.html",
        "scope": "chapter",
    },
    {
        "id": "enduring_word", "name": "Enduring Word – David Guzik", "kind": "commentary", "enabled": True,
        "url": "https://enduringword.com/bible-commentary/{book_slug}-{chapter}/",
        "scope": "chapter",
    },
    {
        "id": "bibleproject", "name": "BibleProject – book overview", "kind": "overview", "enabled": True,
        "url": "https://bibleproject.com/explore/video/{book_slug}/",
        "scope": "book",
    },
]

LEVELS = {
    "intro": "Introduction",
    "study": "Study",
    "preach": "Preach / Teach",
    "deep": "In-depth",
}

DEFAULTS: dict[str, Any] = {
    "ai.provider": "ollama",          # ollama | openai | gemini | anthropic | openai_compat | ondevice
    "ai.model": "",
    "ai.thinking": False,
    "ai.temperature": 0.6,
    "ai.context_chars": 24000,        # budget of source text sent to the model
    "ai.vision_transcribe": True,     # use a vision model to read handwritten/image notes
    "ollama.url": "http://homeassistant.local:11434",
    "ollama.num_ctx": 16384,           # largest context window Tolle will ask Ollama for
    "ollama.max_output_tokens": 6000,  # longest answer
    "openai.key": "",
    "openai.base_url": "https://api.openai.com/v1",
    "gemini.key": "",
    "anthropic.key": "",
    "compat.base_url": "http://localhost:1234/v1",
    "compat.key": "",
    "ondevice.model": "Qwen3-4B-q4f16_1-MLC",
    "bible.translation": "web",
    "study.perspective": "",          # e.g. "Evangelical", "Reformed", "Catholic" – optional
    "study.default_level": "study",
    "sources": DEFAULT_SOURCES,
    "notify.ha_url": "",               # Docker installs: your HA URL
    "notify.ha_token": "",             # Docker installs: long-lived access token
    "notify.ha_services": [],          # e.g. ["mobile_app_pixel_8"]
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
    # iPhone Shortcuts / share sheet use this personal API key (X-Api-Key header)
    "api.key": "",
    # Tolle Android app only (optional plugin): other Bible apps whose usage time is measured
    "tracker.external_apps": [{"name": "YouVersion", "package": "com.sirma.mobile.bible.android"}],
    "ui.theme": "auto",
}

SECRET_KEYS = {"openai.key", "gemini.key", "anthropic.key", "compat.key", "notify.ha_token", "api.key"}


def get(user_id: int, key: str, default: Any = None) -> Any:
    row = db.q1("SELECT value_enc FROM settings WHERE user_id=? AND key=?", (user_id, key))
    if row is None:
        return DEFAULTS.get(key, default)
    return dec_json(row["value_enc"], DEFAULTS.get(key, default))


def get_all(user_id: int) -> dict[str, Any]:
    out = dict(DEFAULTS)
    for row in db.q("SELECT key, value_enc FROM settings WHERE user_id=?", (user_id,)):
        out[row["key"]] = dec_json(row["value_enc"], DEFAULTS.get(row["key"]))
    return out


def public(user_id: int) -> dict[str, Any]:
    """Settings for the UI, with secrets masked."""
    data = get_all(user_id)
    for k in SECRET_KEYS:
        data[k] = "••••••••" if data.get(k) else ""
    return data


def set_many(user_id: int, values: dict[str, Any]) -> None:
    with db.tx() as c:
        for key, value in values.items():
            if key not in DEFAULTS:
                continue
            if key in SECRET_KEYS and value == "••••••••":
                continue  # unchanged masked value
            c.execute(
                "INSERT INTO settings(user_id,key,value_enc) VALUES(?,?,?) "
                "ON CONFLICT(user_id,key) DO UPDATE SET value_enc=excluded.value_enc",
                (user_id, key, enc(json.dumps(value))),
            )
