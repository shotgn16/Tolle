"""Progress reporting shared by the installer steps.

In ``--json`` mode every message is one JSON object per line on stdout, which the desktop app reads:
    {"event": "progress", "message": "Downloading…", "percent": 42}
    {"event": "done", ...result}
    {"event": "error", "message": "…", "hint": "…"}
Otherwise messages are printed for a person to read.
"""
import json
import sys


class StepError(Exception):
    """A step failed in a way the user can fix. ``hint`` says how."""

    def __init__(self, message: str, hint: str = "", **extra):
        super().__init__(message)
        self.hint = hint
        self.extra = extra


class Reporter:
    def __init__(self, as_json: bool = False):
        self.as_json = as_json
        self._last = None

    def _emit(self, obj: dict) -> None:
        if self.as_json:
            sys.stdout.write(json.dumps(obj) + "\n")
            sys.stdout.flush()

    def progress(self, message: str, percent: float | None = None) -> None:
        if self.as_json:
            self._emit({"event": "progress", "message": message,
                        "percent": None if percent is None else round(percent, 1)})
            return
        line = message if percent is None else f"{message} {percent:.0f}%"
        if line != self._last:
            print(line, flush=True)
            self._last = line

    def done(self, **result) -> None:
        if self.as_json:
            self._emit({"event": "done", **result})
        elif result.get("message"):
            print(result["message"], flush=True)
        elif result.get("url"):
            print(f"\nDone. Open {result['url']}", flush=True)

    def error(self, message: str, hint: str = "", **extra) -> None:
        if self.as_json:
            self._emit({"event": "error", "message": message, "hint": hint, **extra})
        else:
            print(f"\nError: {message}", file=sys.stderr)
            if hint:
                print(f"How to fix it: {hint}", file=sys.stderr)
