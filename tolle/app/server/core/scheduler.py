"""Runs each feature's background ticks (reminders, Home Assistant polling…) once a minute."""
import logging
import threading
import time
from typing import Callable

log = logging.getLogger("tolle.scheduler")
_ticks: list[tuple[Callable[[], None], str | None]] = []
_started = False


def add(tick: Callable[[], None], feature_id: str | None = None) -> None:
    _ticks.append((tick, feature_id))


def start() -> None:
    global _started
    if _started:
        return
    _started = True

    def loop():
        while True:
            from .. import features
            off = features.disabled()
            for tick, fid in list(_ticks):
                if fid in off:
                    continue
                try:
                    tick()
                except Exception as exc:  # one failing tick must not stop the others
                    log.warning("scheduler: %s failed: %s", getattr(tick, "__name__", tick), exc)
            time.sleep(60)

    threading.Thread(target=loop, daemon=True, name="scheduler").start()
