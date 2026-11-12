"""Builds the Tolle web application: core API + enabled features + the web app.

    from server.main import app          # ready-made app (used by uvicorn and the tests)
    from server.main import create_app   # build a fresh one
"""
import hashlib
import re
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import features
from .core import db, jobs, scheduler, settings
from .core.ai.providers import AIError
from .core.config import APP_NAME, CORS_ORIGINS, VERSION, WEB_DIR
from .core.routes import router as core_router


def _build_id() -> str:
    """Changes whenever the app's files change: the version plus a fingerprint of the web folder."""
    h = hashlib.sha1()
    for f in sorted(WEB_DIR.rglob("*")):
        if f.is_file():
            st = f.stat()
            h.update(f"{f.relative_to(WEB_DIR)}:{st.st_size}:{int(st.st_mtime)}".encode())
    return f"{VERSION}-{h.hexdigest()[:8]}"


BUILD = _build_id()
_ASSETS = re.compile(r'((?:src|href)=")(css/|vendor/|core/)')


def _index_html() -> str:
    """index.html with its scripts and styles under v/<build>/, so after an update the browser (or the
    Home Assistant app) can't keep running the previous version's screens from its cache."""
    return _ASSETS.sub(rf"\1v/{BUILD}/\2", (WEB_DIR / "index.html").read_text(encoding="utf-8"))

CSP = ("default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://esm.run https://cdn.jsdelivr.net; "
       "connect-src 'self' https:; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; "
       "worker-src 'self' blob:; font-src 'self' data:; frame-ancestors 'self'; base-uri 'self'; form-action 'self'")


def create_app() -> FastAPI:
    loaded = features.load()
    for f in loaded:
        settings.register_defaults(f.settings)
        jobs.register(f.jobs, f.id)
        for tick in f.ticks:
            scheduler.add(tick, f.id)

    @asynccontextmanager
    async def lifespan(_app):
        db.init([f.schema for f in loaded])
        scheduler.start()
        yield

    app = FastAPI(title=APP_NAME, version=VERSION, docs_url=None, redoc_url=None, lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=CORS_ORIGINS,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["Authorization", "Content-Type", "X-Device-Id", "X-Device-Name", "X-Api-Key"],
    )

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        resp = await call_next(request)
        resp.headers.setdefault("X-Content-Type-Options", "nosniff")
        resp.headers.setdefault("Referrer-Policy", "no-referrer")
        resp.headers.setdefault("Content-Security-Policy", CSP)
        if request.url.path.startswith("/api/"):
            resp.headers["Cache-Control"] = "no-store"
        else:
            # The app's files: always check for a newer copy (a quick 304 when nothing changed), so an update
            # shows up straight away instead of the browser running yesterday's screens.
            resp.headers.setdefault("Cache-Control", "no-cache")
        return resp

    @app.exception_handler(AIError)
    async def _ai_error(_, exc: AIError):
        return JSONResponse({"detail": str(exc)}, status_code=502)

    app.include_router(core_router)
    for f in loaded:
        if f.router:
            app.include_router(f.router, dependencies=[Depends(features.require(f.id))])

    @app.get("/", include_in_schema=False)
    @app.get("/index.html", include_in_schema=False)
    def index():
        return HTMLResponse(_index_html(), headers={"Cache-Control": "no-cache"})

    @app.get("/v/{build}/{path:path}", include_in_schema=False)
    def versioned(build: str, path: str):
        """The app's files for one build. The address changes with every update, so they can be cached for good."""
        f = (WEB_DIR / path).resolve()
        if not f.is_file() or WEB_DIR.resolve() not in f.parents:
            return JSONResponse({"detail": "Not found"}, status_code=404)
        cache = "public, max-age=31536000, immutable" if build == BUILD else "no-cache"
        return FileResponse(f, headers={"Cache-Control": cache})

    app.mount("/", StaticFiles(directory=WEB_DIR), name="web")
    return app


app = create_app()
