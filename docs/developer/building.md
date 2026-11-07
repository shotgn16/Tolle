# Building and releasing

GitHub builds everything for you, the same way as LifeHub: run one workflow with a version number and it builds every installer and app file and publishes them on the Releases page. Building locally is only needed while you're developing.

## Release a new version

1. Add what changed to `tolle/CHANGELOG.md` under a `## 0.3.0` heading and push it. The release notes are made from it.
2. On GitHub: **Actions → Build installers → Run workflow**, type the version (`0.3.0`) and press **Run workflow**.

The workflow sets the version in every app, builds everything, then creates the `v0.3.0` tag and the release itself. (Pushing a tag yourself – `git tag v0.3.0 && git push origin v0.3.0` – does the same.) To keep the version in the repository in step, run `python3 scripts/set-version.py 0.3.0` and commit.

Leave the version empty to only build: the files are then attached to the run as *artifacts* (scroll to the bottom of the run's page) and nothing is published.

About 25 minutes later the release appears with:

| File | What it is |
|---|---|
| `Tolle-<v>-Windows-x64-Setup.exe` | Windows installer |
| `Tolle-<v>-macOS-AppleSilicon.dmg`, `…-macOS-Intel.dmg` | Mac app for Apple silicon and Intel |
| `Tolle-<v>-Linux-x86_64.AppImage`, `…-Linux-amd64.deb` (and `arm64`) | Linux app |
| `Tolle-Server-<v>-<platform>.tar.gz` / `.zip` | the server alone, for machines with no screen |
| `install.sh`, `install.ps1` | one-line installers that download the right server |
| `Tolle-<v>-Android.apk` | Android app |
| `Tolle-<v>-iPhone-iPad-unsigned.ipa` | iPhone and iPad app, for sideloading |
| `SHA256SUMS.txt` | checksums |

Pushing to `main` (without a tag) runs the tests and publishes the Docker and Home Assistant images (**Test & container images**, `build.yaml`). Home Assistant offers the update when `version` in `tolle/config.yaml` changes.

If one platform fails to build, the release still publishes everything else. Fix it and run the workflow again with the same version to add the missing files.

Before building, the workflow also tests the phone app running on its own (`tests/device/device-mode.mjs`) in a headless browser: every feature against fake study sites and a fake Ollama, with the prompts checked word-for-word against the server's. Its screenshots are attached to the run.

## Signing

Signing proves who made the app. Tolle builds without any signing set up, but some things work better with it. All signing keys are stored as **repository secrets** (GitHub → your repository → **Settings → Secrets and variables → Actions → New repository secret**). They are never written into the code.

### Android (recommended)

Android only installs an update if it's signed with the **same key** as the version already on the phone. Without a key, every build uses a new temporary one, so people would have to uninstall before each update.

1. Create a key once, and keep it safe forever (a password manager is a good place). Losing it means people must reinstall the app to get updates.
   ```bash
   keytool -genkeypair -keystore tolle-release.jks -storetype PKCS12 -alias tolle \
     -keyalg RSA -keysize 4096 -validity 10950 -dname "CN=Tolle"
   ```
2. Add four repository secrets:

   | Secret | Value |
   |---|---|
   | `ANDROID_KEYSTORE_BASE64` | the key file as text: `base64 -w0 tolle-release.jks` (macOS: `base64 -i tolle-release.jks`; Windows PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("tolle-release.jks"))`) |
   | `ANDROID_KEYSTORE_PASSWORD` | the password you chose |
   | `ANDROID_KEY_ALIAS` | `tolle` |
   | `ANDROID_KEY_PASSWORD` | the same password |

3. Run **Build installers** again. The build log's *Check the APK* step shows the key's fingerprint.

### macOS (optional)

Without signing, the Mac app gets an ad-hoc signature, and people confirm it once in **System Settings → Privacy & Security** ([manual](../manual/install-macos.md)). To remove that step you need an [Apple Developer account](https://developer.apple.com/programs/) (paid yearly), then add these secrets:

| Secret | Value |
|---|---|
| `CSC_LINK` | your *Developer ID Application* certificate (.p12), as base64 |
| `CSC_KEY_PASSWORD` | the certificate's password |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | for notarisation |

### Windows (optional)

Without signing, Windows SmartScreen shows "Windows protected your PC" until enough people have installed the app ([manual](../manual/install-windows.md)). With a code-signing certificate, add `WIN_CSC_LINK` (the .pfx, as base64) and `WIN_CSC_KEY_PASSWORD`.

## Build locally

### The server program

```bash
pip install -r tolle/app/requirements.txt -c packaging/server/constraints.txt pyinstaller
cd packaging/server
pyinstaller --noconfirm --distpath ../../build/server --workpath ../../build/work tolle-server.spec
../../build/server/tolle-server/tolle-server selftest
```

The result in `build/server/tolle-server/` runs without Python installed. Build on each system you want to support: PyInstaller can't cross-compile.

### The desktop app

Build the server program first (above), then:

```bash
cd packaging/desktop
npm install
npx electron-builder --win      # or --mac, or --linux
```

The installer appears in `packaging/desktop/dist/`. Mac apps have to be built on a Mac.

### Android

Needs Android Studio (or the Android SDK and Java 21).

```bash
cd mobile
npm install
npm run sync
cd android && ./gradlew assembleRelease     # app/build/outputs/apk/release/
```

Or `npm run android` to open the project in Android Studio and run it on a phone.

### iPhone and iPad

Needs a Mac with Xcode.

```bash
cd mobile
npm install
npm run ios          # opens Xcode
```

In Xcode: select the **App** target → **Signing & Capabilities** → choose your team (a free Apple ID works for your own devices). Connect your iPhone or iPad and press **Run**. The same app runs on iPhone and iPad.

To publish on the App Store you need a paid Apple Developer account. Then use **Product → Archive → Distribute App** in Xcode. The [phones and tablets manual](../manual/phones-and-tablets.md) covers the options for people who install the unsigned `.ipa`.

## Version numbers

`tolle/app/VERSION` is the single source of the version. `scripts/set-version.py` copies it into the Home Assistant app, the desktop and mobile `package.json` files and the iOS project. Android reads it directly when it builds. Android's internal version code is worked out from it (0.3.0 → 3000), so it always increases.
