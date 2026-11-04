# Developer guide

Tolle is built to be changed. Most customisations need no programming knowledge beyond editing a text file, and adding a whole new screen means copying one folder.

- **[Customising Tolle](customising.md)**: rename and rebrand it, change colours, switch features on and off, rewrite the AI's instructions, add study sites, add your own feature or AI provider.
- **[Building and releasing](building.md)**: build the installers and phone apps yourself, sign them, and publish a release.

## How Tolle fits together

Tolle is one program, the **Tolle server**, plus several ways to reach it:

```
 Desktop app (Electron)      Phone & tablet apps (Capacitor)      Any web browser
 ├─ setup assistant          └─ the same web app, packaged        └─ the same web app
 └─ shows the web app
              │                          │                               │
              └──────────────── HTTP (REST + sign-in token) ─────────────┘
                                         │
                              Tolle server (Python, FastAPI)
                              ├─ core/       accounts, encryption, database, AI, jobs, settings
                              ├─ features/   one folder per part of the app (notes, studies, …)
                              ├─ installer/  service, Ollama, Docker and Home Assistant set-up
                              └─ web/        the web app it serves (no build step)
```

The **same server program** runs everywhere: inside the desktop app, as a background service, in Docker and in Home Assistant. Only how it starts differs.

## The project

```
tolle/                      the Tolle server (also the Home Assistant app and Docker build folder)
  app/server/
    core/                   shared building blocks – you rarely need to change these
    features/               one folder per feature; _template/ is a working example to copy
    installer/              set-up steps used by the desktop assistant and `tolle-server setup`
    cli.py                  the tolle-server command (serve, setup, service, ollama, docker, …)
  app/web/
    core/                   app shell: menu, sign-in, settings, shared UI pieces
    features/               the screens for each feature (same ids as the server side)
    css/theme.css           colours and fonts
  config.yaml, Dockerfile   Home Assistant app
  Dockerfile.standalone     Docker image
packaging/
  server/                   recipe that turns the server into a stand-alone program (PyInstaller)
  desktop/                  desktop app and its setup assistant (Electron, electron-builder)
  install/                  one-line installers for servers with no screen (install.sh, install.ps1)
mobile/                     Android and iOS/iPadOS apps (Capacitor)
docs/manual/                the user manual
docs/developer/             this guide
scripts/set-version.py      sets the version number everywhere
tests/                      automated tests
.github/workflows/          builds: container images on every push, installers on every release
```

## Run it from the source code

You need Python 3.12 or newer.

```bash
cd tolle/app
python3 -m venv .venv
. .venv/bin/activate              # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python -m server serve --data-dir ./data
```

Open http://127.0.0.1:8099 and create an account. The web app has no build step: edit a file in `tolle/app/web` and reload the page. Restart the server after changing Python files.

Run the tests from the repository root:

```bash
pip install pytest
pytest -q tests
```

Run the desktop app against your source code:

```bash
cd packaging/desktop
npm install
npx electron .        # uses Python from tolle/app, or build/server if you've built the server
```

## The tolle-server command

Everything the installers do is available on the command line, so it can be scripted:

| Command | What it does |
|---|---|
| `tolle-server serve [--port N] [--host ADDR] [--data-dir DIR]` | start Tolle |
| `tolle-server setup` | the setup assistant in a terminal |
| `tolle-server info` | this computer: suggested AI model, what's installed, network addresses |
| `tolle-server configure --mode personal\|shared\|server …` | save how Tolle runs and its starting AI settings |
| `tolle-server service install\|uninstall\|status [--scope system\|user]` | run in the background from start-up or log-in |
| `tolle-server ollama install\|pull MODEL\|status` | install Ollama and download models |
| `tolle-server docker check\|install\|uninstall [--docker-host ssh://…] [--with-ollama]` | install into Docker, here or on another machine |
| `tolle-server homeassistant install --url URL --token TOKEN` | install the Home Assistant app |
| `tolle-server reset-password USERNAME` | set a new password |
| `tolle-server selftest` | check every bundled library works |

Add `--json` to any command for one JSON object per line. The desktop app uses this.

## Where data lives

| How Tolle runs | Data folder |
|---|---|
| Desktop app, just you | Windows `%LOCALAPPDATA%\Tolle` · macOS `~/Library/Application Support/Tolle` · Linux `~/.local/share/tolle` |
| Server for several people | Windows `C:\ProgramData\Tolle` · macOS `/Library/Application Support/Tolle` · Linux `/var/lib/tolle` |
| Docker / Home Assistant | `/data` inside the container |

The data folder holds `tolle.db` (the encrypted database), `files/` (encrypted uploads), `secret.key` (the encryption key), `server.json` (how this server runs) and `instructions.json` (any AI instructions you changed).

## The API

Every screen talks to the server over a small JSON API. Requests carry `Authorization: Bearer <token>` and an `X-Device-Id`. Each feature's routes are in `server/features/<id>/__init__.py`. Shared routes are in `server/core/routes.py`.

AI work runs as **jobs**, because it can take minutes: `POST /api/ai/jobs {kind, …}` returns an id, and the app polls `GET /api/ai/jobs/{id}`. With the on-device AI, the job pauses with status `client`; the browser or phone runs the model and posts the answer back.

Endpoints for automations use a personal API key in an `X-Api-Key` header: `POST /api/v1/bible/app` (time in the Bible app) and `POST /api/v1/bible/read` (log a passage).
