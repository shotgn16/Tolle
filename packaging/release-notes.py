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

| I want to… | Download |
|---|---|
| Use Tolle on a **Windows** PC (or set up a Windows server) | `Tolle-Setup-{v}-windows-x64.exe` |
| Use Tolle on a **Mac** with Apple silicon (M1 or later) | `Tolle-{v}-macos-arm64.dmg` |
| Use Tolle on an older **Intel Mac** | `Tolle-{v}-macos-x64.dmg` |
| Use Tolle on **Linux** (any distribution) | `Tolle-{v}-linux-x86_64.AppImage` (or `-arm64`) |
| Use Tolle on **Debian / Ubuntu / Mint** | `Tolle-{v}-linux-amd64.deb` (or `-arm64.deb`) |
| Install on an **Android** phone or tablet | `Tolle-{v}-android.apk` |
| Install on an **iPhone or iPad** (sideloading) | `Tolle-{v}-ios-unsigned.ipa` |
| Run a **headless server** (no screen) | `install.sh` (Linux/macOS) or `install.ps1` (Windows) |
| **Docker** | `docker run -p 8099:8099 -v tolle:/data ghcr.io/shotgn16/tolle:{v}` |
| **Home Assistant** | Settings → Apps → Install app → ⋮ → Repositories → `https://github.com/shotgn16/Tolle` |

Step-by-step guides for each: [user manual](https://github.com/shotgn16/Tolle/tree/main/docs/manual).

The desktop installers can also set Tolle up in Docker or Home Assistant for you.
`SHA256SUMS.txt` lists checksums for every file.
""")
