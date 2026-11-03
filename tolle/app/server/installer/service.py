"""Run Tolle in the background, starting automatically.

Two scopes:

* ``system`` – a server for several people. Starts when the computer starts, before anyone logs
  in. Needs administrator rights. The server program is copied to a permanent place first
  (the desktop app itself may be moved, updated or – on Linux – be a self-mounting AppImage).

      Linux    systemd unit       /etc/systemd/system/tolle.service   program in /opt/tolle
      macOS    launchd daemon     /Library/LaunchDaemons/app.tolle.server.plist
               program in /Library/Application Support/Tolle/server
      Windows  scheduled task     "Tolle Server" (at start-up, as SYSTEM)
               program in C:\\Program Files\\Tolle Server

* ``user`` – starts when you log in (no administrator rights). The desktop app normally does
  this itself; this is for headless Linux machines (systemd --user + lingering).
"""
import os
import plistlib
import shutil
import subprocess
import sys
from pathlib import Path

from .report import Reporter, StepError
from .system import SYSTEM, executable, is_admin, source_dir, system_data_dir, user_data_dir

SERVICE_NAME = "tolle"
MAC_LABEL = "app.tolle.server"
WIN_TASK = "Tolle Server"


def _run(cmd: list[str], check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, check=check)


def _program_dir() -> Path:
    if SYSTEM == "Windows":
        return Path(os.environ.get("ProgramFiles") or "C:/Program Files") / "Tolle Server"
    if SYSTEM == "Darwin":
        return Path("/Library/Application Support/Tolle/server")
    return Path("/opt/tolle")


def _install_program(rep: Reporter) -> list[str]:
    """Copy the server to a permanent location and return the command that starts it."""
    target = _program_dir()
    if getattr(sys, "frozen", False):
        bundle = Path(sys.executable).parent
        rep.progress(f"Copying the server program to {target}…")
        if target.exists() and target.resolve() != bundle.resolve():
            shutil.rmtree(target)
        if target.resolve() != bundle.resolve():
            shutil.copytree(bundle, target)
        return [str(target / Path(sys.executable).name)]
    # Development / source installs: copy the source tree and use this Python.
    rep.progress(f"Copying Tolle to {target}…")
    if target.exists():
        shutil.rmtree(target)
    shutil.copytree(source_dir(), target, ignore=shutil.ignore_patterns("__pycache__", "data", "*.pyc"))
    return [sys.executable, "-m", "server", "--app-dir", str(target)]


def _serve_args(port: int, host: str, data_dir: Path, mode: str) -> list[str]:
    return ["serve", "--port", str(port), "--host", host, "--data-dir", str(data_dir), "--mode", mode]


def _open_firewall(port: int, rep: Reporter) -> None:
    try:
        if SYSTEM == "Windows":
            _run(["netsh", "advfirewall", "firewall", "delete", "rule", f"name={WIN_TASK}"], check=False)
            _run(["netsh", "advfirewall", "firewall", "add", "rule", f"name={WIN_TASK}", "dir=in", "action=allow",
                  "protocol=TCP", f"localport={port}"])
            rep.progress(f"Allowed port {port} through Windows Firewall.")
        elif SYSTEM == "Linux" and shutil.which("ufw"):
            if "Status: active" in _run(["ufw", "status"], check=False).stdout:
                _run(["ufw", "allow", f"{port}/tcp"], check=False)
                rep.progress(f"Allowed port {port} through the firewall (ufw).")
    except Exception as exc:  # the server still works on this computer; tell the user
        rep.progress(f"Couldn't open the firewall automatically ({exc}). You may need to allow port {port}.")


# ---------------------------------------------------------------- install
def install(scope: str, port: int, host: str, rep: Reporter, run_as: str | None = None) -> dict:
    if scope == "system":
        if not is_admin():
            raise StepError("Installing a server for several people needs administrator rights.",
                            "Run this command as an administrator (sudo on macOS/Linux).", needs_admin=True)
        data_dir = system_data_dir()
    else:
        data_dir = user_data_dir()
    data_dir.mkdir(parents=True, exist_ok=True)
    mode = "server" if scope == "system" else "shared"

    if SYSTEM == "Linux":
        result = _linux(scope, port, host, data_dir, mode, rep)
    elif SYSTEM == "Darwin":
        result = _mac(scope, port, host, data_dir, mode, rep, run_as)
    elif SYSTEM == "Windows":
        result = _windows(scope, port, host, data_dir, mode, rep)
    else:
        raise StepError(f"Background services aren't supported on {SYSTEM}.")
    if scope == "system":
        _open_firewall(port, rep)
    return {**result, "data_dir": str(data_dir), "port": port}


def _linux(scope, port, host, data_dir, mode, rep):
    if not shutil.which("systemctl"):
        raise StepError("This Linux system doesn't use systemd.",
                        f"Start Tolle at boot with your init system: {' '.join(executable())} serve --port {port}")
    cmd = (_install_program(rep) if scope == "system" else executable()) + _serve_args(port, host, data_dir, mode)
    unit = f"""[Unit]
Description=Tolle Bible study server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart={' '.join(f'"{c}"' if ' ' in c else c for c in cmd)}
Restart=on-failure
RestartSec=5
"""
    if scope == "system":
        user = run_as or "tolle"
        if user == "tolle" and _run(["id", "tolle"], check=False).returncode != 0:
            _run(["useradd", "--system", "--home-dir", str(data_dir), "--shell", "/usr/sbin/nologin", "tolle"])
        shutil.chown(data_dir, user, None)
        for p in data_dir.rglob("*"):
            shutil.chown(p, user, None)
        unit += f"User={user}\n\n[Install]\nWantedBy=multi-user.target\n"
        path = Path("/etc/systemd/system/tolle.service")
        path.write_text(unit)
        rep.progress("Starting the Tolle service…")
        _run(["systemctl", "daemon-reload"])
        _run(["systemctl", "enable", "--now", SERVICE_NAME])
    else:
        unit += "\n[Install]\nWantedBy=default.target\n"
        path = Path.home() / ".config/systemd/user/tolle.service"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(unit)
        _run(["systemctl", "--user", "daemon-reload"])
        _run(["systemctl", "--user", "enable", "--now", SERVICE_NAME])
        _run(["loginctl", "enable-linger", os.environ.get("USER", "")], check=False)  # keep running when logged out
    return {"service": str(path)}


