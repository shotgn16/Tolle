# Phones and tablets

The Tolle app for Android, iPhone and iPad works in one of two ways. You choose the first time you open it, and can switch later in **Settings → Account**.

| | **On this device only** | **Connect to a Tolle server** |
|---|---|---|
| Needs a computer or server | No | Yes – the desktop app, Docker or Home Assistant |
| Where your studies are kept | On the phone, encrypted | On your server, encrypted |
| Shared with your other devices | No (use backups to move them) | Yes |
| AI | On the phone, Ollama, ChatGPT, Gemini or Claude | Whatever the server uses (or on the phone) |
| Best for | One person, one phone or tablet | Several devices or several people |

Everything in Tolle works in both: study notes and uploads, passage study, insights, the study builder, calling, the Bible reader, the reading tracker and reminders.

## Android

1. On the phone, open the [latest release](https://github.com/shotgn16/Tolle/releases/latest) and download **`Tolle-…-Android.apk`**.
2. Open the downloaded file. If Android asks, allow your browser (or Files app) to **install unknown apps**, then go back and tap **Install**.
3. If **Play Protect** warns that it doesn't recognise the app, tap **More details → Install anyway**. Tolle is installed directly rather than from the Play Store, so Google hasn't scanned it.
4. Open Tolle and choose [On this device only](#using-tolle-on-its-own) or [Connect to a Tolle server](#connecting-to-your-tolle).

Works on Android 7 and newer, on phones and tablets.

> **Coming in 2027:** Google plans to require apps installed from outside the Play Store to come from registered developers on most Android phones. If installing gets harder then, the app's developer can register (free for small groups), or the app can be published on the Play Store.

## iPhone and iPad

Apple only allows apps from the App Store unless you sideload them, so there are three options. The first is easiest.

**Option 1 – add Tolle to your Home Screen (easiest, nothing to install)**
1. In Safari, open your Tolle address (e.g. `http://192.168.1.20:8099`).
2. Tap **Share** → **Add to Home Screen** → **Add**.

Tolle opens full-screen like an app and does almost everything the app does. This option needs a Tolle server; to use Tolle on its own, use option 2.

**Option 2 – sideload the app**
1. Download **`Tolle-…-iPhone-iPad-unsigned.ipa`** from the [latest release](https://github.com/shotgn16/Tolle/releases/latest) to your computer.
2. Install it with a sideloading tool such as **AltStore** or **Sideloadly**, signed in with your Apple ID. These tools sign the app for your device.
3. With a free Apple ID the app has to be refreshed every 7 days (AltStore can do this for you). A paid Apple Developer account lasts a year.
4. Open Tolle and choose [On this device only](#using-tolle-on-its-own) or [Connect to a Tolle server](#connecting-to-your-tolle). If Tolle asks to find devices on your **local network**, allow it (needed for a server or Ollama at home).

**Option 3 – build it with Xcode** (for developers; see the [developer guide](../developer/building.md#iphone-and-ipad)).

Works on iOS and iPadOS 15 and newer.

## Using Tolle on its own

Tap **On this device only**. Tolle opens **Settings → AI** so you can choose which AI writes your studies:

- **On-device** – the AI runs on the phone or tablet itself. Pick a model, tap **Download & test on this device**, and wait for the one-off download (about 1–2 GB, use Wi-Fi). After that it works with no internet. It needs a recent device with a capable graphics chip (for example iPhone 15 Pro or newer on iOS 26, or a recent Android flagship); if yours can't, Tolle says so – choose one of the options below instead. On-device models are smaller, so their studies are shorter and simpler.
- **Ollama** – a free AI on a computer at home. Choose **Ollama**, enter its address (e.g. `http://192.168.1.20:11434`) and pick a model. On that computer, Ollama must accept connections from other devices: set `OLLAMA_HOST=0.0.0.0` (the [AI guide](ai.md) shows how).
- **ChatGPT, Gemini or Claude** – choose the provider, paste an **API key** from its website, and pick a model. You pay the provider for what you use (usually a few pence per study).

Press **Save AI settings**. You can change the AI at any time, and choose a different one for a single study on its form.

Good to know:
- Passage studies, insights and note comparisons still read the study sites (StudyLight, Bible Study Tools, BibleProject…) and the Bible text over the internet, so these need a connection. Your own notes never leave the phone, except when you send them to an AI that isn't on the device.
- Your studies, uploads, reflections, reading history, settings and API keys are **encrypted** on the device.
- **Make backups.** Your studies only exist on this phone. In **Settings → Account → Back up and restore**, choose a password and tap **Make a backup**, then save the file somewhere safe (Files, iCloud Drive, Google Drive). To move to a new phone, install Tolle, choose *On this device only*, and tap **Restore a backup**.
- The daily reading reminder is a phone notification, so it arrives even when Tolle is closed. Turn it on in **Settings → Reading**.
- To start using a server later: **Settings → Account → Connect to a server**. What's on the phone stays there – back it up first if you want to keep it.

## Connecting to your Tolle

The phone needs to reach your Tolle:

- **At home:** be on the same Wi-Fi as the computer or server.
- **Away from home:** your Tolle needs an address that works over the internet, e.g. through Tailscale, Cloudflare Tunnel or a reverse proxy with HTTPS. Ask whoever set Tolle up.

Tap **Connect to a Tolle server**, then either:

- **Scan the code:** on the computer, open Tolle → **Settings → Devices & notifications → Connect a phone or tablet** (in the desktop app: **Tolle** menu → **Connect a phone or tablet…**). Point the phone's **camera** at the code and tap the link that appears. Tolle opens already connected.
- **Or type the address**, e.g. `192.168.1.20:8099`.

Then sign in with your account.

To switch servers later: **Settings → Account → Change server**. To use the app without the server: **Settings → Account → Use this device on its own**.

## Notifications on your phone

1. In the app: **Settings → Devices & notifications → Allow notifications on this device**.
2. Make sure your phone's **Notify** switch is on in the device list.

The app shows notifications whenever it's open or in the background. For notifications even when the app is closed, also tick your phone's Home Assistant notify service in the same screen, if you use Home Assistant.

## Time in the YouVersion app

*These need a Tolle server, because Home Assistant and Shortcuts send the time to its web address. On its own, log what you read in YouVersion from the Reading tracker.*

Tolle can log the time you spend in the YouVersion Bible app, then ask which passage you read.

**Android, through Home Assistant**
1. In the Home Assistant Companion app: **Settings → Companion app → Manage sensors**. Turn on **Last used app** and **Interactive**. For better timing, set *Sensor update frequency* to **Fast always**.
2. In Tolle: **Settings → Reading → Time in the YouVersion app**, tick your phone and click **Save**.

**iPhone, with Shortcuts**
1. **Shortcuts → Automation → + → App → Bible** (that's YouVersion) → **Is Opened** → **Run Immediately**.
2. Add **Get Contents of URL** with the URL shown in Tolle's settings, Method **POST**, Header `X-Api-Key` set to your key (also shown there), and Request Body **JSON** with `event` = `opened`.
3. Make a second automation for **Is Closed** with `event` = `closed`.

**Log the exact passage:** in YouVersion select the verses → **Share** → your Tolle shortcut. The steps are on the same settings screen.
