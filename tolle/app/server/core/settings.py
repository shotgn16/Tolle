"""Per-user settings, stored encrypted.

Core defaults live here; each feature registers its own with ``register_defaults``.
"""
from typing import Any

from . import db
import json

from .config import SERVER_DEFAULTS
from .crypto import dec_json, enc

# Where studies get their material. Users can switch these off, edit them or add their own in Settings → Sources.
#   scope:  passage (the whole reference) | verse (the first verse) | chapter | book | topic (a word, e.g. "love")
#   kind:   text | commentaries | commentary | historical | language | pastoral | dictionary | overview
#   parser: pages holding many works are split into them so each is heard (see core/source_parsers.py)
#   weight: share of the source text budget, relative to the others
DEFAULT_SOURCES = [
    {
        "id": "bible_text", "name": "Bible text (bible-api.com)", "kind": "text", "enabled": True,
        "url": "https://bible-api.com/{ref_q}?translation={translation}",
        "scope": "passage", "weight": 1,
    },
    {
        # One page with ~40 commentators on the verse: from Calvin and the Geneva Bible to Spurgeon-era
        # sermons (Biblical Illustrator), word studies (Robertson, Vincent) and modern notes (Constable).
        "id": "studylight", "name": "StudyLight – commentaries", "kind": "commentaries", "enabled": True,
        "url": "https://www.studylight.org/commentary/{book_slug}/{chapter}-{verse}.html",
        "scope": "verse", "parser": "studylight", "weight": 4,
    },
    {
        # Ellicott, MacLaren's sermons, Pulpit Commentary, Cambridge, Spurgeon's Treasury of David, Keil & Delitzsch…
        "id": "biblehub", "name": "Bible Hub – commentaries", "kind": "commentaries", "enabled": True,
        "url": "https://biblehub.com/commentaries/{book_bh}/{chapter}-{verse}.htm",
        "scope": "verse", "parser": "biblehub", "weight": 3,
    },
    {
        # Augustine, Chrysostom, Jerome, Bede… verse by verse (only some verses have them on the page).
        "id": "catena", "name": "Catena Bible – Church Fathers", "kind": "historical", "enabled": True,
        "url": "https://catenabible.com/{book_nab}/{chapter}/{verse}",
        "scope": "verse", "parser": "catena", "weight": 2,
    },
    {
        "id": "interlinear", "name": "Bible Hub – Greek/Hebrew interlinear", "kind": "language", "enabled": True,
        "url": "https://biblehub.com/interlinear/{book_bh}/{chapter}-{verse}.htm",
        "scope": "verse", "parser": "interlinear", "weight": 1,
    },
    {
        "id": "bst_mhc", "name": "BibleStudyTools – Matthew Henry Complete", "kind": "commentary", "enabled": True,
        "url": "https://www.biblestudytools.com/commentaries/matthew-henry-complete/{book_slug}/{chapter}.html",
        "scope": "chapter", "weight": 1.5,
    },
    {
        "id": "enduring_word", "name": "Enduring Word – David Guzik", "kind": "pastoral", "enabled": True,
        "url": "https://enduringword.com/bible-commentary/{book_slug}-{chapter}/",
        "scope": "chapter", "weight": 1.5,
    },
    {
        "id": "bibleproject", "name": "BibleProject – book overview", "kind": "overview", "enabled": True,
        "url": "https://bibleproject.com/explore/video/{book_slug}/",
        "scope": "book", "weight": 0.75,
    },
    {
        "id": "easton", "name": "Easton's Bible Dictionary (StudyLight)", "kind": "dictionary", "enabled": True,
        "url": "https://www.studylight.org/dictionaries/eng/ebd/{topic_letter}/{topic_slug}.html",
        "scope": "topic", "weight": 0.75,
    },
]

DEFAULT_SOURCE_IDS = [s["id"] for s in DEFAULT_SOURCES]


def with_new_sources(sources: list[dict], known: list[str]) -> tuple[list[dict], list[str]]:
    """Add sources that came with an update, and fill in new fields on built-in ones you already have.

    `known` lists the built-in sources you've already been given, so one you deleted doesn't come back.
    Your own edits (names, addresses, on/off) are kept.
    """
    have = {s.get("id"): s for s in sources}
    out = [dict(s) for s in sources]
    for d in DEFAULT_SOURCES:
        mine = have.get(d["id"])
        if mine is not None:
            row = next(s for s in out if s.get("id") == d["id"])
            for k in ("parser", "weight"):
                if k in d:
                    row.setdefault(k, d[k])
            if d["id"] == "studylight" and row.get("kind") == "commentary":
                row["kind"] = "commentaries"
        elif d["id"] not in known:
            out.append(dict(d))
    return out, DEFAULT_SOURCE_IDS


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
    "ai.context_chars": 40000,        # budget of source text sent to the model (Ollama: capped to fit its context window)
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

DEFAULTS["sources.known"] = DEFAULT_SOURCE_IDS

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


# The built-in sources before "sources.known" was kept (Tolle 0.4.0 and earlier).
_FIRST_SOURCE_IDS = ["bible_text", "studylight", "bst_mhc", "enduring_word", "bibleproject"]


def get_all(user_id: int) -> dict[str, Any]:
    out = dict(DEFAULTS)
    stored = set()
    for row in db.q("SELECT key, value_enc FROM settings WHERE user_id=?", (user_id,)):
        out[row["key"]] = dec_json(row["value_enc"], DEFAULTS.get(row["key"]))
        stored.add(row["key"])
    if "sources" in stored:
        known = out.get("sources.known") if "sources.known" in stored else _FIRST_SOURCE_IDS
        updated, now_known = with_new_sources(out["sources"] or [], known or [])
        if updated != out["sources"] or known != now_known:
            set_many(user_id, {"sources": updated, "sources.known": now_known})
            out["sources"], out["sources.known"] = updated, now_known
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
