# Tolle Bible Study

An AI-assisted Bible study companion: study notes, passage research, insights, a study builder, calling discernment and a reading tracker.

## Getting started

1. Start the add-on and enable **Show in sidebar**.
2. Open **Tolle** from the sidebar.
3. Create your account – the first account is the administrator.
4. Go to **Settings → AI** and choose a provider and model.

All other settings live inside the app (Settings) and are stored encrypted in the add-on's data folder, which is included in Home Assistant backups.

## Network port (optional)

The add-on works through the sidebar (Ingress) without any port. If you want to use the **Tolle mobile apps** or open Tolle from other devices directly, set a host port under **Configuration → Network** (for example `8099`) and restart the add-on. Then connect the app to `http://<home-assistant-ip>:8099`.

For access from outside your home, put it behind HTTPS (for example the NGINX Proxy Manager or Cloudflared add-on, or Nabu Casa via the sidebar).

## AI providers

- **Ollama** – install the Ollama add-on or run Ollama on another machine, then enter its URL, e.g. `http://homeassistant.local:11434` or `http://192.168.1.50:11434`.
- **OpenAI / Gemini / Claude** – paste an API key.
- **OpenAI-compatible** – LM Studio, LocalAI, vLLM, OpenRouter and similar.
- **On-device** – runs the model in your browser or phone (WebGPU). Nothing leaves the device.

Turn **thinking** on or off in Settings, or per request in the model picker next to each AI button.

## Notifications

Because the add-on has Home Assistant API access, Tolle can send notifications through your notify services (e.g. `notify.mobile_app_your_phone`). Choose them in **Settings → Devices & notifications**. Browsers and the Tolle apps signed in to Tolle appear in the same screen automatically.

## Data & backups

Data is stored in `/data` inside the add-on, encrypted with a key in `/data/secret.key`. Home Assistant backups include it. Keep backups safe – anyone with the backup and the key can read the data.

## Support

Issues and ideas: https://github.com/shotgn16/Tolle/issues
