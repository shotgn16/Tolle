"""Install Tolle as a Docker container – on this computer or on another machine over SSH.

Writes a docker-compose file (kept so you can manage it later) and starts it. Optionally adds an
Ollama container next to Tolle, already connected.
"""
import json
import os
import subprocess
import time
from pathlib import Path
from urllib.parse import urlparse

import httpx

from ..core.config import VERSION
from .report import Reporter, StepError
from .system import SYSTEM, user_data_dir

IMAGE = "ghcr.io/shotgn16/tolle"
SOURCE = "https://github.com/shotgn16/Tolle.git"   # used to build the image if it can't be downloaded
LOCAL_IMAGE = "tolle-local"
PROJECT = "tolle"


def _env(docker_host: str | None) -> dict:
    env = dict(os.environ)
    if docker_host:
        env["DOCKER_HOST"] = docker_host
    return env


def check(docker_host: str | None = None) -> dict:
    """Is Docker installed and running (locally, or at docker_host)?"""
    try:
        res = subprocess.run(["docker", "version", "--format", "{{json .Server.Version}}"],
                             capture_output=True, text=True, timeout=30, env=_env(docker_host))
    except FileNotFoundError:
        return {"installed": False, "running": False}
    except subprocess.TimeoutExpired:
        return {"installed": True, "running": False, "error": "Docker didn't answer in time."}
    if res.returncode != 0:
        return {"installed": True, "running": False, "error": res.stderr.strip()[:300]}
    compose = subprocess.run(["docker", "compose", "version"], capture_output=True, text=True, env=_env(docker_host))
    return {"installed": True, "running": True, "version": json.loads(res.stdout or '""'),
            "compose": compose.returncode == 0}


def compose_file(port: int, tag: str, with_ollama: bool, timezone: str, image: str | None = None) -> str:
    defaults = {"ai.provider": "ollama", "ollama.url": "http://ollama:11434"} if with_ollama else {}
    lines = [
        "# Created by the Tolle installer. Manage with:  docker compose -p tolle -f <this file> up -d / down",
        "services:",
        "  tolle:",
        f"    image: {image or f'{IMAGE}:{tag}'}",
        "    container_name: tolle",
        "    restart: unless-stopped",
        "    ports:",
        f'      - "{port}:8099"',
        "    volumes:",
        "      - tolle-data:/data",
        "    environment:",
        f"      - TZ={timezone}",
        "      - TOLLE_MODE=docker",
    ]
    if defaults:
        lines.append(f"      - 'TOLLE_DEFAULTS={json.dumps(defaults, separators=(',', ':'))}'")
        lines += ["    depends_on:", "      - ollama"]
    if with_ollama:
        lines += [
            "  ollama:",
            "    image: ollama/ollama:latest",
            "    container_name: tolle-ollama",
            "    restart: unless-stopped",
            "    volumes:",
            "      - ollama:/root/.ollama",
        ]
    lines += ["volumes:", "  tolle-data:"] + (["  ollama:"] if with_ollama else [])
    return "\n".join(lines) + "\n"


def _host_of(docker_host: str | None) -> str:
    if not docker_host:
        return "127.0.0.1"
    parsed = urlparse(docker_host)
    return parsed.hostname or "127.0.0.1"


def install(port: int, rep: Reporter, docker_host: str | None = None, with_ollama: bool = False,
            model: str | None = None, tag: str | None = None, timezone: str = "Europe/London") -> dict:
    state = check(docker_host)
    if not state["installed"]:
        hint = {"Windows": "Install Docker Desktop from https://www.docker.com/products/docker-desktop/ and start it.",
                "Darwin": "Install Docker Desktop from https://www.docker.com/products/docker-desktop/ and start it.",
                }.get(SYSTEM, "Install Docker with: curl -fsSL https://get.docker.com | sh")
        raise StepError("Docker isn't installed on this computer.", hint, needs_docker=True)
    if not state["running"]:
        raise StepError("Docker is installed but not running" + (f" at {docker_host}" if docker_host else "") + ".",
                        "Start Docker Desktop (or the Docker service) and try again. " + state.get("error", ""))
    if not state.get("compose"):
        raise StepError("Docker Compose isn't available.", "Update Docker to a version that includes 'docker compose'.")

    folder = user_data_dir() / "docker"
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / "docker-compose.yml"
    path.write_text(compose_file(port, tag or VERSION, with_ollama, timezone))
    env = _env(docker_host)
    base = ["docker", "compose", "-p", PROJECT, "-f", str(path)]

    def pull() -> bool:
        proc = subprocess.Popen(base + ["pull", "tolle"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                text=True, env=env)
        for line in proc.stdout:
            if line.strip():
                rep.progress(line.strip()[:120])
        return proc.wait() == 0

    rep.progress("Downloading the Tolle image (first time only)…")
    ok = pull()
    if not ok and tag is None:   # this exact version may not be published (e.g. a development build)
        path.write_text(compose_file(port, "latest", with_ollama, timezone))
        ok = pull()
    if not ok:
        # The image may be private or the registry unreachable – build it from the source on GitHub instead.
        rep.progress("Couldn't download the image, so building it from the source code (takes a few minutes)…")
        build = subprocess.Popen(["docker", "build", "-t", LOCAL_IMAGE, "-f", "Dockerfile.standalone",
                                  f"{SOURCE}#main:tolle"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                 text=True, env=env)
        for line in build.stdout:
            if line.strip():
                rep.progress(line.strip()[-120:])
        if build.wait() != 0:
            raise StepError("Couldn't download or build the Tolle image.",
                            "Check the internet connection of the Docker host, then try again.")
        path.write_text(compose_file(port, "", with_ollama, timezone, image=LOCAL_IMAGE))
    if with_ollama:
        rep.progress("Downloading the Ollama image…")
        subprocess.run(base + ["pull", "ollama"], capture_output=True, env=env)

    rep.progress("Starting the container…")
    res = subprocess.run(base + ["up", "-d"], capture_output=True, text=True, env=env)
    if res.returncode != 0:
        msg = res.stderr.strip()[-400:]
        hint = "Choose a different port." if "port is already allocated" in msg or "address already in use" in msg else ""
        raise StepError(f"Docker couldn't start Tolle: {msg}", hint)

    if with_ollama and model:
        rep.progress(f"Downloading the AI model {model} inside Docker (this can take a while)…")
        pull = subprocess.Popen(["docker", "exec", "tolle-ollama", "ollama", "pull", model],
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, env=env)
        for line in pull.stdout:
            if line.strip():
                rep.progress(line.strip()[-120:])
        pull.wait()

    host = _host_of(docker_host)
    url = f"http://{host}:{port}"
    rep.progress("Waiting for Tolle to answer…")
    for _ in range(60):
        try:
            if httpx.get(f"{url}/api/health", timeout=2).status_code == 200:
                return {"url": url, "compose_file": str(path)}
        except httpx.HTTPError:
            pass
        time.sleep(2)
    raise StepError(f"The container started, but Tolle didn't answer at {url}.",
                    f"Check the logs with: docker logs tolle")


def uninstall(rep: Reporter, docker_host: str | None = None, remove_data: bool = False) -> dict:
    path = user_data_dir() / "docker" / "docker-compose.yml"
    if not path.exists():
        raise StepError("No Docker install made by this installer was found.")
    args = ["docker", "compose", "-p", PROJECT, "-f", str(path), "down"] + (["-v"] if remove_data else [])
    subprocess.run(args, capture_output=True, env=_env(docker_host))
    rep.progress("Tolle's container was removed" + (" with its data." if remove_data else ". Its data volume was kept."))
    return {"removed": True}
