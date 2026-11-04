# Install Tolle on Linux

Works on any modern 64-bit Linux, on Intel/AMD (x64) and ARM (arm64, e.g. Raspberry Pi 4/5 with a 64-bit OS).

There are two ways to install:

- **With a desktop**: the Tolle app with its setup assistant (below).
- **A server with no screen**: one command in a terminal ([jump there](#a-server-with-no-screen)).

## With a desktop

### 1. Download

From the [latest release](https://github.com/shotgn16/Tolle/releases/latest), pick **one**:

| File | For |
|---|---|
| `Tolle-…-linux-amd64.deb` (or `-arm64.deb`) | Debian, Ubuntu, Linux Mint, Pop!_OS, Raspberry Pi OS |
| `Tolle-…-linux-x86_64.AppImage` (or `-arm64.AppImage`) | Any distribution (Fedora, Arch, openSUSE…). Also updates itself |

### 2a. Install the .deb

```sh
sudo apt install ./Tolle-*-linux-amd64.deb
```

Then open **Tolle** from your applications menu.

### 2b. Or run the AppImage

```sh
chmod +x Tolle-*.AppImage
./Tolle-*.AppImage
```

If nothing happens, install FUSE 2. On Ubuntu 24.04 that's `sudo apt install libfuse2t64`; on Ubuntu 22.04 and Debian it's `sudo apt install libfuse2`; on Fedora it's `sudo dnf install fuse`. Tools such as Gear Lever or AppImageLauncher add AppImages to your menu.

### 3. Set up Tolle

The setup assistant asks:

1. **How you'd like to use Tolle.** *Just me*, *me and my phone* (keeps running in the system tray and starts when you log in), *a server for several people* (a systemd service that starts with the computer – you'll be asked for your password), *Docker*, *Home Assistant* or *Connect to Tolle that's already running*.
2. **Which AI to use.** **Install Ollama on this computer** runs Ollama's official installer (it asks for your password) and downloads a model sized to your computer. See [Choosing an AI](ai.md) for the rest.
3. **Your account.** The first account is the administrator.

Click **Install**, then **Open Tolle** when it's done.

> **GNOME users:** the tray icon needs the *AppIndicator and KStatusNotifierItem Support* extension (installed by default on Ubuntu). Without it Tolle still runs; open it again from the applications menu.

If you use a firewall (e.g. `ufw`) and chose *this computer and my phone*, allow the port: `sudo ufw allow 8099/tcp`. The server option does this for you.

### Updates

The AppImage updates itself and asks you to restart. For the `.deb`, Tolle tells you when there's a new version: download it and run the same `apt install` command.

### Uninstall

- `.deb`: `sudo apt remove tolle-desktop`
- AppImage: delete the file.
- If you set Tolle up as a server: `sudo /opt/tolle/tolle-server service uninstall`.

Your data stays in `~/.local/share/tolle` (or `/var/lib/tolle` for a server) until you delete it.

## A server with no screen

For a Raspberry Pi, home server, NAS or cloud machine you reach over SSH:

```sh
curl -fsSL https://github.com/shotgn16/Tolle/releases/latest/download/install.sh | sh
```

This downloads the Tolle server for your processor and starts a setup assistant in the terminal:

```
How would you like to use Tolle?

  1. Just me, on this computer
  2. Me on this computer and my phone or tablet
  3. A server for several people (starts automatically, runs in the background)
  4. Install into Docker (here or on another machine)
  5. Install into Home Assistant as an app
```

Choose **3** for a normal server. The assistant can install Ollama and a model, then sets up a systemd service called `tolle` that starts at boot. It runs as a `tolle` user and keeps its data in `/var/lib/tolle`. At the end it prints the address to open, e.g. `http://192.168.1.20:8099`. Open it in a browser and create the first account; that account is the administrator.

Useful commands:

```sh
sudo systemctl status tolle        # is it running?
sudo journalctl -u tolle -f        # live log
sudo systemctl restart tolle       # restart
/opt/tolle/tolle-server --help     # everything else (info, ollama, docker, reset-password…)
```

To update, run the install command again and choose the same options. To remove: `sudo /opt/tolle/tolle-server service uninstall`.
