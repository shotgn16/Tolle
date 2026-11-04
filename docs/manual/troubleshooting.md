# Troubleshooting

## Installing

| Problem | What to do |
|---|---|
| Windows: "Windows protected your PC" | Click **More info → Run anyway**. Tolle isn't signed with a paid Microsoft certificate yet. |
| Mac: "Apple could not verify Tolle…" | **System Settings → Privacy & Security → Open Anyway**. See [Mac](install-macos.md#3-open-it-the-first-time). |
| Mac: "Tolle is damaged and can't be opened" | In Terminal: `xattr -cr /Applications/Tolle.app`, then open it again. |
| Linux: the AppImage doesn't start | Install FUSE 2 (`sudo apt install libfuse2t64` on Ubuntu 24.04, `libfuse2` on older versions), and make the file executable (`chmod +x`). |
| Linux: no tray icon on GNOME | Install the *AppIndicator and KStatusNotifierItem Support* extension. |
| Android: "App not installed" | An older Tolle signed with a different key is installed. Uninstall it, then install again. |
| Android: Play Protect blocks it | Tap **More details → Install anyway**. |

## The setup assistant

| Problem | What to do |
|---|---|
| "Installing Ollama… failed" | Install Ollama yourself from [ollama.com/download](https://ollama.com/download), open it once, then **Back → Install** again. The assistant notices Ollama is already there. |
| The model download is slow or stops | It's several gigabytes. Click **Try again**: Ollama continues where it stopped. |
| "Administrator permission was not given" | The *server* option needs an administrator password once. Choose *this computer and my phone* if you can't give one. |
| Docker: "Docker isn't installed / isn't running" | Install [Docker Desktop](https://www.docker.com/products/docker-desktop/), start it, wait until it says it's running, then continue. |
| Docker: "port is already allocated" | Something else uses port 8099. Go back and choose another port, e.g. 8100. |
| Home Assistant: "didn't accept the access token" | Create a new long-lived token **while signed in as an administrator** and paste the whole thing. |
| Home Assistant: "can't install apps" | You have Home Assistant Container or Core, which have no apps. Use the Docker option instead. |
| "Tolle already has accounts there" | You're running setup again. Tick **sign in with an existing account** on the account step. |

## Using Tolle

| Problem | What to do |
|---|---|
| "Couldn't reach Ollama" | Check Ollama is running. If it's on another computer, use that computer's address (not `localhost`), and start Ollama there with `OLLAMA_HOST=0.0.0.0`. |
| Studies are slow | Local models depend on your hardware. Choose a lower depth, a smaller model (e.g. `qwen3:4b`), turn Thinking off, or use a cloud AI. |
| A study repeats itself | Tolle stops and cleans repetition automatically. If it keeps happening, see [Choosing an AI](ai.md#if-a-study-repeats-itself). |
| A source shows ✗ "unavailable" | The site may be down or have changed. **Settings → Sources → Test** and edit its address ([how](study-sites.md)). |
| Photos of handwritten notes aren't read | Choose a model that can read images (e.g. `gemma3:4b` in Ollama, or a cloud AI) and press **Transcribe with AI** on the file. |
| No notifications | Allow notifications on the device, check its **Notify** switch, and keep Tolle open or in the background. On phones, also allow notifications for the Tolle app in the phone's settings. |

## Phones and other computers can't connect

1. Make sure Tolle on the computer is set up for *this computer and my phone* or *server*. *Just me* only allows the computer itself.
2. Phone and computer must be on the **same network** (not guest Wi-Fi).
3. Use the address shown in **Settings → Devices & notifications → Connect a phone or tablet**, including the port (`:8099`).
4. Allow Tolle through the firewall: on Windows, *Allow access* for private networks; on Mac, *Allow incoming connections*; on Linux, `sudo ufw allow 8099/tcp`.
5. Home Assistant: give the Tolle app a port under **Configuration → Network**.
6. iPhone: allow Tolle to find devices on your **local network** (Settings → Privacy & Security → Local Network → Tolle).

## Logs

| Where Tolle runs | Log |
|---|---|
| Desktop app | Windows `%APPDATA%\Tolle\logs\server.log`, macOS `~/Library/Application Support/Tolle Desktop/logs/server.log`, Linux `~/.config/Tolle/logs/server.log` |
| Linux server | `sudo journalctl -u tolle -f` |
| Mac server | `/Library/Application Support/Tolle/server.log` |
| Docker | `docker logs -f tolle` |
| Home Assistant | the **Log** tab on the Tolle app page |

Still stuck? [Open an issue](https://github.com/shotgn16/Tolle/issues) and include what you were doing and the end of the log.
