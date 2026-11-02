# Installing on Home Assistant

Tolle runs as a Home Assistant add-on and opens from the sidebar through **Ingress** – no port forwarding, and Home Assistant handles HTTPS.

Requirements: Home Assistant OS or Supervised, on a 64-bit machine (amd64 or aarch64, e.g. Raspberry Pi 4/5, NUC, Green, Yellow).

## 1. Pre-built images (recommended, once)

The project lives at https://github.com/shotgn16/Tolle. Every push to `main` runs `.github/workflows/build.yaml`, which tests the code and publishes:

- `ghcr.io/shotgn16/amd64-addon-tolle` and `ghcr.io/shotgn16/aarch64-addon-tolle` (the add-on)
- `ghcr.io/shotgn16/tolle` (standalone Docker)

After the first successful run:

1. On GitHub open your profile → **Packages**, open each `…-addon-tolle` package and the `tolle` package → **Package settings** → **Change visibility** → **Public**.
2. In `tolle/config.yaml` remove the `#` in front of the `image:` line, commit and push.

Until you do this, Home Assistant builds the add-on itself on first install (a few minutes on a Raspberry Pi), which also works.

## 2. Add the repository to Home Assistant

- Click the **Add repository** badge in the README, **or**
- **Settings → Add-ons → Add-on Store → ⋮ (top right) → Repositories**, paste `https://github.com/shotgn16/Tolle`, **Add**.

## 3. Install and start

1. Find **Tolle Bible Study** in the store (refresh the page if needed) → **Install**.
2. **Start**. Turn on **Show in sidebar** (and **Start on boot**, **Watchdog** if you like).
3. Click **Tolle** in the sidebar and create your account. The first account is the administrator.

## 4. Choose your AI

**Settings → AI** inside Tolle:

- To run everything locally, install Ollama (the community Ollama add-on, or Ollama on a PC/server on your network) and enter its URL, e.g. `http://homeassistant.local:11434` or `http://192.168.1.50:11434`. Pull a model first, e.g. `ollama pull qwen3:8b` (supports thinking) and `ollama pull gemma3:4b` (reads images).
- Or paste an OpenAI, Gemini or Anthropic API key.
- Or pick **On-device** to run a small model in the browser/phone you are using.

See [ai-providers.md](ai-providers.md).

## The network port (optional)

This is the **only** setting outside the app. Leave it empty to use the sidebar only.

To use the Tolle mobile apps, or reach Tolle from devices that are not logged in to Home Assistant:

1. Add-on page → **Configuration** → **Network** → set `8099/tcp` to a host port, e.g. `8099` → **Save** → **Restart**.
2. Connect apps/browsers to `http://<home-assistant-ip>:8099`.
3. For use outside your home, put that port behind HTTPS (NGINX Proxy Manager, Caddy, Cloudflared/Tailscale add-ons). See [security.md](security.md).

## Notifications through Home Assistant

The add-on has Home Assistant API access, so in **Settings → Devices & notifications** Tolle lists your `notify` services (for example `mobile_app_pixel_8`). Tick the ones that should receive reading reminders and prompts, then **Send test to all**.

## Backups & updates

- Tolle stores its encrypted database, uploads and `secret.key` in the add-on's `/data` folder. Home Assistant backups include it.
- Updates appear in the add-on store when `version` in `tolle/config.yaml` is increased. Add a line to `tolle/CHANGELOG.md` each release.

## Troubleshooting

| Problem | Fix |
|---|---|
| Add-on not in the store | Check `repository.yaml` is at the repo root and the URL is right; **⋮ → Check for updates**. |
| Build fails | Look at **Supervisor → Logs**. Using the pre-built images (step 1) avoids local builds. |
| “Couldn't reach Ollama” | Ollama must listen on the network (`OLLAMA_HOST=0.0.0.0` when it runs on another machine). Use an IP or hostname, not `localhost`. |
| Sources unavailable | The Home Assistant host needs internet access. Check **Settings → Sources → Test**. |
| Blank page in sidebar | Clear the browser cache; check the add-on log for errors. |
