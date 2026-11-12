# Run Tolle in Home Assistant

Tolle can run inside Home Assistant as an **app** (Home Assistant used to call these *add-ons*), with its own panel in the sidebar. This needs **Home Assistant OS** or a **Supervised** install. If you run *Home Assistant Container* or *Core*, use [Docker](install-docker.md) instead.

## The easy way: let the desktop app do it

1. Install the desktop app on any computer on the same network ([Windows](install-windows.md), [Mac](install-macos.md), [Linux](install-linux.md)).
2. In Home Assistant, signed in as an **administrator**, click your name (bottom left) → **Security** → **Long-lived access tokens** → **Create token**. Name it "Tolle installer" and copy the token.
3. In Tolle's setup assistant choose **Install it in Home Assistant**. Enter your Home Assistant address (e.g. `http://homeassistant.local:8123`) and paste the token.
4. Choose an AI and create your account, then click **Install**.

The assistant adds the Tolle repository and installs and starts the app. It also turns on the sidebar panel, and opens port 8099 so phones and the desktop app can connect directly. Then it creates your account and sets up the AI. The token is only used during the install and isn't saved; you can delete it in Home Assistant afterwards.

## The manual way

1. Click this button:

   [![Add the Tolle repository to Home Assistant](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fshotgn16%2FTolle)

   Or do it by hand: **Settings → Apps → Install app**, then **⋮** (top right) → **Repositories**. Paste `https://github.com/shotgn16/Tolle` and click **Add**.
2. Find **Tolle Bible Study** in the list (refresh the page if it isn't there yet) and click **Install**.
3. Click **Start**, and turn on **Show in sidebar**. *Start on boot* and *Watchdog* are good to turn on too.
4. Click **Tolle** in the sidebar and create your account. The first account is the administrator.

## Signing in

Open Tolle from the Home Assistant sidebar and sign in to your Tolle account **once**. Tolle remembers which Home Assistant user you are, and from then on signs you in automatically whenever you open it from Home Assistant: after a restart, an update, a cleared cache or on a new phone. Each Home Assistant user is linked to their own Tolle account. **Sign out** in Tolle (Settings → Account) turns this off for that Home Assistant user until they sign in again.

This only works through the Home Assistant sidebar. Anyone connecting to port 8099 directly (the phone apps, the desktop app) still signs in with a username and password.

## Phones and other computers

The sidebar panel works anywhere you can use Home Assistant, including the Home Assistant Companion app.

To use the **Tolle phone app** or the desktop app in *Connect* mode, Tolle needs its own port:

1. Open the Tolle app page in Home Assistant → **Configuration** → **Network**.
2. Set `8099/tcp` to `8099` (or another free port) and click **Save**. Then restart the app.
3. Connect to `http://<Home Assistant address>:8099`, for example `http://homeassistant.local:8099`. In Tolle, **Settings → Devices & notifications** shows a code your phone can scan.

For use outside your home, put that port behind HTTPS, e.g. with the Nginx Proxy Manager, Cloudflared or Tailscale apps.

## Notifications through Home Assistant

Tolle can send reminders through your Home Assistant notify services, for example the Companion app on your phone. In Tolle: **Settings → Devices & notifications**, tick the services to use, then click **Send test to all**. No token is needed when Tolle runs inside Home Assistant.

## Time in the YouVersion app

On Android, Tolle can log time spent in the YouVersion Bible app using the Companion app's sensors. See [Phones & tablets](phones-and-tablets.md#time-in-the-youversion-app).

## Backups and updates

- Home Assistant backups include Tolle's data (its encrypted database, uploads and key).
- Updates appear on the app page in Home Assistant. Click **Update**.

## AI for Tolle in Home Assistant

Most Home Assistant machines are too small to run a good AI model themselves. Good choices:

- Ollama on a PC with a graphics card on your network (enter its address in **Settings → AI**), or
- ChatGPT, Gemini or Claude with an API key.

See [Choosing an AI](ai.md).
