# Android & iOS apps

The `mobile/` folder contains the Tolle mobile apps, built with [Capacitor](https://capacitorjs.com). The native projects are already generated and committed:

```
mobile/
  android/              Android Studio project (app id io.github.shotgn16.tolle)
  ios/                  Xcode project (Swift Package Manager, no CocoaPods needed)
  assets/               source icon and splash images
  capacitor.config.json app name, id and plugin settings
  scripts/copy-web.mjs  copies the shared web app (tolle/app/web) into the apps
  native/android/       optional extra Android plugin (see the end of this page)
```

The apps show the same interface as the web version and connect to your Tolle server (the Home Assistant add-on or Docker). On first launch they ask for the server address, then you sign in as usual.

What the native apps add:

- native notifications (reading reminders, "What did you read?", tests)
- on-device AI on recent phones (WebGPU in the system WebView)
- an app icon and splash screen

## Build and run

You need Node 20+, plus **Android Studio** for Android and/or **Xcode 16+ on a Mac** for iOS.

```bash
cd mobile
npm install
npm run android     # copies the web app, syncs, opens Android Studio → press Run
npm run ios         # same for Xcode (macOS only) → choose your team under Signing, press Run
```

Run `npm run sync` after changing anything in `tolle/app/web`. Run `npm run icons` after changing `mobile/assets/icon.png`.

## Connecting to your server

- At home: `http://<home-assistant-or-docker-ip>:8099`. For the add-on, first set the port under **Configuration → Network** (see [home-assistant.md](home-assistant.md#the-network-port-optional)).
- Anywhere: an HTTPS address, e.g. through a reverse proxy, Cloudflare Tunnel or Tailscale.

Plain `http://` addresses on your home network are allowed: Android through `allowMixedContent` in `capacitor.config.json`, iOS through `NSAllowsLocalNetworking` in `ios/App/App/Info.plist`. Use HTTPS for anything outside your home network and for app-store builds.

## Notifications

1. In the app: **Settings → Devices & notifications → Allow notifications on this device**.
2. The phone appears in the device list; check that **Notify** is on.

The app shows notifications whenever it's open or resumed. For notifications while it's fully closed, also tick your phone's Home Assistant **notify** service (Companion app) in the same screen, and Home Assistant delivers them as push notifications.

## Time in the YouVersion app

This works the same way as in LifeHub, and needs no special app permissions.

**Android, through Home Assistant**

1. In the Home Assistant Companion app: Settings → Companion app → Manage sensors → turn on **Last used app** and **Interactive** (screen on/off). Setting *Sensor update frequency* to **Fast always** gives better timing.
2. In Tolle: **Settings → Devices & notifications → Time in the YouVersion app**, tick your phone and save.

Every minute Tolle checks the sensors. Time counts only while YouVersion is in front **and** the screen is on. Short visits (under 45 seconds by default) are ignored, popping out for up to 2 minutes stays in the same session, and when a session ends Tolle can send one "What did you read?" notification.

**iPhone, with Shortcuts**

iOS doesn't share app usage with Home Assistant, so use two Shortcuts automations. The exact URL and your API key are shown in the same Settings card.

1. **Shortcuts → Automation → + → App**, choose **Bible** (YouVersion), **Is Opened**, **Run Immediately**.
2. Add **Get Contents of URL**: URL `https://<your Tolle address>/api/v1/bible/app`, Method **POST**, Header `X-Api-Key` = your key, Request Body **JSON** with `event` = `opened`.
3. Make a second automation for **Is Closed** with `event` = `closed`. Sessions are capped at 45 minutes in case a "closed" never arrives.

**Logging the exact passage (both platforms)**

The app's time can't tell Tolle *which* passage you read, but sharing from YouVersion can. Make a share-sheet shortcut (iPhone) or use any HTTP shortcut app (Android) that POSTs `{"reference": <shared text>}` to `https://<your Tolle address>/api/v1/bible/read` with the `X-Api-Key` header. Tolle understands both references like `John 3:16-18 NIV` and bible.com links.

## Optional: measuring other Bible apps directly (Android)

`mobile/native/android/BibleUsagePlugin.kt` uses Android's Usage Access permission to measure time in other Bible apps without Home Assistant. Installation steps are at the top of the file. Google Play restricts that permission, so it's best kept for personal or sideloaded builds. Most people should use the Home Assistant method above.

## Publishing to the stores

- The app id is `io.github.shotgn16.tolle`. Change it in `capacitor.config.json`, `android/app/build.gradle` and Xcode before the first upload if you want a different one; it can't change afterwards.
- **Google Play:** Android Studio → **Build → Generate Signed App Bundle**. Keep the keystore safe and out of git (`*.jks` is ignored).
- **App Store:** Xcode → **Product → Archive → Distribute App**. You need an Apple Developer account.
- Privacy policy: Tolle stores data only on the user's own server, and AI requests go to the provider the user chooses.
- Apple guideline 4.2 (minimum functionality): native notifications, on-device AI and the Bible reader help. Explain the self-hosted server in the review notes, and give reviewers a demo server and account.
