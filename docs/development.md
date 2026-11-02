# Development

## Run locally

```bash
cd tolle/app
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
TOLLE_DATA_DIR=./data python -m server        # http://localhost:8099
```

The web app (`tolle/app/web`) is plain ES modules with no build step – edit and reload. Vendored libraries: `marked` (Markdown) and `DOMPurify` (sanitising).

Tests: `pip install pytest && pytest -q tests` (from the repo root).

## Architecture

```
web app (browser / HA Ingress / Capacitor)
   │  REST + Bearer token, X-Device-Id
   ▼
FastAPI (server/main.py)
   ├─ auth.py        accounts, sessions, device detection
   ├─ crypto.py      Fernet encryption, scrypt, tokens
   ├─ db.py          SQLite (columns ending _enc are ciphertext)
   ├─ jobs.py        background AI jobs (prepare → AI → finish)
   ├─ ai/providers   Ollama, OpenAI, Gemini, Anthropic, OpenAI-compatible
   ├─ ai/prompts     prompts for every feature and depth level
   ├─ sources.py     fetch + cache + extract study-site pages
   ├─ bible.py       books, reference parser
   ├─ extract.py     PDF/DOCX/image text extraction, OCR
   ├─ tracker.py     reading & app time, streaks, reminder scheduler
   └─ notify.py      device notifications, Home Assistant notify
```

### AI jobs

AI calls can take minutes, so every AI feature is a job: `POST /api/ai/jobs {kind, …params, provider?, model?, thinking?}` returns an id; the client polls `GET /api/ai/jobs/{id}`. Each kind has a `prepare` step (load notes, parse references, fetch sources, build messages) and a `finish` step (save the purple AI note). For the **on-device** provider the job stops at status `client` with the prepared messages; the client runs the model with WebLLM and posts the answer to `/api/ai/jobs/{id}/complete`.

Kinds: `notes_analyze`, `passage_study`, `insight`, `builder`, `calling_turn`, `calling_summary`, `transcribe`.

### Main endpoints

| Method & path | Purpose |
|---|---|
| `GET /api/auth/status`, `POST /api/auth/setup`, `POST /api/auth/login`, `POST /api/auth/logout` | accounts |
| `GET/PUT /api/settings` | per-user encrypted settings |
| `GET /api/ai/models?provider=` | list models with thinking/vision flags |
| `GET/POST /api/studies`, `GET/PATCH/DELETE /api/studies/{id}` | studies (kinds: notes, passage, insight, plan) |
| `POST /api/studies/{id}/entries`, `PATCH/DELETE /api/entries/{id}` | notes |
| `POST /api/notes/upload` | multipart `files[]`, `groups[]`, optional `study_id` |
| `GET /api/bible/chapter`, `GET /api/bible/parse` | Bible text, reference parsing |
| `GET/POST /api/calling`, `POST /api/calling/{id}/message`, `/summary` | calling discernment |
| `POST /api/tracker/app`, `/reading/start`, `/reading/beat`, `/reading/manual`, `/external`; `GET /api/tracker/stats` | tracking |
| `GET /api/devices`, `PATCH/DELETE /api/devices/{id}`, `POST /api/devices/{id}/test` | devices |
| `GET /api/notifications/pending`, `GET /api/notifications/ha-services`, `GET /api/notifications/ha-app-sensors` | notifications, Home Assistant |
| `POST /api/v1/bible/app` `{event: opened\|closed}` | iPhone Shortcuts: time in the Bible app (header `X-Api-Key`) |
| `POST /api/v1/bible/read` `{reference}` | share a reference or bible.com link to log it (header `X-Api-Key`) |
| `GET/POST /api/me/api-key` | show / regenerate your personal API key |

### Adding an AI provider

Add `x_models(cfg)` and `x_chat(cfg, model, messages, images, thinking, temperature)` to `server/ai/providers.py`, register them in `PROVIDERS`, `list_models` and `chat`, add settings keys to `server/settings.py` and fields to `PFIELDS` in `web/js/views/settings.js`.

## Releasing

1. Bump `version` in `tolle/config.yaml` (and `VERSION` in `server/config.py`, `mobile/package.json`).
2. Add a `tolle/CHANGELOG.md` entry.
3. Push to `main` – GitHub Actions tests and publishes the images. Home Assistant shows the update.
