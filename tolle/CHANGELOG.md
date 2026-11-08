# Changelog

## 0.3.1

**Phones and tablets: layout fixes**
- The top bar no longer grows tall on short pages, so the menu button stays at the top (Study notes,
  Bible, Tasks and others).
- No page is wider than the screen any more. Settings used to push past the edge on phones and iPads.
- Long AI model names are shortened in the top bar, and long button labels wrap on small phones.
- Every screen is now checked on Android phones, iPhones (including the small SE), and iPads in both
  orientations, in light and dark mode, before each release.
- On its own, the Bible reader's "couldn't load" message now says to check this device is online.

## 0.3.0

**The phone and tablet apps work on their own**
- New first-launch choice: **On this device only** or **Connect to a Tolle server** (switch any time in
  Settings → Account).
- On its own, everything works on the phone or tablet with no computer or server: study notes and
  uploads (PDF, Word, text, images), passage study, insights, the study builder, calling, the Bible
  reader, the reading tracker and daily reminders.
- Choose the AI in Settings: a model running on the device (works offline after a one-off download),
  Ollama on your network, or ChatGPT, Gemini or Claude with your own API key.
- Everything stored on the device is encrypted (AES-256-GCM), and password-protected backups let you
  keep a copy or move to a new phone.
- The daily reading reminder is a phone notification, so it arrives even when Tolle is closed.

**Downloads named like LifeHub's**
- `Tolle-<v>-Android.apk`, `Tolle-<v>-iPhone-iPad-unsigned.ipa`, `Tolle-<v>-macOS-AppleSilicon.dmg`,
  `Tolle-<v>-macOS-Intel.dmg`, `Tolle-<v>-Windows-x64-Setup.exe`, `Tolle-<v>-Linux-…` and
  `Tolle-Server-<v>-…` for headless servers.
- Release by running **Actions → Build installers** with a version number; GitHub builds everything and
  publishes the release.

**Tasks**
- New **Tasks** screen (menu, and the pulse icon on phones) shows AI work in progress and finished, so
  nothing is lost if you leave the screen or put the app in the background.
- A message with an **Open** button appears when a task finishes while you're elsewhere.
- Tasks are kept across restarts; on-device AI tasks can be continued from the list.

**Other changes**
- The on-device AI library is included in the app instead of loading from the internet.
- Opening uploaded files and saving backups uses the share sheet in the phone apps.

## 0.2.0

**Install Tolle anywhere**
- Installers for Windows, macOS (Apple silicon and Intel) and Linux (AppImage and .deb, x64 and arm64).
  Everything Tolle needs is included – no Python or other downloads.
- A setup assistant asks how you want to use Tolle and does the rest: just this computer, this computer
  plus your phone, a server for several people (runs as a background service from start-up), Docker
  (here or on another machine), Home Assistant, or connecting to Tolle that's already running.
- It can install Ollama and download an AI model sized to your computer, or set up ChatGPT, Gemini or
  Claude, and it creates your account so Tolle opens ready to use.
- Headless servers: `install.sh` (Linux/macOS) and `install.ps1` (Windows) with a setup assistant in the
  terminal, and a `tolle-server` command for everything else.
- Android app (APK) and iPhone/iPad app; scan a code on the computer to connect a phone.
- The desktop app updates itself on Windows and Linux (AppImage).

**Easier to customise**
- Settings → Features: switch parts of Tolle on or off for everyone.
- Settings → AI instructions: change the wording Tolle gives the AI (tone, tradition, what each depth
  covers) without touching code.
- The code is split into a core and self-contained features, with a template and a developer guide for
  adding your own. Name, wording and colours live in two small files.

**Fixes**
- Docker installs now listen on the network, so they're reachable from outside the container.
- PDF pages are rendered with a bundled library (no Poppler needed).

## 0.1.1

- Fixed: AI studies could get stuck repeating a phrase (common with smaller local models). Tolle now
  sizes Ollama's context window to each request, asks Ollama to penalise repetition, stops a loop as
  soon as it starts, retries once, and never saves the repeated text.
- New: Settings → AI → Ollama context window and longest answer.
- The In-depth level no longer pushes models to pad their answers to a word count.

## 0.1.0

First release.

- Study notes: write, upload (single or bulk with grouping), OCR and AI transcription of images/scanned PDFs
- AI analysis comparing your notes with StudyLight, BibleStudyTools, BibleProject, Enduring Word and the Bible text
- Passage study with four intensity levels (Introduction, Study, Preach / Teach, In-depth)
- Insights on passages, topics and areas of life
- Study builder for groups, individuals, meetings, one-to-ones, youth, families and classes
- Calling discernment: optional self-assessment, guided prayer and reflection, summary
- Bible reader with automatic reading tracking, manual logging, streaks and daily reminders
- Time in the YouVersion app via Home Assistant Companion sensors (Android) or Shortcuts (iPhone); share a passage to log it
- Study purposes from LifeHub (personal, home group, preaching, teaching, youth, word study, one-to-one)
- Device detection, per-device notifications and Home Assistant notify services
- AI providers: Ollama, OpenAI, Gemini, Anthropic, OpenAI-compatible and on-device (WebLLM); thinking mode toggle; per-request model choice
- Accounts with multiple users; all content encrypted at rest