def _mac(scope, port, host, data_dir, mode, rep, run_as):
    if scope == "system":
        cmd = _install_program(rep) + _serve_args(port, host, data_dir, mode)
        path = Path(f"/Library/LaunchDaemons/{MAC_LABEL}.plist")
    else:
        cmd = executable() + _serve_args(port, host, data_dir, mode)
        path = Path.home() / f"Library/LaunchAgents/{MAC_LABEL}.plist"
        path.parent.mkdir(parents=True, exist_ok=True)
    plist = {
        "Label": MAC_LABEL, "ProgramArguments": cmd, "RunAtLoad": True, "KeepAlive": True,
        "StandardOutPath": str(data_dir / "server.log"), "StandardErrorPath": str(data_dir / "server.log"),
    }
    user = run_as or os.environ.get("SUDO_USER")
    if scope == "system" and user:
        plist["UserName"] = user
        subprocess.run(["chown", "-R", user, str(data_dir)], check=False)
    subprocess.run(["launchctl", "unload", str(path)], capture_output=True)
    with open(path, "wb") as fh:
        plistlib.dump(plist, fh)
    rep.progress("Starting the Tolle service…")
    _run(["launchctl", "load", "-w", str(path)])
    return {"service": str(path)}


def _windows(scope, port, host, data_dir, mode, rep):
    cmd = (_install_program(rep) if scope == "system" else executable()) + _serve_args(port, host, data_dir, mode)
    tr = subprocess.list2cmdline(cmd)
    _run(["schtasks", "/Delete", "/TN", WIN_TASK, "/F"], check=False)
    if scope == "system":
        args = ["schtasks", "/Create", "/TN", WIN_TASK, "/TR", tr, "/SC", "ONSTART", "/RU", "SYSTEM", "/RL", "HIGHEST", "/F"]
    else:
        args = ["schtasks", "/Create", "/TN", WIN_TASK, "/TR", tr, "/SC", "ONLOGON", "/F"]
    res = _run(args, check=False)
    if res.returncode != 0:
        raise StepError(f"Windows couldn't create the start-up task: {res.stderr.strip() or res.stdout.strip()}",
                        "Run the setup again as an administrator.")
    rep.progress("Starting the Tolle service…")
    _run(["schtasks", "/Run", "/TN", WIN_TASK], check=False)
    return {"service": WIN_TASK}


# ---------------------------------------------------------------- uninstall / status
def uninstall(scope: str, rep: Reporter) -> dict:
    if scope == "system" and not is_admin():
        raise StepError("Removing the server service needs administrator rights.",
                        "Run this command as an administrator (sudo on macOS/Linux).", needs_admin=True)
    if SYSTEM == "Linux":
        user = [] if scope == "system" else ["--user"]
        _run(["systemctl", *user, "disable", "--now", SERVICE_NAME], check=False)
        path = Path("/etc/systemd/system/tolle.service") if scope == "system" \
            else Path.home() / ".config/systemd/user/tolle.service"
        path.unlink(missing_ok=True)
        _run(["systemctl", *user, "daemon-reload"], check=False)
    elif SYSTEM == "Darwin":
        path = Path(f"/Library/LaunchDaemons/{MAC_LABEL}.plist") if scope == "system" \
            else Path.home() / f"Library/LaunchAgents/{MAC_LABEL}.plist"
        subprocess.run(["launchctl", "unload", "-w", str(path)], capture_output=True)
        path.unlink(missing_ok=True)
    elif SYSTEM == "Windows":
        _run(["schtasks", "/End", "/TN", WIN_TASK], check=False)
        _run(["schtasks", "/Delete", "/TN", WIN_TASK, "/F"], check=False)
        _run(["netsh", "advfirewall", "firewall", "delete", "rule", f"name={WIN_TASK}"], check=False)
    rep.progress("The background service was removed. Your data was kept.")
    return {"removed": True}


def status() -> dict:
    out = {"system": False, "user": False}
    if SYSTEM == "Linux":
        out["system"] = Path("/etc/systemd/system/tolle.service").exists()
        out["user"] = (Path.home() / ".config/systemd/user/tolle.service").exists()
    elif SYSTEM == "Darwin":
        out["system"] = Path(f"/Library/LaunchDaemons/{MAC_LABEL}.plist").exists()
        out["user"] = (Path.home() / f"Library/LaunchAgents/{MAC_LABEL}.plist").exists()
    elif SYSTEM == "Windows":
        res = _run(["schtasks", "/Query", "/TN", WIN_TASK, "/V", "/FO", "LIST"], check=False)
        if res.returncode == 0:
            out["system" if "SYSTEM" in res.stdout else "user"] = True
    return out
