"""Feature registry.

Every part of Tolle you can see in the menu (Study notes, Passage study, Insights, …) is a
*feature*: a self-contained package in this folder. A feature can bring

  * HTTP routes            (a FastAPI ``APIRouter``)
  * AI job kinds           (``{"kind": (prepare, finish)}`` – see ``core/jobs.py``)
  * database tables        (SQL run once at start-up)
  * default settings       (merged into the per-user settings)
  * background ticks       (functions called once a minute)
  * a dashboard summary    (``summary(user_id) -> dict``)
  * a clean-up hook        (``delete_user(conn, user_id)`` when an account is removed)

To add a feature, copy ``features/_template`` to a new folder, give it an id, and add that id to
``ENABLED`` below (or set the ``TOLLE_FEATURES`` environment variable). The matching web screens
live in ``web/features/<id>/``. See docs/developer/customising.md for a walkthrough.

Installed features can also be switched off without touching code: an administrator does that in
Settings → Features (stored as ``disabled_features`` in server.json). A switched-off feature
disappears from the menu, and its API answers 404.
"""
from __future__ import annotations

import importlib
import logging
import os
from dataclasses import dataclass, field
from typing import Callable

from fastapi import APIRouter

log = logging.getLogger("tolle.features")

# Order = order in the API listing. Remove an id to switch a feature off.
ENABLED = ["library", "research", "insights", "builder", "chat", "calling", "reading"]


@dataclass
class Feature:
    id: str
    name: str
    description: str = ""
    router: APIRouter | None = None
    jobs: dict[str, tuple[Callable, Callable]] = field(default_factory=dict)
    schema: str = ""
    settings: dict = field(default_factory=dict)
    ticks: list[Callable[[], None]] = field(default_factory=list)
    summary: Callable[[int], dict] | None = None
    delete_user: Callable | None = None
    essential: bool = False   # other features depend on it, so it can't be switched off


_loaded: list[Feature] = []


def enabled_ids() -> list[str]:
    env = os.environ.get("TOLLE_FEATURES")
    if env:
        return [x.strip() for x in env.split(",") if x.strip()]
    return list(ENABLED)


def load() -> list[Feature]:
    """Import each enabled feature package once and return its Feature object."""
    if _loaded:
        return _loaded
    for fid in enabled_ids():
        try:
            module = importlib.import_module(f"{__name__}.{fid}")
        except ModuleNotFoundError:
            log.warning("Feature %r is enabled but features/%s doesn't exist – skipped", fid, fid)
            continue
        feat: Feature = module.FEATURE
        _loaded.append(feat)
    return _loaded


def get(fid: str) -> Feature | None:
    return next((f for f in load() if f.id == fid), None)


# ---------------------------------------------------------------- switching features on and off
def _server_file():
    from ..core.config import SERVER_FILE
    return SERVER_FILE


def disabled() -> set[str]:
    import json
    try:
        return set(json.loads(_server_file().read_text()).get("disabled_features", []))
    except (OSError, ValueError):
        return set()


def is_enabled(fid: str) -> bool:
    return fid not in disabled()


def set_disabled(ids: list[str]) -> None:
    from ..core.config import save_server_config
    known = {f.id for f in load() if not f.essential}
    save_server_config({"disabled_features": sorted(i for i in ids if i in known)})


def require(fid: str):
    """FastAPI dependency: the feature's endpoints answer 404 while it is switched off."""
    from fastapi import HTTPException

    def check():
        if not is_enabled(fid):
            raise HTTPException(404, "This part of Tolle is switched off. An administrator can turn it on in "
                                     "Settings → Features.")
    return check
