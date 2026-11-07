# Tolle user manual

*Tolle lege – take up and read.*

Tolle is a Bible study companion with AI help. It keeps your own notes and the AI's notes clearly apart (the AI is always in purple), researches passages on trusted study sites, helps you plan studies, guides prayerful reflection on your calling, and tracks your time in the Word.

Tolle is **yours**: it runs on your own computer, server, Docker or Home Assistant, and everything you store is encrypted.

## Start here: which setup do you need?

| You want… | Choose | Guide |
|---|---|---|
| Tolle on **one computer**, just for you | Install the desktop app → **Just me, on this computer** | [Windows](install-windows.md) · [Mac](install-macos.md) · [Linux](install-linux.md) |
| Tolle on your computer **and your phone or tablet** | Install the desktop app → **Me, on this computer and my phone**, then [install the phone app](phones-and-tablets.md) | same as above |
| One Tolle for your **family, home group or church**, each person with their own account | Install the desktop app on the computer that stays on → **A server for my family, group or church**. Everyone else uses the phone app, a browser or the desktop app in **Connect** mode | same as above |
| A **server with no screen** (Raspberry Pi, NAS, cloud machine) | Run one command in its terminal | [Linux & macOS servers](install-linux.md#a-server-with-no-screen) · [Windows Server](install-windows.md#windows-server-without-a-desktop) |
| Tolle in **Docker** | The desktop app can do it for you, or use Docker Compose | [Docker](install-docker.md) |
| Tolle in **Home Assistant** | The desktop app can do it for you, or add it in Home Assistant | [Home Assistant](install-home-assistant.md) |
| Someone has **already set Tolle up** and you just want to use it | Phone app, any browser, or the desktop app → **Connect to Tolle that's already running** | [Phones & tablets](phones-and-tablets.md) |

Not sure? Choose **Me, on this computer and my phone**. You can change your mind later in the desktop app: **Tolle → Run setup again**.

## Downloads

Everything is on the [Releases page](https://github.com/shotgn16/Tolle/releases/latest):

| Device | File |
|---|---|
| Windows 10 or 11 | `Tolle-…-Windows-x64-Setup.exe` |
| Mac with Apple silicon (M1 or later) | `Tolle-…-macOS-AppleSilicon.dmg` |
| Intel Mac | `Tolle-…-macOS-Intel.dmg` |
| Linux | `Tolle-…-Linux-x86_64.AppImage`, or `Tolle-…-Linux-amd64.deb` for Debian/Ubuntu (arm64 versions too) |
| Android phone or tablet | `Tolle-…-Android.apk` |
| iPhone or iPad | `Tolle-…-iPhone-iPad-unsigned.ipa` (see [phones & tablets](phones-and-tablets.md) – there's an easier option too) |

Each desktop installer contains everything Tolle needs. You don't need to install Python or anything else first.

## After installing

1. [First steps](first-steps.md): your account, choosing an AI, checking the study sites, notifications.
2. [Using Tolle](using-tolle.md): study notes, passage studies, insights, the study builder, calling, the Bible reader and reading tracker.

## More help

- [Choosing an AI](ai.md): Ollama, ChatGPT, Gemini, Claude or on-device, and what "thinking" does.
- [Study sites](study-sites.md): where Tolle researches, and how to add your own.
- [Phones & tablets](phones-and-tablets.md): Android, iPhone, iPad, connecting to your server, YouVersion time tracking.
- [Security, backups and updates](security-and-backups.md)
- [Troubleshooting](troubleshooting.md)

Developers and anyone who wants to change how Tolle works: see the [developer guide](../developer/README.md).
