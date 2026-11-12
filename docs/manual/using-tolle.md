# Using Tolle

## Purple means AI

Everything the AI writes – analyses, research, insights, study plans, transcriptions, chat replies, the calling guide – appears in **purple** with an **AI** badge. Your own notes are marked in teal with a **You** badge. (Both colours can be changed – see [Appearance](#appearance).) AI notes can't be edited (so you always know what the AI actually said); use **Copy to my notes** to make an editable copy in your own words.

## Study depth

Most AI features let you choose how deep to go:

| Level | Best for | What you get |
|---|---|---|
| **Introduction** | a first look, new believers | plain language, main idea, simple context, a few questions (~500 words) |
| **Study** | personal or small-group study | context, structure, key words, cross references, commentators, discussion questions (~1,300 words) |
| **Preach / Teach** | sermons, talks, lessons | big idea, teaching outline, illustration ideas, applications, intro & conclusion |
| **In-depth** | serious study | setting, literary structure, exegesis, Hebrew/Greek word studies, interpretive views, biblical theology (2,500+ words) |

## Study notes

- **Write a note** – creates a study with your note. Markdown works (`# heading`, `- list`, `**bold**`).
- **Upload notes** – PDFs, Word (.docx), text/Markdown, HTML and images.
  - *All files → one study*: e.g. ten pages of one study.
  - *Each file → its own study*: e.g. a folder of separate studies.
  - *Custom groups*: give files the same study name to group them – e.g. two documents per study.
  - *Add to an existing study* from the “Where should they go?” list, or **Add files** inside a study.
- Photos and scanned PDFs are transcribed by an AI model that can read images, such as `gemma3:4b` in Ollama or any cloud AI. This handles handwriting well. The transcription appears as a purple note, and you can press **Transcribe with AI** on any image or PDF at any time. In Docker and Home Assistant, Tolle also reads printed text from images by itself (OCR), even without such a model.
- **Analyse & compare with sources** – the AI reads all your notes and files in the study, detects the passages, researches them, and writes: a summary of your notes, passages and themes, where the sources agree, what they add, points to examine further, and questions.
- **Research more into this study** – adds a passage study to the same study.

## Passage study

Enter passages (`John 15:1-17; Gal 5:22-23`) – recognised references appear as ✓ chips – plus an optional word, sentence or topic (“abide”, “bear much fruit”, “the Holy Spirit”). Choose the intensity and press **Research these passages**. The result is saved under Passage study.

**What it's for** shapes the notes (the same study types as LifeHub):

| What it's for | The notes contain |
|---|---|
| Personal study | Read and notice, what it shows about God, reflect and respond |
| Home group | Icebreaker, reading it together, look closer, what it means, live it out, leader's notes, O/I/A questions |
| Preaching | Exegetical notes, big idea, a 3–4 point outline with illustration ideas, introduction, application, conclusion, things to watch out for |
| Teaching | Learning aims, background, lesson plan with timings, key truths, activities |
| Youth & children | Opening activity, the story in simple words, big truth, response |
| Word & theme study | Key Greek/Hebrew words, the theme across Scripture, what it teaches |
| One-to-one | Reading together, conversation starters, what it means for us, a challenge for the week |

Add anything to keep in mind, such as “8 people, 45 minutes, some new to the Bible”.

## Insights

Pick **Bible passage**, **Topic** or **Area of life**, type your question (or tap a suggestion) and choose the level of detail. For topics and areas of life, Tolle first finds the key passages, then researches them.

## Study builder

Choose who it's for (small group, individual, meeting, one-to-one, youth, family, class or something else), then optionally passages, theme, group size, session length, number of sessions, format and notes about the people. Leave passages blank to get suggestions. The plan includes passage ideas, aims, a timed run-sheet, leader notes, Observation / Interpretation / Application questions, activities, prayer points and a take-home challenge.

## Bible chat

A conversation rather than a study: talk about anything on your mind – worry, grief, relationships, work, a decision, doubt, or a passage you're reading – and Tolle answers like a wise friend, with Bible passages (always with references) and practical, kind advice. It can offer a short prayer too.

- Open **Bible chat** (the **Chat** tab on phones), tap a suggestion or type your own, and send.
- Replies keep the whole conversation in mind. Use the ↻ button under the last reply to **ask again** for a different answer, and the copy button to copy a reply.
- Your conversations are listed on the chat screen and stored encrypted. **Rename** or **Delete** them from the top of a conversation.
- Replies are tasks, so you can leave the app while one is being written; it's there when you come back.

Tolle is an AI, not a pastor or counsellor. If you mention being in danger or thinking about harming yourself, it will encourage you to get help straight away. In the UK call **999** or Samaritans on **116 123**, or **112** across Europe. The way the chat answers can be changed in **Settings → AI instructions → Bible chat companion**.

## Calling

1. Optionally write what you'd like to bring to God, or tap a starter.
2. Optionally open the short **self-assessment** – five open questions, all optional.
3. **Begin a guided reflection.** The guide welcomes you, offers a short prayer, and asks one question. Reply in your own words; it responds to what you actually said with one next step – a question, a prayer to pray, or a passage to sit with.
4. **Pause to pray** opens a quiet two-minute timer.
5. **Summarise my reflection** writes a summary of what you shared, tentative themes, Scriptures, open questions and next steps. It will never tell you what your calling *is*.

Come back to a reflection any time from the list. Please share what you sense with a pastor or trusted believers.

## Bible & reading tracker

- **Bible** – choose book, chapter and translation. While a chapter is open (and the screen is visible) Tolle logs the time and the chapter. **Insight on this chapter** and **Passage study** jump straight into those features.
- **Reading tracker** – today's minutes against your goal, your streak, a 14-day chart (reading vs other time in the app) and every chapter with the time you read it.
- **Log reading** – for reading elsewhere (paper Bible, church, another app).
- **Time in the YouVersion app** – logged automatically through the Home Assistant Companion app (Android) or Shortcuts (iPhone); see [Phones & tablets](phones-and-tablets.md#time-in-the-youversion-app). Sessions appear as “Time in the Bible app”, count towards your streak, and Tolle can ask which passage you read.
- **Reminder** – **Settings → Reading → Reading reminder**. If you haven't logged any reading by the chosen time, Tolle notifies your selected devices with a link to log it.

## Tasks

AI work can take a few minutes. You don't have to wait on the screen: start a study, then read the Bible, look at other notes, or put the app away. The work carries on.

- **Tasks** in the menu (the pulse icon at the top of the phone screen) lists everything the AI is working on, with a count of what's still running.
- When a task finishes while you're on another screen, a message says it's ready. Tap **Open** to go straight to the result. Results are also saved in your study notes as usual.
- Finished tasks stay listed for two weeks. Remove one with **×**, or all of them with **Clear finished**.
- If you use an **on-device** AI model, it can only run while Tolle is open. A task that is waiting for it shows **Continue on this device**.
- If Tolle (or the app, when it runs on its own) was closed or restarted part-way through, the task shows *Didn't finish*. Run it again.

## Appearance

**Settings → Appearance** changes how Tolle looks on every device you sign in to:

- **Light or dark** – follow the device, or always light or always dark.
- **Main colour** – buttons, links and highlights. Pick one of the colours, or tap the rainbow circle to choose any colour.
- **AI colour** – everything the AI writes. Tolle warns you if it's too close to the main colour, so AI notes stay easy to spot.

Changes show straight away and are saved as you make them. **Back to the original colours** undoes everything.

## Devices & notifications

Every browser or app that signs in appears under **Settings → Devices & notifications** with its type, address and when it was last seen. Rename devices, choose which get notifications, send a test, or forget a device (signs it out). Allow notifications on each device with the button at the top. Home Assistant notify services (e.g. your phone's Companion app) can be added too.

## Users

Each user has a private, encrypted space. The administrator adds users under **Settings → Account**.

## For administrators: shaping Tolle for your group

- **Settings → Features** switches whole parts of Tolle on or off for everyone, for example hiding *Calling* on a church server. Nothing is deleted; switching a feature back on brings everything back.
- **Settings → AI instructions** changes the wording Tolle gives the AI: its ground rules, what each study depth covers, and how the calling guide behaves. Use it to suit your tradition or group (for example "Write for a church home group of mixed ages" or "Use British spelling"). **Reset** brings back the original, and updates never overwrite your changes.
