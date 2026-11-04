# Install Tolle on a Mac

Works on macOS 12 (Monterey) or newer, on Apple silicon (M1 and later) and Intel Macs.

## 1. Download

From the [latest release](https://github.com/shotgn16/Tolle/releases/latest), download:

- **`Tolle-…-macos-arm64.dmg`** for a Mac with Apple silicon (M1, M2, M3, M4…), or
- **`Tolle-…-macos-x64.dmg`** for an older Intel Mac.

Not sure which you have? Apple menu → **About This Mac**. "Chip: Apple M…" means Apple silicon; "Processor: Intel" means Intel.

## 2. Install

1. Open the `.dmg` file.
2. Drag **Tolle** onto the **Applications** folder.
3. Eject the disk image (right-click it on the desktop → Eject).

## 3. Open it the first time

Tolle isn't distributed through the App Store, so macOS asks you to confirm it once.

**macOS 15 (Sequoia) and newer**
1. Open **Tolle** from Applications. macOS says it couldn't verify Tolle. Click **Done**.
2. Open **System Settings → Privacy & Security** and scroll down to **Security**.
3. Next to "Tolle was blocked…", click **Open Anyway**, enter your password, then click **Open**.

**macOS 14 (Sonoma) and older**
1. In Applications, **Control-click** (or right-click) **Tolle** and choose **Open**.
2. Click **Open** in the message that appears.

You only need to do this once.

If macOS says Tolle "is damaged and can't be opened", open **Terminal** and run `xattr -cr /Applications/Tolle.app`, then try again. Downloaded apps that aren't notarised sometimes get this message.

## 4. Set up Tolle

The setup assistant asks:

1. **How you'd like to use Tolle.**
   - *Just me, on this computer*: Tolle runs only while the app is open.
   - *Me, on this computer and my phone*: Tolle keeps running in the menu bar (top right) so your phone can connect, and starts when you log in.
   - *A server for my family, group or church*: Tolle runs as a background service from start-up, even when nobody is logged in. You'll be asked for an administrator password.
   - *Docker*, *Home Assistant* or *Connect*: see [Docker](install-docker.md), [Home Assistant](install-home-assistant.md) or [Phones & tablets](phones-and-tablets.md).
2. **Which AI to use.** **Install Ollama on this computer** gives you free, private AI. Tolle installs Ollama into Applications and downloads a model sized to your Mac. Apple silicon Macs run local models well. See [Choosing an AI](ai.md) for the other options.
3. **Your account**: a username and password. The first account is the administrator.

Click **Install**, wait for it to finish, then click **Open Tolle**.

### Questions macOS may ask

- **"Do you want the application tolle-server to accept incoming network connections?"** Click **Allow** if you want your phone to connect.
- **"Tolle would like to find and connect to devices on your local network."** Click **Allow** if you use Ollama, Docker or Home Assistant on another machine.

## Connect your phone

**Tolle** menu → **Connect a phone or tablet…** shows a code to scan. See [Phones & tablets](phones-and-tablets.md).

## Updates

Tolle tells you when a new version is out. Download the new `.dmg` and drag Tolle into Applications again (choose **Replace**). Your data is kept.

## Uninstall

1. Quit Tolle (menu bar icon → Quit).
2. If you set it up as a server, first run **Tolle → Run setup again** and choose another option, or in Terminal: `sudo "/Library/Application Support/Tolle/server/tolle-server" service uninstall`.
3. Drag Tolle from Applications to the Bin.

Your data stays in `~/Library/Application Support/Tolle` (or `/Library/Application Support/Tolle` for a server) until you delete it.

## A Mac server with no screen

On a Mac mini or similar that you manage over SSH, open Terminal and run:

```sh
curl -fsSL https://github.com/shotgn16/Tolle/releases/latest/download/install.sh | sh
```

Choose **A server for several people** in the setup assistant.
