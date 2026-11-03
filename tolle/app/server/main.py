"""Builds the Tolle web application: core API + enabled features + the web app.

    from server.main import app          # ready-made app (used by uvicorn and the tests)
    from server.main import create_app   # build a fresh one
"""
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import features
from .core import db, jobs, scheduler, settings
from .core.ai.providers import AIError
from .core.config import APP_NAME, CORS_ORIGINS, VERSION, WEB_DIR
from .core.routes import router as core_router

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
        return resp

    @app.exception_handler(AIError)
    async def _ai_error(_, exc: AIError):
        return JSONResponse({"detail": str(exc)}, status_code=502)

    app.include_router(core_router)
    for f in loaded:
        if f.router:
            app.include_router(f.router, dependencies=[Depends(features.require(f.id))])

    @app.get("/", include_in_schema=False)
    def index():
        return FileResponse(WEB_DIR / "index.html", headers={"Cache-Control": "no-cache"})

    app.mount("/", StaticFiles(directory=WEB_DIR), name="web")
    return app


app = create_app()
