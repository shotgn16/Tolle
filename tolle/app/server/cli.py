"""Tolle command line.

    tolle-server                       start the server (same as "serve")
    tolle-server serve [--port N] [--host ADDR] [--data-dir DIR] [--mode MODE]
    tolle-server setup                 step-by-step setup in the terminal (headless servers)
    tolle-server info [--json]         this computer, recommended AI model, what's installed
    tolle-server configure --mode personal|shared|server [--port N] [--ai-model M] …
    tolle-server service install|uninstall|status [--scope system|user]
    tolle-server ollama install|pull MODEL|status
    tolle-server docker check|install|uninstall [--docker-host ssh://user@host] [--with-ollama]
    tolle-server homeassistant install --url URL [--token T] [--port N]
    tolle-server reset-password USERNAME
    tolle-server selftest              check every bundled library works

Every command accepts --json, which prints one JSON object per line (used by the desktop app).
"""
import argparse
import getpass
import json
import os
import sys


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="tolle-server", description="Tolle Bible study server and installer")
    p.add_argument("--json", action="store_true", help="machine-readable output (one JSON object per line)")
    p.add_argument("--app-dir", help=argparse.SUPPRESS)
    sub = p.add_subparsers(dest="cmd")

    s = sub.add_parser("serve", help="start the server")
    s.add_argument("--port", type=int)
    s.add_argument("--host")
    s.add_argument("--data-dir")
    s.add_argument("--mode", choices=["personal", "shared", "server", "docker"])

    st = sub.add_parser("setup", help="guided setup in the terminal")
    st.add_argument("--mode", choices=["personal", "shared", "server", "docker", "homeassistant"], help=argparse.SUPPRESS)
    sub.add_parser("info", help="information about this computer and install")

    c = sub.add_parser("configure", help="save how the server runs and its starting AI settings")
    c.add_argument("--mode", choices=["personal", "shared", "server"], required=True)
    c.add_argument("--port", type=int, default=8099)
    c.add_argument("--data-dir")
    c.add_argument("--ai-provider")
    c.add_argument("--ollama-url")
    c.add_argument("--ai-model")
    c.add_argument("--context", type=int)
    c.add_argument("--small-model", action="store_true", help="use the settings for small instruct models")

    sv = sub.add_parser("service", help="run in the background and start automatically")
    sv.add_argument("action", choices=["install", "uninstall", "status"])
    sv.add_argument("--scope", choices=["system", "user"], default="system")
    sv.add_argument("--port", type=int, default=8099)
    sv.add_argument("--host", default="0.0.0.0")
    sv.add_argument("--run-as")

    o = sub.add_parser("ollama", help="install Ollama and download models")
    o.add_argument("action", choices=["install", "pull", "status"])
    o.add_argument("model", nargs="?")

    d = sub.add_parser("docker", help="install Tolle in Docker")
    d.add_argument("action", choices=["check", "install", "uninstall"])
    d.add_argument("--port", type=int, default=8099)
    d.add_argument("--docker-host", help="e.g. ssh://me@myserver to install on another machine")
    d.add_argument("--with-ollama", action="store_true", help="also run Ollama in Docker")
    d.add_argument("--model", help="model to download into Docker's Ollama")
    d.add_argument("--tag", help="image tag (default: this version)")
    d.add_argument("--timezone", default=os.environ.get("TZ", "Europe/London"))
    d.add_argument("--remove-data", action="store_true")

    h = sub.add_parser("homeassistant", help="install the Home Assistant add-on")
    h.add_argument("action", choices=["install"])
    h.add_argument("--url", required=True, help="e.g. http://homeassistant.local:8123")
    h.add_argument("--token", help="long-lived access token (or set TOLLE_HA_TOKEN)")
    h.add_argument("--port", type=int, default=8099)

    sub.add_parser("selftest", help="check every bundled library works (used by the release build)")

    r = sub.add_parser("reset-password", help="set a new password for an account")
    r.add_argument("username")
    r.add_argument("--data-dir")
    return p


# ---------------------------------------------------------------- commands
def cmd_serve(args) -> None:
    for env, val in (("TOLLE_PORT", args.port), ("TOLLE_HOST", args.host),
                     ("TOLLE_DATA_DIR", args.data_dir), ("TOLLE_MODE", args.mode)):
        if val:
            os.environ[env] = str(val)
    import uvicorn

    from .core import config
    from .main import app
    tls = os.path.exists(config.SSL_CERT) and os.path.exists(config.SSL_KEY)
    print(f"{config.APP_NAME} {config.VERSION} – {config.RUN_MODE} mode – "
          f"{'https' if tls else 'http'}://{config.HOST}:{config.PORT} – data in {config.DATA_DIR}", flush=True)
    uvicorn.run(app, host=config.HOST, port=config.PORT, proxy_headers=True, forwarded_allow_ips="*",
                ssl_certfile=config.SSL_CERT if tls else None, ssl_keyfile=config.SSL_KEY if tls else None,
                log_level=os.environ.get("TOLLE_LOG_LEVEL", "info"))


