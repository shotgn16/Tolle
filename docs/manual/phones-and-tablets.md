# Phones and tablets

Tolle's phone and tablet apps connect to your Tolle: the desktop app in *this computer and my phone* or *server* mode, Docker, or Home Assistant. Your notes stay on your Tolle, not on the phone.

The phone needs to reach your Tolle:

- **At home:** be on the same Wi-Fi as the computer or server.
- **Away from home:** your Tolle needs an address that works over the internet, e.g. through Tailscale, Cloudflare Tunnel or a reverse proxy with HTTPS. Ask whoever set Tolle up.

## Android

1. On the phone, open the [latest release](https://github.com/shotgn16/Tolle/releases/latest) and download **`Tolle-…-android.apk`**.
2. Open the downloaded file. If Android asks, allow your browser (or Files app) to **install unknown apps**, then go back and tap **Install**.
3. If **Play Protect** warns that it doesn't recognise the app, tap **More details → Install anyway**. Tolle is installed directly rather than from the Play Store, so Google hasn't scanned it.
4. Open Tolle and [connect it to your server](#connecting-to-your-tolle).

Works on Android 7 and newer, on phones and tablets.

> **Coming in 2027:** Google plans to require apps installed from outside the Play Store to come from registered developers on most Android phones. If installing gets harder then, the app's developer can register (free for small groups), or the app can be published on the Play Store.

## iPhone and iPad

Apple only allows apps from the App Store unless you sideload them, so there are three options. The first is easiest.

**Option 1 – add Tolle to your Home Screen (easiest, nothing to install)**
1. In Safari, open your Tolle address (e.g. `http://192.168.1.20:8099`).
2. Tap **Share** → **Add to Home Screen** → **Add**.

Tolle opens full-screen like an app and does almost everything the app does.

**Option 2 – sideload the app**
1. Download **`Tolle-…-ios-unsigned.ipa`** from the [latest release](https://github.com/shotgn16/Tolle/releases/latest) to your computer.
2. Install it with a sideloading tool such as **AltStore** or **Sideloadly**, signed in with your Apple ID. These tools sign the app for your device.
3. With a free Apple ID the app has to be refreshed every 7 days (AltStore can do this for you). A paid Apple Developer account lasts a year.
4. Open Tolle and [connect it](#connecting-to-your-tolle). The first time, allow Tolle to find devices on your **local network**.

**Option 3 – build it with Xcode** (for developers; see the [developer guide](../developer/building.md#iphone-and-ipad)).

Works on iOS and iPadOS 15 and newer.

## Connecting to your Tolle

The first time the app opens, it asks for your server address. Either:

- **Scan the code:** on the computer, open Tolle → **Settings → Devices & notifications → Connect a phone or tablet** (in the desktop app: **Tolle** menu → **Connect a phone or tablet…**). Point the phone's **camera** at the code and tap the link that appears. Tolle opens already connected.
- **Or type the address**, e.g. `192.168.1.20:8099`.

Then sign in with your account.

To switch servers later: **Settings → Account → Change server**.

## Notifications on your phone

1. In the app: **Settings → Devices & notifications → Allow notifications on this device**.
2. Make sure your phone's **Notify** switch is on in the device list.

The app shows notifications whenever it's open or in the background. For notifications even when the app is closed, also tick your phone's Home Assistant notify service in the same screen, if you use Home Assistant.

## Time in the YouVersion app

Tolle can log the time you spend in the YouVersion Bible app, then ask which passage you read.

**Android, through Home Assistant**
1. In the Home Assistant Companion app: **Settings → Companion app → Manage sensors**. Turn on **Last used app** and **Interactive**. For better timing, set *Sensor update frequency* to **Fast always**.
2. In Tolle: **Settings → Reading → Time in the YouVersion app**, tick your phone and click **Save**.

**iPhone, with Shortcuts**
1. **Shortcuts → Automation → + → App → Bible** (that's YouVersion) → **Is Opened** → **Run Immediately**.
2. Add **Get Contents of URL** with the URL shown in Tolle's settings, Method **POST**, Header `X-Api-Key` set to your key (also shown there), and Request Body **JSON** with `event` = `opened`.
3. Make a second automation for **Is Closed** with `event` = `closed`.

**Log the exact passage:** in YouVersion select the verses → **Share** → your Tolle shortcut. The steps are on the same settings screen.
