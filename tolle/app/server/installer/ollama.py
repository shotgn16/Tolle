"""Install Ollama (local AI) and download a model that suits this computer."""
import json
import os
import subprocess
import tempfile
import time
from pathlib import Path

import httpx

from .report import Reporter, StepError
from .system import SYSTEM, total_ram_gb

DEFAULT_URL = "http://127.0.0.1:11434"
DOWNLOADS = {
    "Darwin": "https://ollama.com/download/Ollama-darwin.zip",
    "Windows": "https://ollama.com/download/OllamaSetup.exe",
}
LINUX_SCRIPT = "https://ollama.com/install.sh"


def recommend() -> dict:
    """A text model sized to this computer's memory, plus a small model that can read images."""
    ram = total_ram_gb()
    if ram < 10:
        text = "qwen3:4b"
    elif ram < 20:
        text = "qwen3:8b"
    else:
        text = "qwen3:14b"
    return {"ram_gb": round(ram, 1), "text_model": text, "vision_model": "gemma3:4b",
            "context": 8192 if ram < 10 else 16384}


def running(url: str = DEFAULT_URL) -> str | None:
    """Ollama's version if it is reachable, else None."""
    try:
        r = httpx.get(f"{url}/api/version", timeout=3)
        return r.json().get("version") if r.status_code == 200 else None
    except (httpx.HTTPError, ValueError):
        return None


def _download(url: str, dest: Path, rep: Reporter, label: str) -> None:
    with httpx.stream("GET", url, follow_redirects=True, timeout=httpx.Timeout(30, read=300)) as r:
        if r.status_code != 200:
            raise StepError(f"Couldn't download {label} (HTTP {r.status_code}).",
                            "Check your internet connection, or install Ollama yourself from https://ollama.com.")
        total = int(r.headers.get("content-length") or 0)
        done = 0
        with open(dest, "wb") as fh:
            for chunk in r.iter_bytes(1 << 16):
                fh.write(chunk)
                done += len(chunk)
                if total:
                    rep.progress(f"Downloading {label}…", done * 100 / total)


def _wait_until_running(rep: Reporter, seconds: int = 90) -> str:
    rep.progress("Starting Ollama…")
    for _ in range(seconds):
        v = running()
        if v:
            return v
        time.sleep(1)
    raise StepError("Ollama was installed but didn't start.",
                    "Open the Ollama app once (or restart the computer), then run this step again.")


def install(rep: Reporter) -> dict:
    v = running()
    if v:
        rep.progress(f"Ollama {v} is already installed and running.")
        return {"installed": True, "version": v}

    if SYSTEM == "Darwin":
        app = Path("/Applications/Ollama.app")
        if not app.exists():
            with tempfile.TemporaryDirectory() as tmp:
                z = Path(tmp) / "Ollama.zip"
                _download(DOWNLOADS["Darwin"], z, rep, "Ollama")
                rep.progress("Installing Ollama into Applications…")
                # ditto keeps the app's signature and permissions intact
                res = subprocess.run(["ditto", "-x", "-k", str(z), "/Applications"], capture_output=True, text=True)
                if res.returncode != 0:
                    # Not an administrator: install into your own Applications folder instead.
                    mine = Path.home() / "Applications"
                    mine.mkdir(exist_ok=True)
                    res = subprocess.run(["ditto", "-x", "-k", str(z), str(mine)], capture_output=True, text=True)
                    if res.returncode != 0:
                        raise StepError("Ollama couldn't be copied into Applications.",
                                        "Install Ollama yourself from https://ollama.com/download, then try again.")
                    app = mine / "Ollama.app"
        subprocess.run(["open", "-g", "-a", str(app)], check=False)

    elif SYSTEM == "Windows":
        with tempfile.TemporaryDirectory() as tmp:
            exe = Path(tmp) / "OllamaSetup.exe"
            _download(DOWNLOADS["Windows"], exe, rep, "Ollama")
            rep.progress("Installing Ollama (this takes a minute)…")
            res = subprocess.run([str(exe), "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/SP-"])
            if res.returncode != 0:
                raise StepError("The Ollama installer didn't finish.",
                                "Install Ollama yourself from https://ollama.com/download, then try again.")
        local = Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Ollama" / "ollama app.exe"
        if local.exists():
            subprocess.Popen([str(local)], creationflags=getattr(subprocess, "DETACHED_PROCESS", 0))

    elif SYSTEM == "Linux":
        if os.geteuid() != 0:
            raise StepError("Installing Ollama on Linux needs administrator rights.",
                            f"Run: curl -fsSL {LINUX_SCRIPT} | sh", needs_admin=True)
        with tempfile.TemporaryDirectory() as tmp:
            script = Path(tmp) / "install.sh"
            _download(LINUX_SCRIPT, script, rep, "the Ollama installer")
            rep.progress("Installing Ollama (this can take a few minutes)…")
            proc = subprocess.Popen(["sh", str(script)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            for line in proc.stdout:
                line = line.strip()
                if line and not line.startswith("#"):
                    rep.progress(line[:120])
            if proc.wait() != 0:
                raise StepError("The Ollama installer reported an error.",
                                f"Try installing it yourself: curl -fsSL {LINUX_SCRIPT} | sh")
    else:
        raise StepError(f"Automatic Ollama install isn't available on {SYSTEM}.", "Install it from https://ollama.com.")

    return {"installed": True, "version": _wait_until_running(rep)}


def pull(model: str, rep: Reporter, url: str = DEFAULT_URL) -> dict:
    """Download a model, reporting progress."""
    if not running(url):
        raise StepError("Ollama isn't running.", "Install or start Ollama first.")
    rep.progress(f"Downloading {model}…", 0)
    with httpx.stream("POST", f"{url}/api/pull", json={"model": model, "stream": True},
                      timeout=httpx.Timeout(30, read=None)) as r:
        if r.status_code != 200:
            r.read()
            raise StepError(f"Ollama couldn't download {model}: {r.text[:200]}")
        for line in r.iter_lines():
            if not line:
                continue
            try:
                ev = json.loads(line)
            except ValueError:
                continue
            if ev.get("error"):
                raise StepError(f"Ollama couldn't download {model}: {ev['error']}",
                                "Check the model name at https://ollama.com/library and your internet connection.")
            total, done = ev.get("total"), ev.get("completed")
            pct = (done or 0) * 100 / total if total else None
            status = ev.get("status", "")
            rep.progress(f"{model}: {'downloading' if status.startswith('pulling') else status}", pct)
    return {"model": model}
