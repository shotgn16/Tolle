"""Install Tolle as a Home Assistant app (formerly called an add-on) from another computer.

Uses Home Assistant's websocket API with a long-lived access token from an administrator. The
``supervisor/api`` command passes requests to the Supervisor, which is how Home Assistant's own
add-on store installs things. This works on Home Assistant OS and Supervised installs; "Container"
and "Core" installs have no add-ons (use the Docker option instead).
"""
import asyncio
import json
import time
from urllib.parse import urlparse

import websockets

from .report import Reporter, StepError

REPOSITORY = "https://github.com/shotgn16/Tolle"
ADDON_SUFFIX = "_tolle"   # third-party add-on slugs are "<repo hash>_<slug>"


class _HA:
    def __init__(self, url: str, token: str):
        p = urlparse(url if "://" in url else f"http://{url}")
        scheme = "wss" if p.scheme == "https" else "ws"
        self.host = p.hostname or ""
        self.ws_url = f"{scheme}://{p.netloc}/api/websocket"
        self.token = token
        self.ws = None
        self.n = 0

    async def __aenter__(self):
        try:
            self.ws = await websockets.connect(self.ws_url, max_size=None, open_timeout=15)
        except Exception as exc:
            raise StepError(f"Couldn't connect to Home Assistant at {self.ws_url}: {exc}",
                            "Check the address (e.g. http://homeassistant.local:8123) and that this computer can reach it.")
        hello = json.loads(await self.ws.recv())
        if hello.get("type") != "auth_required":
            raise StepError("That address didn't answer like Home Assistant.")
        await self.ws.send(json.dumps({"type": "auth", "access_token": self.token}))
        res = json.loads(await self.ws.recv())
        if res.get("type") != "auth_ok":
            raise StepError("Home Assistant didn't accept the access token.",
                            "In Home Assistant open your profile → Security → Long-lived access tokens → Create token, "
                            "while signed in as an administrator, and paste it here.")
        return self

    async def __aexit__(self, *exc):
        if self.ws:
            await self.ws.close()

    async def call(self, msg: dict, timeout: float = 60):
        self.n += 1
        mid = self.n
        await self.ws.send(json.dumps({"id": mid, **msg}))
        deadline = time.monotonic() + timeout
        while True:
            left = deadline - time.monotonic()
            if left <= 0:
                raise StepError("Home Assistant took too long to answer.", "Try again in a minute.")
            data = json.loads(await asyncio.wait_for(self.ws.recv(), left))
            if data.get("id") != mid:
                continue
            if not data.get("success", False):
                err = data.get("error", {})
                if err.get("code") == "unauthorized":
                    raise StepError("This access token isn't from an administrator.",
                                    "Create the token while signed in to Home Assistant as an administrator.")
                raise StepError(f"Home Assistant said: {err.get('message', err)}")
            return data.get("result")

    async def supervisor(self, endpoint: str, method: str = "get", data: dict | None = None, timeout: float = 60):
        msg = {"type": "supervisor/api", "endpoint": endpoint, "method": method,
               "timeout": None if timeout > 60 else timeout}
        if data is not None:
            msg["data"] = data
        return await self.call(msg, timeout=timeout + 10)


async def _install(url: str, token: str, port: int, rep: Reporter) -> dict:
    async with _HA(url, token) as ha:
        rep.progress("Connected to Home Assistant.")
        try:
            await ha.supervisor("/supervisor/info")
        except StepError:
            raise StepError("This Home Assistant can't install apps (add-ons).",
                            "Apps need Home Assistant OS or a Supervised install. For Home Assistant Container/Core, "
                            "choose the Docker option instead.")

        rep.progress("Adding the Tolle app repository…")
        repos = await ha.supervisor("/store/repositories") or []
        if not any(REPOSITORY.lower() in (r.get("source") or r.get("url") or "").lower() for r in repos):
            await ha.supervisor("/store/repositories", "post", {"repository": REPOSITORY}, timeout=120)

        rep.progress("Looking for Tolle in the app store…")
        slug = None
        for _ in range(10):
            repos = await ha.supervisor("/store/repositories") or []
            repo_ids = {REPOSITORY.lower()} | {(r.get("slug") or "").lower() for r in repos
                                               if REPOSITORY.lower() in (r.get("source") or r.get("url") or "").lower()}
            for a in await ha.supervisor("/store/addons") or []:
                if a.get("slug", "").endswith(ADDON_SUFFIX) and (a.get("repository") or "").lower() in repo_ids:
                    slug = a["slug"]
                    break
            if slug:
                break
            await ha.supervisor("/store/reload", "post", timeout=120)
            await asyncio.sleep(3)
        if not slug:
            raise StepError("Tolle didn't appear in the app store.",
                            "In Home Assistant open Settings → Apps → Install app → ⋮ → Check for updates, then retry.")

        store_info = await ha.supervisor(f"/store/addons/{slug}")
        if not store_info.get("installed"):
            rep.progress("Installing the Tolle app (this can take several minutes)…")
            await ha.supervisor(f"/store/addons/{slug}/install", "post", {"background": False}, timeout=1800)
        else:
            rep.progress("The Tolle app is already installed.")

        rep.progress("Turning on the sidebar panel and the network port…")
        await ha.supervisor(f"/addons/{slug}/options", "post", {
            "boot": "auto", "watchdog": True, "ingress_panel": True, "network": {"8099/tcp": int(port)},
        })
        info = await ha.supervisor(f"/addons/{slug}/info")
        if info.get("state") != "started":
            rep.progress("Starting Tolle…")
            await ha.supervisor(f"/addons/{slug}/start", "post", timeout=300)
        else:
            await ha.supervisor(f"/addons/{slug}/restart", "post", timeout=300)
        return {"slug": slug, "url": f"http://{ha.host}:{port}", "sidebar": url.rstrip("/")}


def install(url: str, token: str, port: int, rep: Reporter) -> dict:
    return asyncio.run(_install(url, token, port, rep))
