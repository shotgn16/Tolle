# Getting started with Tolle

A step-by-step checklist for getting Tolle running for you, in order. Each step links to the full guide.

## 1. Let GitHub build the images (5 minutes, once)

Pushing to `main` starts the **Build & publish** workflow (repository → **Actions**). It runs the tests, then publishes the Home Assistant add-on images and the Docker image to GitHub Packages.

When it has finished (green tick):

1. Go to your GitHub profile → **Packages**.
2. Open `amd64-addon-tolle`, `aarch64-addon-tolle` and `tolle`, and for each one choose **Package settings → Change visibility → Public**. Home Assistant can't download private images.
3. In `tolle/config.yaml`, delete the `#` in front of `image: "ghcr.io/shotgn16/{arch}-addon-tolle"`, then commit and push.

You can skip this step: Home Assistant will build the add-on itself the first time, which just takes longer.

## 2. Install the add-on in Home Assistant

1. **Settings → Add-ons → Add-on Store → ⋮ → Repositories** → add `https://github.com/shotgn16/Tolle`.
2. Install **Tolle Bible Study**, press **Start**, and turn on **Show in sidebar**.
3. Open **Tolle** in the sidebar and create your account. The first account is the administrator.

Full guide: [docs/home-assistant.md](docs/home-assistant.md). If you'd rather not use Home Assistant, see [docs/docker.md](docs/docker.md).

## 3. Choose an AI

In Tolle: **Settings → AI**.

- **Local and private:** Ollama. Pull `qwen3:8b` (it supports thinking) and `gemma3:4b` (it reads photos of handwritten notes), then enter Ollama's address.
- **Cloud:** paste an OpenAI, Gemini or Claude API key.
- **On-device:** runs a small model in the browser or phone you're using.

Press **Save and refresh**, then pick a default model. Turn **Thinking** on if your model supports it. You can change the model for any single request from the picker next to each AI button.

More: [docs/ai-providers.md](docs/ai-providers.md).

## 4. Check the study sites

**Settings → Sources → Test** each source with a reference such as `John 3:16`. StudyLight uses the same address as LifeHub. If a site has changed its layout, edit its address pattern there ([docs/sources.md](docs/sources.md)).

## 5. Notifications and reading tracking

In **Settings → Devices & notifications**:

1. **Allow notifications on this device**, on each phone or browser you use.
2. Tick the Home Assistant notify services that should get reminders, for example your phone's Companion app.
3. Turn on the **reading reminder** and choose a time.
4. **Time in the YouVersion app:**
   - **Android:** in the Companion app, turn on the **Last used app** and **Interactive** sensors, then tick your phone here.
   - **iPhone:** follow the Shortcuts steps shown on the same card. The URL and your API key are filled in for you.

Details: [docs/mobile.md](docs/mobile.md#time-in-the-youversion-app).

## 6. The mobile apps (when you're ready)

The apps are in `mobile/`. Before the phone app can connect, set a port for the add-on under **Configuration → Network** (e.g. `8099`).

```bash
cd mobile
npm install
npm run android     # opens Android Studio
npm run ios         # opens Xcode (Mac only)
```

Store publishing checklist: [docs/mobile.md](docs/mobile.md#publishing-to-the-stores).

## 7. Keep it safe

- Back up the add-on (Home Assistant backups include Tolle's data) or, with Docker, the `./data` folder.
- `secret.key` in that data folder is the encryption key. Without it the data can't be read, and anyone with it and a backup can read everything.
- Use HTTPS for anything outside your home network ([docs/security.md](docs/security.md)).

## Releasing an update

1. Change `version` in `tolle/config.yaml` (also `VERSION` in `tolle/app/server/config.py` and `mobile/package.json`).
2. Add a line to `tolle/CHANGELOG.md`.
3. Commit and push. GitHub builds the new images, and Home Assistant shows **Update** on the add-on.
