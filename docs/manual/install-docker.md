# Run Tolle in Docker

Tolle runs as a single container (`ghcr.io/shotgn16/tolle`), with an optional Ollama container next to it for local AI.

## The easy way: let the desktop app do it

1. Install the desktop app on any computer ([Windows](install-windows.md), [Mac](install-macos.md), [Linux](install-linux.md)).
2. In the setup assistant choose **Install it in Docker**.
3. Choose **On this computer**, or **On another machine, over SSH** (e.g. `ssh://me@my-nas`). For SSH, that machine needs Docker, and this computer needs an SSH key it can sign in with.
4. Optionally tick **Also run Ollama in Docker** for private local AI. Otherwise pick a cloud AI or decide later.
5. Create your account and click **Install**.

The assistant writes a Docker Compose file, downloads and starts Tolle, creates your account and sets up the AI. The desktop app then connects to it. The compose file is kept in Tolle's data folder (`…/Tolle/docker/docker-compose.yml`) so you can manage the containers later.

On a headless machine you can do the same in a terminal: `tolle-server docker install --with-ollama` (see [Linux](install-linux.md#a-server-with-no-screen) for getting `tolle-server`).

## The manual way: Docker Compose

```yaml
# docker-compose.yml
services:
  tolle:
    image: ghcr.io/shotgn16/tolle:latest
    container_name: tolle
    restart: unless-stopped
    ports:
      - "8099:8099"            # change the left number to use another port
    volumes:
      - ./data:/data           # your encrypted data and its key – back this folder up
    environment:
      - TZ=Europe/London
  # Optional: local AI. In Tolle set Settings → AI → Ollama URL to http://ollama:11434
  ollama:
    image: ollama/ollama:latest
    container_name: tolle-ollama
    restart: unless-stopped
    volumes:
      - ./ollama:/root/.ollama
```

```sh
docker compose up -d
docker exec -it tolle-ollama ollama pull qwen3:8b     # if you use the Ollama container
```

Open `http://<docker host>:8099` and create your account. Your first account is the administrator.

A one-liner without Compose:

```sh
docker run -d --name tolle --restart unless-stopped -p 8099:8099 -v tolle-data:/data ghcr.io/shotgn16/tolle:latest
```

### Can't download the image?

If `docker pull ghcr.io/shotgn16/tolle` says *denied* or *not found*, build it from the source instead:

```sh
docker build -t tolle-local -f Dockerfile.standalone "https://github.com/shotgn16/Tolle.git#main:tolle"
```

Then use `image: tolle-local` in the compose file. (The desktop app's Docker option does this automatically.)

## Good to know

- **Data** lives in `/data` inside the container: the encrypted database, uploads and `secret.key`. Keep that volume or folder, and back it up.
- **HTTPS**: put a reverse proxy (Caddy, Traefik, Nginx Proxy Manager, Cloudflare Tunnel) in front, or place `cert.pem` and `key.pem` in `/data/ssl/` and restart.
- **GPU for Ollama**: follow Ollama's Docker instructions for NVIDIA or AMD. Without a GPU, Ollama uses the processor (slower, but fine for small models).
- **Update**: `docker compose pull && docker compose up -d`.
- **Logs**: `docker logs -f tolle`.

### Settings you can pass to the container (all optional)

| Variable | Default | Purpose |
|---|---|---|
| `TOLLE_PORT` | `8099` | port inside the container |
| `TOLLE_MASTER_KEY` | – | use this encryption key instead of `/data/secret.key` |
| `TOLLE_DEFAULTS` | – | starting settings for new accounts, as JSON, e.g. `{"ai.provider":"ollama","ollama.url":"http://ollama:11434"}` |
| `TOLLE_FEATURES` | all | comma-separated list of features to load |
| `TOLLE_CORS_ORIGINS` | – | extra origins allowed to call the API |
| `TOLLE_MAX_UPLOAD_MB` | `50` | upload size limit per file |
