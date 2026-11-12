"""Per-user settings, stored encrypted.

Core defaults live here; each feature registers its own with ``register_defaults``.
"""
from typing import Any

from . import db
import json

from .config import SERVER_DEFAULTS
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
    "ai.max_output_tokens": 8000,     # longest answer (tokens) before Tolle asks the model to keep going
    "ai.auto_continue": 3,            # how many times to continue an answer that hit the length limit
    "ai.prompt_style": "auto",        # auto | full | compact (small instruct models); auto = compact on-device
    "ai.repeat_penalty": 1.12,        # Ollama: discourages repeating itself
    "ai.vision_transcribe": True,     # use a vision model to read handwritten/image notes
    "ollama.url": "http://homeassistant.local:11434",
    "ollama.num_ctx": 16384,           # largest context window Tolle will ask Ollama for
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
    "api.key": "",                     # personal key for Shortcuts / share sheet (X-Api-Key header)
    "ui.theme": "auto",               # auto | light | dark
    "ui.accent": "#0f766e",           # main colour (Settings → Appearance)
    "ui.ai_colour": "#7c3aed",        # colour of everything the AI writes
}

DEFAULTS.update({k: v for k, v in SERVER_DEFAULTS.items() if k in DEFAULTS or "." in k})

# Good values for small instruct models on modest hardware (Settings → AI → "Small model" fills these in;
# the installers use them on computers with less than 20 GB of memory). Every value can still be changed.
SMALL_MODEL_SETTINGS: dict[str, Any] = {
    "ai.prompt_style": "compact", "ai.max_output_tokens": 3000, "ai.auto_continue": 2, "ai.context_chars": 6000,
    "ai.temperature": 0.4, "ai.repeat_penalty": 1.15, "ollama.num_ctx": 8192, "ai.thinking": False,
}

SECRET_KEYS = {"openai.key", "gemini.key", "anthropic.key", "compat.key", "notify.ha_token", "api.key"}


def register_defaults(values: dict[str, Any]) -> None:
    """Features add their own settings (and their defaults) here at start-up."""
    for k, v in values.items():
        DEFAULTS.setdefault(k, SERVER_DEFAULTS.get(k, v))


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
