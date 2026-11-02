<p align="center">
  <img src="tolle/logo.png" alt="Tolle" width="250">
</p>

<p align="center">
  <strong>An AI-assisted Bible study companion you host yourself.</strong><br>
  Home Assistant add-on · Docker · Android & iOS
</p>

<p align="center">
  <a href="https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fshotgn16%2FTolle">
    <img src="https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg" alt="Add repository to Home Assistant">
  </a>
</p>

---

> *Tolle lege, tolle lege* – “Take up and read, take up and read.”
> Augustine heard a child's voice singing these words, picked up the Scriptures, and his life changed (*Confessions*, Book VIII).

Tolle helps you take up and read: carefully, with good sources, checking everything against the text. It reads your own notes, researches passages on trusted study sites, builds studies for groups, walks with you in prayerful reflection on your calling, and tracks your time in the Word. **Everything AI writes is shown in purple**, so you always know what is yours and what is the AI's.

## Features

| | |
|---|---|
| ✎ **Study notes** | Write notes in the app, or upload PDFs, Word files, text and images – one at a time or in bulk. Choose whether many files make one study, each file is its own study, or set custom groups (e.g. 2 documents per study). Handwritten pages are transcribed by a vision AI model. |
| ✦ **Analyse & compare** | The AI reads your notes, finds the passages, researches them on **StudyLight, BibleStudyTools, BibleProject, Enduring Word** and the Bible text, and compares: where the sources agree, what they add, and what to examine further. |
| ⌕ **Passage study** | Enter passages plus a word, sentence or topic, choose the intensity (**Introduction, Study, Preach / Teach or In-depth**) and what it's for (personal, home group, preaching, teaching, youth, word study, one-to-one). |
| ✧ **Insights** | Insight on a passage, a doctrine/topic, or an area of life in biblical context – at the level of detail you choose. |
| ☷ **Study builder** | Plans for a small group, individual, meeting, one-to-one, youth, family or class: passage ideas, format and timings, leader notes and Observation / Interpretation / Application questions. |
| ♡ **Calling discernment** | Optional self-assessment, then a guided conversation of prayer, Scripture and reflection. The guide assumes nothing and responds to what you share, one step at a time. Includes a “pause to pray” timer and a reflection summary. |
| ◷ **Reading tracker** | Built-in Bible reader logs minutes, chapters and times automatically. Log reading done elsewhere by hand; a daily reminder prompts you if you haven't read. Time in the **YouVersion** app is logged automatically through Home Assistant (Android) or Shortcuts (iPhone), and Tolle asks which passage you read. Share verses from YouVersion to log them exactly. |
| 🔔 **Devices & notifications** | Every device that signs in is detected. Choose which receive notifications – plus Home Assistant notify services (Companion app). |
| 🤖 **Any AI** | **Ollama**, **OpenAI (ChatGPT)**, **Google Gemini**, **Anthropic Claude**, any **OpenAI-compatible** server (LM Studio, LocalAI, OpenRouter…), or **on-device** models that run in your browser/phone with WebGPU. Switch model per request and toggle **thinking mode** for models that support it. |
| 🔒 **Private & encrypted** | Username/password accounts, multiple users, and everything encrypted at rest. |

## Install

### Home Assistant add-on

1. Click the **Add repository** button above, or go to **Settings → Add-ons → Add-on Store → ⋮ → Repositories** and add  
   `https://github.com/shotgn16/Tolle`
2. Install **Tolle Bible Study**, start it, and turn on **Show in sidebar**.
3. Open **Tolle** from the sidebar and create your account.

The only option outside the app is an optional network port (add-on **Configuration → Network**) for the mobile apps. Full guide: [docs/home-assistant.md](docs/home-assistant.md).

### Docker

```bash
git clone https://github.com/shotgn16/Tolle.git
cd Tolle
docker compose up -d
```

Open `http://<your-server>:8099`. Full guide, including HTTPS and Ollama: [docs/docker.md](docs/docker.md).

### Android & iOS

The `mobile/` folder contains ready-to-open Android Studio and Xcode projects for the Google Play and App Store apps. They connect to your Tolle server. See [docs/mobile.md](docs/mobile.md).

**New here? Start with [GETTING_STARTED.md](GETTING_STARTED.md).**

## Documentation

- [User guide](docs/user-guide.md)
- [Home Assistant](docs/home-assistant.md) · [Docker](docs/docker.md) · [Mobile apps](docs/mobile.md)
- [AI providers & thinking mode](docs/ai-providers.md)
- [Research sources](docs/sources.md)
- [Security & encryption](docs/security.md)
- [Development & API](docs/development.md)

## Screens

AI notes are purple; your own notes are marked in teal.

<p align="center"><img src="docs/images/study.png" alt="A study with an AI note in purple and the user's own note" width="760"></p>

## Project layout

```
tolle/                  Home Assistant add-on (also the Docker build context)
  config.yaml            add-on manifest (Ingress, sidebar, port)
  Dockerfile             add-on image          Dockerfile.standalone   plain Docker image
  app/server/            FastAPI backend (Python)
  app/web/               web app (no build step) – also used by the mobile apps
mobile/                  Android (android/) and iOS (ios/) apps – Capacitor
docs/                    documentation
tests/                   smoke tests (run in GitHub Actions)
repository.yaml          makes this repo a Home Assistant add-on repository
docker-compose.yml       one-command Docker deployment
```

## A note on the study sites

Tolle fetches publicly available pages for your personal study, caches them for 30 days to keep traffic low, summarises rather than copies them, and links back to every page it uses. Please respect each site's terms of use. Sources are configurable in **Settings → Sources**.

## Licence

MIT – see [LICENSE](LICENSE). Bible text from [bible-api.com](https://bible-api.com) (public-domain translations).
