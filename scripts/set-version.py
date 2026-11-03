#!/usr/bin/env python3
"""Copy the version in tolle/app/VERSION everywhere it is needed.

    python3 scripts/set-version.py            # sync from tolle/app/VERSION
    python3 scripts/set-version.py 0.3.0      # set a new version, then sync

Updates: the Home Assistant app (tolle/config.yaml), the desktop app and mobile package.json files
and the iOS project. Android reads VERSION directly when it builds.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VERSION_FILE = ROOT / "tolle" / "app" / "VERSION"


def code(v: str) -> int:
    major, minor, patch = (re.sub(r"\D.*", "", p) or "0" for p in (v.split(".") + ["0", "0"])[:3])
    return int(major) * 1_000_000 + int(minor) * 1_000 + int(patch)


def main() -> None:
    if len(sys.argv) > 1:
        if not re.fullmatch(r"\d+\.\d+\.\d+([-+].+)?", sys.argv[1]):
            sys.exit("Use a version like 1.2.3")
        VERSION_FILE.write_text(sys.argv[1] + "\n")
    v = VERSION_FILE.read_text().strip()

    cfg = ROOT / "tolle" / "config.yaml"
    cfg.write_text(re.sub(r'^version: .*$', f'version: "{v}"', cfg.read_text(), flags=re.M))

    for pkg in (ROOT / "packaging" / "desktop" / "package.json", ROOT / "mobile" / "package.json"):
        data = json.loads(pkg.read_text())
        data["version"] = v
        pkg.write_text(json.dumps(data, indent=2) + "\n")

    pbx = ROOT / "mobile" / "ios" / "App" / "App.xcodeproj" / "project.pbxproj"
    text = re.sub(r"MARKETING_VERSION = [^;]+;", f"MARKETING_VERSION = {v.split('-')[0]};", pbx.read_text())
    text = re.sub(r"CURRENT_PROJECT_VERSION = [^;]+;", f"CURRENT_PROJECT_VERSION = {code(v)};", text)
    pbx.write_text(text)
    print(f"Version {v} set everywhere.")


if __name__ == "__main__":
    main()
