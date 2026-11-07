"""Print release notes for a version: its CHANGELOG section plus which file to download."""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
v = sys.argv[1]
log = (ROOT / "tolle" / "CHANGELOG.md").read_text()
m = re.search(rf"^## {re.escape(v)}\s*\n(.*?)(?=^## |\Z)", log, re.S | re.M)
changes = m.group(1).strip() if m else "See the changelog."

print(f"""## What's new

{changes}

## Which file do I need?

| You have | Download |
|---|---|
| **Android** phone or tablet | `Tolle-{v}-Android.apk` – runs on its own, or connects to your Tolle server |
| **iPhone or iPad** | `Tolle-{v}-iPhone-iPad-unsigned.ipa` – sideload it (AltStore, Sideloadly…); runs on its own or with a server |
| **Mac** with an Apple chip (M1 or later) | `Tolle-{v}-macOS-AppleSilicon.dmg` |
| **Mac** with an Intel chip | `Tolle-{v}-macOS-Intel.dmg` |
| **Windows** 10 or 11 | `Tolle-{v}-Windows-x64-Setup.exe` |
| **Ubuntu, Debian, Mint, Raspberry Pi OS** | `Tolle-{v}-Linux-amd64.deb` (or `-arm64.deb`) |
| **Other Linux** | `Tolle-{v}-Linux-x86_64.AppImage` (or `-arm64.AppImage`) |
| A **headless server** (no screen) | `install.sh` (Linux/macOS) or `install.ps1` (Windows), or `Tolle-Server-{v}-<platform>` |
| **Docker** | `docker run -d -p 8099:8099 -v tolle:/data ghcr.io/shotgn16/tolle:{v}` |
| **Home Assistant** | Settings → Apps → Install app → ⋮ → Repositories → `https://github.com/shotgn16/Tolle` |

The phone and tablet apps work **on their own**: everything is stored encrypted on the device, and the AI can run on the
device itself or be Ollama, ChatGPT, Gemini or Claude – chosen in Settings. Or connect them to a Tolle server to share
your studies across devices.

The files are **not signed** with paid Apple/Microsoft certificates: macOS needs right-click → Open the first time,
Windows SmartScreen needs “More info → Run anyway”, and Android asks you to allow installing from your browser.
The manual explains each step.

Step-by-step guides for each: [user manual](https://github.com/shotgn16/Tolle/tree/main/docs/manual).

The desktop installers can also set Tolle up in Docker or Home Assistant for you.
`SHA256SUMS.txt` lists checksums for every file.
""")
