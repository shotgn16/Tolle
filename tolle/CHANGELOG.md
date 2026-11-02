# Changelog

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