def cmd_info(args, rep) -> dict:
    from .core.config import DATA_DIR, VERSION
    from .installer import docker, ollama, service, system
    info = {
        "version": VERSION, "os": system.SYSTEM, "hostname": system.hostname(), "admin": system.is_admin(),
        "data_dir": str(DATA_DIR), "system_data_dir": str(system.system_data_dir()),
        "lan": system.lan_addresses(), "recommend": ollama.recommend(),
        "ollama": ollama.running(), "service": service.status(), "docker": docker.check(),
    }
    if not args.json:
        print(json.dumps(info, indent=2))
    return info


def cmd_configure(args, rep) -> dict:
    from .installer import system
    data_dir = args.data_dir or \
        str(system.system_data_dir() if args.mode == "server" else system.user_data_dir())
    from .core.config import save_server_config
    defaults = {}
    if args.ai_provider:
        defaults["ai.provider"] = args.ai_provider
    if args.ollama_url:
        defaults["ollama.url"] = args.ollama_url
    if args.ai_model:
        defaults["ai.model"] = args.ai_model
    if args.small_model:
        from .core.settings import SMALL_MODEL_SETTINGS
        defaults.update(SMALL_MODEL_SETTINGS)
    if args.context:
        defaults["ollama.num_ctx"] = args.context
    values = {"mode": args.mode, "port": args.port, "host": "127.0.0.1" if args.mode == "personal" else "0.0.0.0"}
    if defaults:
        values["defaults"] = defaults
    save_server_config(values, data_dir)
    rep.progress(f"Saved: {args.mode} mode on port {args.port} (data in {data_dir}).")
    return {"data_dir": data_dir, **values}


def cmd_service(args, rep) -> dict:
    from .installer import service
    if args.action == "install":
        return service.install(args.scope, args.port, args.host, rep, args.run_as)
    if args.action == "uninstall":
        return service.uninstall(args.scope, rep)
    st = service.status()
    if not args.json:
        print(st)
    return st


def cmd_ollama(args, rep) -> dict:
    from .installer import ollama
    if args.action == "install":
        return ollama.install(rep)
    if args.action == "pull":
        return ollama.pull(args.model or ollama.recommend()["text_model"], rep)
    st = {"running": ollama.running(), **ollama.recommend()}
    if not args.json:
        print(st)
    return st


def cmd_docker(args, rep) -> dict:
    from .installer import docker
    if args.action == "check":
        st = docker.check(args.docker_host)
        if not args.json:
            print(st)
        return st
    if args.action == "uninstall":
        return docker.uninstall(rep, args.docker_host, args.remove_data)
    return docker.install(args.port, rep, args.docker_host, args.with_ollama, args.model, args.tag, args.timezone)


def cmd_homeassistant(args, rep) -> dict:
    from .installer import homeassistant
    from .installer.report import StepError
    token = args.token or os.environ.get("TOLLE_HA_TOKEN", "")
    if not token:
        raise StepError("A Home Assistant access token is needed.", "Pass --token or set TOLLE_HA_TOKEN.")
    return homeassistant.install(args.url, token, args.port, rep)


def cmd_reset_password(args, rep) -> dict:
    if args.data_dir:
        os.environ["TOLLE_DATA_DIR"] = args.data_dir
    from .core import auth, db
    from .core.crypto import hash_password
    from .installer.report import StepError
    db.init()
    row = db.q1("SELECT id FROM users WHERE username=?", (args.username,))
    if not row:
        raise StepError(f"There's no account called {args.username}.")
    pw = getpass.getpass("New password: ")
    if len(pw) < 8:
        raise StepError("Passwords need at least 8 characters.")
    db.ex("UPDATE users SET pw_hash=? WHERE id=?", (hash_password(pw), row["id"]))
    db.ex("DELETE FROM sessions WHERE user_id=?", (row["id"],))
    _ = auth
    rep.progress(f"Password changed for {args.username}. They'll need to sign in again on every device.")
    return {"ok": True}


