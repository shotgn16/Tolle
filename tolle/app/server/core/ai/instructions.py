"""Editable AI instructions.

The texts that shape how the AI writes – its ground rules, what each study depth means, and how the
calling guide behaves – are registered here with a name and a default. An administrator can change
any of them in Settings → AI instructions (or by editing ``instructions.json`` in the data folder);
the defaults stay in the code, so "Reset" always brings them back and updates never overwrite
your wording.

Features register their own texts with ``register(...)`` and read them with ``text(key)``.
"""
from __future__ import annotations

import json
import threading
from dataclasses import dataclass

from ..config import DATA_DIR

FILE = DATA_DIR / "instructions.json"
_lock = threading.Lock()


@dataclass
class Instruction:
    key: str
    label: str
    help: str
    default: str
    group: str = "General"


_REGISTRY: dict[str, Instruction] = {}
_cache: tuple[float, dict] | None = None


def register(key: str, label: str, default: str, help: str = "", group: str = "General") -> None:
    _REGISTRY[key] = Instruction(key, label, help, default.strip(), group)


def _overrides() -> dict:
    global _cache
    try:
        mtime = FILE.stat().st_mtime
    except OSError:
        return {}
    if _cache and _cache[0] == mtime:
        return _cache[1]
    try:
        data = json.loads(FILE.read_text(encoding="utf-8"))
        data = {k: v for k, v in data.items() if isinstance(v, str)}
    except (OSError, ValueError):
        data = {}
    _cache = (mtime, data)
    return data


def text(key: str) -> str:
    """The current wording for ``key`` – the administrator's version if there is one."""
    custom = _overrides().get(key, "").strip()
    if custom:
        return custom
    item = _REGISTRY.get(key)
    return item.default if item else ""


def listing() -> list[dict]:
    over = _overrides()
    return [{"key": i.key, "label": i.label, "help": i.help, "group": i.group, "default": i.default,
             "value": over.get(i.key, i.default), "customised": bool(over.get(i.key, "").strip())}
            for i in _REGISTRY.values()]


def save(values: dict[str, str | None]) -> None:
    """Set (or with None/empty/default text, reset) instructions."""
    with _lock:
        data = dict(_overrides())
        for key, value in values.items():
            if key not in _REGISTRY:
                continue
            value = (value or "").strip()
            if not value or value == _REGISTRY[key].default:
                data.pop(key, None)
            else:
                data[key] = value
        FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


class Levels(dict):
    """``LEVEL_GUIDE["study"]`` that always returns the current (possibly customised) wording."""

    def __getitem__(self, level):
        return text(f"level.{level}") or super().__getitem__(level)

    def get(self, level, default=None):
        return self[level] if level in self else default
