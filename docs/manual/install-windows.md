# Install Tolle on Windows

Works on Windows 10 and 11 (64-bit), and on Windows Server with a desktop.

## 1. Download

From the [latest release](https://github.com/shotgn16/Tolle/releases/latest), download **`Tolle-…-Windows-x64-Setup.exe`**.

## 2. Run the installer

1. Open the file you downloaded.
2. Windows may show **"Windows protected your PC"**. Tolle isn't sold through Microsoft, so Windows doesn't recognise it yet. Click **More info**, then **Run anyway**.
3. Accept the licence, choose where to install (the default is fine) and click **Install**.
4. Leave **Run Tolle** ticked and click **Finish**.

Tolle adds itself to the Start menu and the desktop.

## 3. Set up Tolle

The setup assistant opens the first time. It asks three things:

1. **How you'd like to use Tolle.**
   - *Just me, on this computer*: Tolle runs only while the app is open, and nothing else can reach it.
   - *Me, on this computer and my phone*: Tolle keeps running in the notification area (bottom right, next to the clock) so your phone can connect. It starts when you sign in to Windows.
   - *A server for my family, group or church*: Tolle runs as a background service from start-up, even when nobody is signed in. Windows asks for administrator permission once.
   - *Docker*, *Home Assistant* or *Connect*: see [Docker](install-docker.md), [Home Assistant](install-home-assistant.md) or [Phones & tablets](phones-and-tablets.md).
2. **Which AI to use.** The simplest private option is **Install Ollama on this computer**: Tolle downloads it and a model sized to your PC (a few gigabytes, once). You can also use ChatGPT, Gemini or Claude with an API key, an Ollama on another computer, or decide later. See [Choosing an AI](ai.md).
3. **Your account**: a username and password. The first account is the administrator.

Click **Install** and wait. The assistant shows what it's doing, and the AI download takes the longest. When it's done, click **Open Tolle** and you're signed in.

### "Windows Defender Firewall has blocked some features"

If you chose *this computer and my phone* or *server*, Windows asks whether **tolle-server** may use the network. Tick **Private networks** and click **Allow access**, so your phone can reach Tolle. (For the server option, Tolle opens the port itself.)

## Connect your phone

In Tolle, open **Settings → Devices & notifications → Connect a phone or tablet → Show the code**, or use the **Tolle** menu → **Connect a phone or tablet…**. Then follow [Phones & tablets](phones-and-tablets.md).

## Updates

Tolle checks for updates when it starts and downloads them in the background. When one is ready it asks you to restart. You can also check yourself: **Tolle → Check for updates**.

## Uninstall

If you set Tolle up as a **server**, remove its background service first: open Tolle → **Tolle → Run setup again** and choose *Just me*. Alternatively, run this afterwards in an Administrator PowerShell: `& "C:\Program Files\Tolle Server\tolle-server.exe" service uninstall`.

Then: **Settings → Apps → Installed apps → Tolle → Uninstall.**

Your data is kept in `%LOCALAPPDATA%\Tolle` (or `C:\ProgramData\Tolle` for a server) in case you reinstall. Delete that folder to remove your data too.

## Windows Server without a desktop

On Server Core, open **PowerShell as Administrator** and run:

```powershell
irm https://github.com/shotgn16/Tolle/releases/latest/download/install.ps1 | iex
```

It downloads the Tolle server and starts a short setup assistant in the window. Choose **A server for several people** to run Tolle from start-up. Then open `http://<server address>:8099` from another computer to create the first account.