def _tiny_pdf(text: str) -> bytes:
    """A minimal, valid one-page PDF containing `text` (with a correct cross-reference table)."""
    stream = f"BT /F1 12 Tf 10 50 Td ({text}) Tj ET".encode()
    objs = [b"<</Type/Catalog/Pages 2 0 R>>", b"<</Type/Pages/Kids[3 0 R]/Count 1>>",
            b"<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 100]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>",
            b"<</Length %d>>stream\n" % len(stream) + stream + b"\nendstream",
            b"<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>"]
    out, offsets = bytearray(b"%PDF-1.4\n"), []
    for i, o in enumerate(objs, 1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % i + o + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1)
    out += b"".join(b"%010d 00000 n \n" % off for off in offsets)
    out += b"trailer<</Size %d/Root 1 0 R>>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, xref)
    return bytes(out)


def _call_health() -> bool:
    """Send one request to /api/health straight into the web app (no network needed)."""
    import asyncio

    from .main import app
    sent = []

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        sent.append(message)

    scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": "GET", "scheme": "http",
             "path": "/api/health", "raw_path": b"/api/health", "query_string": b"", "root_path": "",
             "headers": [(b"host", b"localhost")], "client": ("127.0.0.1", 1), "server": ("127.0.0.1", 80)}
    asyncio.run(app(scope, receive, send))
    status = next((m["status"] for m in sent if m["type"] == "http.response.start"), 0)
    body = b"".join(m.get("body", b"") for m in sent if m["type"] == "http.response.body")
    return status == 200 and b'"ok":true' in body


def cmd_selftest(args, rep) -> dict:
    """Read a Word file, a PDF and an image with the bundled libraries – catches a library left out of a build."""
    import io

    from .core.extract import extract_text
    from .installer.report import StepError
    import docx
    from PIL import Image
    from cryptography.fernet import Fernet

    checks = {}
    d = docx.Document()
    d.add_paragraph("Romans 8:28")
    buf = io.BytesIO()
    d.save(buf)
    checks["word"] = "Romans 8:28" in extract_text("t.docx", "", buf.getvalue())
    pdf = _tiny_pdf("Psalm 23 notes")
    checks["pdf"] = "Psalm 23" in extract_text("t.pdf", "application/pdf", pdf)
    try:
        import pypdfium2
        checks["pdf_render"] = len(pypdfium2.PdfDocument(pdf)) == 1
    except Exception:
        checks["pdf_render"] = False
    img = io.BytesIO()
    Image.new("RGB", (8, 8), "white").save(img, "PNG")
    checks["images"] = Image.open(io.BytesIO(img.getvalue())).size == (8, 8)
    f = Fernet(Fernet.generate_key())
    checks["encryption"] = f.decrypt(f.encrypt(b"x")) == b"x"
    checks["web_app"] = _call_health()
    for k, v in checks.items():
        rep.progress(f"{'✓' if v else '✗'} {k}")
    if not all(checks.values()):
        raise StepError("Some parts of Tolle aren't working: " + ", ".join(k for k, v in checks.items() if not v))
    return {"ok": True, "checks": checks}


def _utf8_output() -> None:
    """Always write UTF-8. On Windows, output going to a pipe or file (the desktop app, a log, a build
    server) otherwise uses the old ANSI code page, which can't print characters such as ✓ or “…”."""
    for stream in (sys.stdout, sys.stderr):
        try:
            if stream.isatty():
                stream.reconfigure(errors="replace")
            else:
                stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError, OSError):
            pass


def main(argv=None) -> None:
    _utf8_output()
    argv = list(sys.argv[1:] if argv is None else argv)
    as_json = "--json" in argv          # accept --json anywhere on the line
    argv = [a for a in argv if a != "--json"]
    args = _parser().parse_args(argv)
    args.json = as_json
    if args.app_dir:
        sys.path.insert(0, args.app_dir)
    if args.cmd in (None, "serve"):
        if args.cmd is None:
            args = _parser().parse_args(["serve", *argv])
        return cmd_serve(args)
    if args.cmd == "setup":
        from .installer.wizard import run
        return run(args.mode)

    from .installer.report import Reporter, StepError
    rep = Reporter(args.json)
    handler = {"info": cmd_info, "configure": cmd_configure, "service": cmd_service, "ollama": cmd_ollama,
               "docker": cmd_docker, "homeassistant": cmd_homeassistant, "reset-password": cmd_reset_password,
               "selftest": cmd_selftest}[args.cmd]
    try:
        result = handler(args, rep) or {}
        rep.done(**result)
    except StepError as exc:
        rep.error(str(exc), exc.hint, **exc.extra)
        sys.exit(1)
    except KeyboardInterrupt:
        rep.error("Cancelled.")
        sys.exit(130)
    except Exception as exc:  # unexpected – still report it in a readable way
        rep.error(f"{type(exc).__name__}: {exc}")
        sys.exit(1)


if __name__ == "__main__":
    main()
