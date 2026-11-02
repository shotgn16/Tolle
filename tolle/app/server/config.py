"""Runtime configuration.

Only the network port lives outside the app (Home Assistant network settings or
Docker port mapping). Everything else is stored per-user inside the encrypted
database and edited from the Settings screen.
"""
import os
from pathlib import Path

VERSION = "0.1.0"
APP_NAME = "Tolle"

DATA_DIR = Path(os.environ.get("TOLLE_DATA_DIR", "/data"))
WEB_DIR = Path(__file__).resolve().parent.parent / "web"
PORT = int(os.environ.get("TOLLE_PORT", "8099"))

# Present when running as a Home Assistant add-on with homeassistant_api: true
SUPERVISOR_TOKEN = os.environ.get("SUPERVISOR_TOKEN", "")
IS_ADDON = bool(SUPERVISOR_TOKEN)

SESSION_DAYS = 30
MAX_UPLOAD_MB = int(os.environ.get("TOLLE_MAX_UPLOAD_MB", "50"))

# Origins allowed to call the API cross-origin (the mobile apps).
DEFAULT_CORS = [
    "capacitor://localhost",
    "ionic://localhost",
    "http://localhost",
    "https://localhost",
]
EXTRA_CORS = [o.strip() for o in os.environ.get("TOLLE_CORS_ORIGINS", "").split(",") if o.strip()]

DATA_DIR.mkdir(parents=True, exist_ok=True)
(DATA_DIR / "files").mkdir(exist_ok=True)
