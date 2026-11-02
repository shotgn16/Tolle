# Running with Docker

Tolle runs on any machine with Docker – a NAS, home server, VPS or PC. No Home Assistant needed.

## Quick start (build from source)

```bash
git clone https://github.com/shotgn16/Tolle.git
cd Tolle
docker compose up -d
```

Open `http://<server-ip>:8099` and create your account.

## Using the published image

After the GitHub workflow has run (see [home-assistant.md](home-assistant.md#1-publish-the-repository-once)):

```bash
docker run -d --name tolle --restart unless-stopped \
  -p 8099:8099 -v "$PWD/data:/data" -e TZ=Europe/London \
  ghcr.io/shotgn16/tolle:latest
```

## The port

The port is the **only** setting outside the app. Change the left side of `8099:8099` in `docker-compose.yml` (e.g. `"8443:8099"`).

## Data

Everything is stored in the `./data` folder:

| File | What |
|---|---|
| `tolle.db` | encrypted database (notes, settings, history) |
| `files/` | encrypted uploads |
| `secret.key` | the encryption key – **back it up**; without it the data can't be read |

To keep the key outside the data folder, set `TOLLE_MASTER_KEY` to a Fernet key (`python -c "from cryptography.fernet import Fernet;print(Fernet.generate_key().decode())"`) and remove `secret.key`.

## HTTPS

Pick one:

1. **Reverse proxy (recommended)** – Caddy, Traefik, NGINX Proxy Manager or Cloudflare Tunnel in front of port 8099.

   Caddy example:
   ```
   bible.example.com {
     reverse_proxy tolle:8099
   }
   ```
2. **Built-in TLS** – put `cert.pem` and `key.pem` in `./data/ssl/` (or set `TOLLE_SSL_CERT` / `TOLLE_SSL_KEY`) and restart. Tolle then serves HTTPS on the same port.

## Ollama alongside Tolle

Uncomment the `ollama` service in `docker-compose.yml`, then in Tolle set **Settings → AI → Ollama URL** to `http://ollama:11434`. Pull models with:

```bash
docker exec -it ollama ollama pull qwen3:8b
docker exec -it ollama ollama pull gemma3:4b
```

For GPU acceleration follow the Ollama Docker GPU instructions.

## Environment variables (all optional)

| Variable | Default | Purpose |
|---|---|---|
| `TOLLE_PORT` | `8099` | port inside the container |
| `TOLLE_DATA_DIR` | `/data` | data folder |
| `TOLLE_MASTER_KEY` | – | encryption key instead of `secret.key` |
| `TOLLE_SSL_CERT`, `TOLLE_SSL_KEY` | `/data/ssl/*.pem` | built-in HTTPS |
| `TOLLE_CORS_ORIGINS` | – | extra origins allowed to call the API (comma-separated) |
| `TOLLE_MAX_UPLOAD_MB` | `50` | upload size limit per file |
| `TZ` | – | container time zone (reminders use the time zone set in the app) |

## Without Docker

```bash
cd tolle/app
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
TOLLE_DATA_DIR=./data python -m server
```

Install `tesseract-ocr` and `poppler-utils` for OCR of scanned notes.

## Updating

```bash
git pull && docker compose up -d --build
```
