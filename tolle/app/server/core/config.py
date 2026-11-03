"""Server configuration.

Everything a *user* changes lives in the app's Settings screen (stored per user, encrypted).
This file covers how the *server* runs: where data is kept, which port and network address it
listens on, and which setup mode it is in. Values come from, in order:

  1. environment variables (TOLLE_PORT, TOLLE_HOST, TOLLE_DATA_DIR, TOLLE_MODE …)
  2. ``server.json`` in the data folder (written by the installer / setup wizard)
  3. the defaults below
"""
import json
import os
import platform
import sys
from pathlib import Path

VERSION = (Path(__file__).resolve().parent.parent.parent / "VERSION").read_text().strip() \
    if (Path(__file__).resolve().parent.parent.parent / "VERSION").exists() else "0.2.0"
APP_NAME = "Tolle"
APP_ID = "tolle"


# ---------------------------------------------------------------- where things live
def _default_data_dir() -> Path:
    system = platform.system()
    if system == "Windows":
        return Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local") / APP_NAME
    if system == "Darwin":
        return Path.home() / "Library" / "Application Support" / APP_NAME
    return Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share") / APP_ID


def _bundle_dir() -> Path:
    """Folder holding web/ – inside the PyInstaller bundle when frozen, else the source tree."""
    if getattr(sys, "frozen", False):
        return Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
    return Path(__file__).resolve().parent.parent.parent


DATA_DIR = Path(os.environ.get("TOLLE_DATA_DIR") or _default_data_dir())
DATA_DIR.mkdir(parents=True, exist_ok=True)
(DATA_DIR / "files").mkdir(exist_ok=True)
WEB_DIR = Path(os.environ.get("TOLLE_WEB_DIR") or _bundle_dir() / "web")
SERVER_FILE = DATA_DIR / "server.json"


def _file_config() -> dict:
    try:
        return json.loads(SERVER_FILE.read_text())
    except (OSError, ValueError):
        return {}


def save_server_config(values: dict, data_dir: str | Path | None = None) -> Path:
    """Merge ``values`` into server.json. ``data_dir`` defaults to this process's data folder."""
    target = Path(data_dir) / "server.json" if data_dir else SERVER_FILE
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        current = json.loads(target.read_text())
    except (OSError, ValueError):
        current = {}
    current.update(values)
    target.write_text(json.dumps(current, indent=2))
    return target


_cfg = _file_config()


def _opt(env: str, key: str, default):
    value = os.environ.get(env)
    if value is not None and value != "":
        return value
    return _cfg.get(key, default)


# ---------------------------------------------------------------- how the server runs
# Present when running as a Home Assistant add-on with homeassistant_api: true
SUPERVISOR_TOKEN = os.environ.get("SUPERVISOR_TOKEN", "")
IS_ADDON = bool(SUPERVISOR_TOKEN)

# personal  – one person on this computer only (listens on 127.0.0.1)
# shared    – this computer + your phone/tablet (listens on the network)
# server    – a server for several people (runs as a background service)
# docker / addon – inside a container / Home Assistant
# Inside a container the server must listen on all interfaces, or nothing outside can reach it.
IN_CONTAINER = os.path.exists("/.dockerenv") or os.path.exists("/run/.containerenv")
RUN_MODE = "addon" if IS_ADDON else str(_opt("TOLLE_MODE", "mode", "docker" if IN_CONTAINER else "personal"))
PORT = int(_opt("TOLLE_PORT", "port", 8099))
HOST = str(_opt("TOLLE_HOST", "host", "127.0.0.1" if RUN_MODE == "personal" else "0.0.0.0"))
SSL_CERT = str(_opt("TOLLE_SSL_CERT", "ssl_cert", DATA_DIR / "ssl" / "cert.pem"))
SSL_KEY = str(_opt("TOLLE_SSL_KEY", "ssl_key", DATA_DIR / "ssl" / "key.pem"))

# Starting values for every user's settings (e.g. the AI set up by the installer).
try:
    SERVER_DEFAULTS: dict = json.loads(os.environ["TOLLE_DEFAULTS"]) if os.environ.get("TOLLE_DEFAULTS") \
        else dict(_cfg.get("defaults", {}))
except ValueError:
    SERVER_DEFAULTS = {}

SESSION_DAYS = 30
MAX_UPLOAD_MB = int(_opt("TOLLE_MAX_UPLOAD_MB", "max_upload_mb", 50))

# Origins allowed to call the API cross-origin (the mobile and desktop apps).
CORS_ORIGINS = [
    "capacitor://localhost", "ionic://localhost", "http://localhost", "https://localhost", "app://tolle",
    *[o.strip() for o in str(_opt("TOLLE_CORS_ORIGINS", "cors_origins", "")).split(",") if o.strip()],
]
