"""Prompt templates for every AI feature."""

LEVEL_GUIDE = {
    "intro": (
        "LEVEL: Introduction. Plain, warm language for someone new to this passage or topic. "
        "About 400–700 words. Cover what it says, the simple context, the main idea, one or two cross references "
        "and 3 reflection questions. Avoid technical terms; explain any you must use."
    ),
    "study": (
        "LEVEL: Study. A solid personal or small-group study, about 1,000–1,600 words. Cover historical and literary "
        "context, the flow/structure of the passage, key words (with Hebrew/Greek only where it genuinely helps), "
        "cross references, what the commentators highlight, application and 5–7 discussion questions."
    ),
    "preach": (
        "LEVEL: Preach / Teach. Material for preparing a sermon, talk or lesson, about 1,400–2,000 words. Give a "
        "one-sentence big idea, a clear teaching outline with 3–4 points tied to the verses, explanation under each "
        "point, illustration ideas (described, not invented stories presented as true), applications for different "
        "listeners, a suggested introduction and conclusion, and the key cross references."
    ),
    "deep": (
        "LEVEL: In-depth. A thorough exegetical study, 2,500 words or more. Cover authorship/date/setting, genre and "
        "literary structure, verse-by-verse or section-by-section exegesis, original-language word studies "
        "(transliterate and give the Strong's number when confident), textual or translation issues, how major "
        "interpretive traditions read it (presented fairly), biblical-theological connections across the canon, "
        "and careful application. Note where the sources disagree."
    ),
}


def system_base(perspective: str = "") -> str:
    p = (f"The user describes their tradition as: {perspective}. Be sensitive to it, but still present other "
         "faithful views where Christians disagree.") if perspective else (
        "Do not assume a denomination; where Christians disagree, present the main views fairly.")
    return (
        "You are Tolle, a careful, humble Bible study assistant. Like the Bereans in Acts 17:11 you examine the "
        "Scriptures to see whether things are so.\n"
        "Rules:\n"
        "- Ground what you say in the biblical text and in the SOURCES provided. When you rely on a source, cite it "
        "inline as a Markdown link, e.g. ([StudyLight – Matthew Henry](url)).\n"
        "- Keep three things distinct: what the text says, what the commentators/sources say, and your own synthesis.\n"
        "- Never invent quotations, verse numbers, original-language words, authors or sources. If you are unsure, "
        "say so plainly. Do not quote long passages from the commentaries; summarise them in your own words.\n"
        "- Quote Scripture accurately from the provided Bible text when available and name the translation.\n"
        f"- {p}\n"
        "- Format with Markdown headings, short paragraphs and lists. Do not wrap the answer in a code block."
    )


def sources_block(text: str) -> str:
    return f"\n\n<SOURCES>\n{text}\n</SOURCES>"


# ---------------------------------------------------------------- study notes
def notes_analysis(title: str, notes: str, refs: list[str], src: str, level: str) -> str:
    return (
        f"The user has uploaded or written their own study notes titled \"{title}\". Read them carefully, then "
        "compare them with the research SOURCES.\n\n"
        f"{LEVEL_GUIDE.get(level, LEVEL_GUIDE['study'])}\n\n"
        "Produce these sections:\n"
        "## Summary of your notes — a faithful summary of what the user wrote (do not change their meaning).\n"
        "## Passages and themes — the Scriptures and main themes found in the notes.\n"
        "## Where the sources agree — points in the notes confirmed by the sources, with citations.\n"
        "## What the sources add — helpful insights, context or cross references the notes don't include.\n"
        "## Points to examine further — anything in the notes the sources read differently, or that needs a "
        "closer look. Be gentle and specific; explain why.\n"
        "## Questions for further study\n\n"
        f"Passages detected: {', '.join(refs) if refs else 'none detected – infer from the notes'}\n\n"
        f"<USER_NOTES>\n{notes}\n</USER_NOTES>" + sources_block(src)
    )


def transcribe_image() -> str:
    return (
        "This image is a page of someone's Bible study notes (it may be handwritten). Transcribe ALL the text "
        "exactly as written, keeping line breaks, bullet points and Bible references. Do not add commentary. "
        "Mark unreadable words as [illegible]."
    )


# ---------------------------------------------------------------- what a study is for (from LifeHub)
PURPOSES = {
    "personal": ("Personal study", "a personal devotional study for one person's quiet time",
                 '"Read and notice" (what the passage actually says), "What it shows about God", "Reflect and respond" (personal application)'),
    "homegroup": ("Home group", "a home group / small group study someone will LEAD for adults, about 45–60 minutes",
                  '"Icebreaker", "Read" (how to read it together), "Look closer" (key observations), "What it means" (tricky bits explained simply), '
                  '"Live it out" (application for the group), "Leader\'s notes" (timings, where discussion may go, sensitive topics, how to close), '
                  '"Questions" (grouped as Observation, Interpretation, Application)'),
    "preaching": ("Preaching", "sermon preparation: an exegetical start and a sermon outline",
                  '"Exegetical notes" (verse by verse), "Big idea", "Outline" (3–4 points that flow from the text, each with an illustration idea), '
                  '"Introduction ideas", "Application" (for different people in the congregation), "Conclusion and response", "Watch out for" (common misreadings, hard questions)'),
    "teaching": ("Teaching", "a lesson plan for teaching a Bible class to adults",
                 '"Learning aims", "Background", "Lesson plan" (steps with minutes), "Key truths", "Activities", "Questions"'),
    "youth": ("Youth & children", "a session for young people: simple language, engaging and age-appropriate",
              '"Opening activity" (a game or hook linked to the theme), "The story / explanation" (in simple words), "Big truth" (one memorable sentence), "Response" (an activity or challenge)'),
    "word": ("Word & theme study", "a word and theme study: key words in the original languages and how the themes run through the Bible",
             '"Key words" (English word, Greek/Hebrew with transliteration, meaning and use), "The theme across Scripture" (reference and connection), "What it teaches"'),
    "discipleship": ("One-to-one", "a one-to-one discipleship conversation reading the passage together",
                     '"Read together", "Conversation starters", "What it means for us", "Challenge for the week", "Check in next time"'),
}


# ---------------------------------------------------------------- passage research
def passage_study(passages: str, focus: str, level: str, src: str, purpose: str = "", notes: str = "") -> str:
    focus_txt = (f"Study these Scriptures in light of this word / sentence / topic: \"{focus}\". Trace how the "
                 "focus appears in, or is illuminated by, each passage and how the passages speak to one another.")\
        if focus else "Study these Scriptures together and show how they relate."
    if purpose in PURPOSES:
        name, brief, sections = PURPOSES[purpose]
        structure = (f"This study is for {brief}. Start with ## Big idea (one memorable sentence) and ## Context, then use "
                     f"these sections as ## headings, in this order: {sections}. Finish with ## Prayer and ## Sources consulted.")
    else:
        structure = ("Suggested structure (adapt to the level): ## Overview, ## The passages in context, "
                     "## The focus across the passages, ## What the commentators say, ## Cross references, "
                     "## Application, ## Questions, ## Sources consulted (a list of the source links you used).")
    keep = f"\n\nKeep in mind: {notes}" if notes else ""
    return (
        f"PASSAGES: {passages}\n\n{focus_txt}\n\n{LEVEL_GUIDE.get(level, LEVEL_GUIDE['study'])}{keep}\n\n{structure}"
        + sources_block(src)
    )


# ---------------------------------------------------------------- insights
INSIGHT_MODES = {
    "passage": "a specific Bible passage",
    "topic": "a biblical topic or doctrine",
    "life": "an area of life, seen in biblical context (e.g. work, grief, marriage, money, anxiety)",
}


def insight(mode: str, query: str, level: str, src: str) -> str:
    return (
        f"The user wants insight on {INSIGHT_MODES.get(mode, 'a topic')}: \"{query}\".\n\n"
        f"{LEVEL_GUIDE.get(level, LEVEL_GUIDE['study'])}\n\n"
        "Give fresh, careful insight rather than generic statements. For a topic or area of life, identify the key "
        "passages across both Testaments, the main biblical principles (each tied to verses), common "
        "misunderstandings, and wise, pastoral application. For a passage, highlight what is easily missed. "
        "Finish with ## Going deeper (questions and passages to read next)."
        + sources_block(src)
    )


# ---------------------------------------------------------------- study builder
AUDIENCES = {
    "group": "a small group / home group",
    "individual": "an individual's personal study",
    "meeting": "a church meeting or larger gathering",
    "youth": "a youth group",
    "family": "family devotions (mixed ages)",
    "one_to_one": "a one-to-one discipleship or mentoring meeting",
    "class": "a Sunday school / Bible class",
}


def builder(p: dict, src: str) -> str:
    lines = [
        f"Build a Bible study plan for {AUDIENCES.get(p.get('audience'), p.get('audience') or 'a group')}.",
        f"Group size: {p.get('size') or 'not specified'}",
        f"Length of session: {p.get('duration') or '60'} minutes",
        f"Number of sessions: {p.get('sessions') or 1}",
        f"Passage(s): {p.get('passages') or 'NOT CHOSEN – suggest 3 suitable passage options first, then build the study on the best one'}",
        f"Theme / topic: {p.get('theme') or 'not specified'}",
        f"Audience notes (maturity, background, needs): {p.get('notes') or 'none'}",
        f"Preferred format: {p.get('format') or 'suggest what fits best'}",
        LEVEL_GUIDE.get(p.get("level"), LEVEL_GUIDE["study"]),
        "",
        "Include: ## Passage ideas (with one line on why each fits), ## Aim of the study, ## Format and timings "
        "(a timed run-sheet: welcome, opening, reading, discussion, prayer…), ## Leader's background notes, "
        "## Discussion questions — grouped as Observation, Interpretation and Application, with a few follow-up "
        "prompts, ## Activities or creative elements (optional), ## Prayer points, ## Take-home challenge. "
        "If more than one session, give an outline for each session.",
    ]
    return "\n".join(lines) + sources_block(src)


# ---------------------------------------------------------------- calling discernment
def calling_system(perspective: str = "") -> str:
    return (
        "You are a gentle, prayerful guide helping a Christian reflect on and discern God's calling. You walk "
        "alongside them; you are not an authority on their life.\n\n"
        "Essential principles:\n"
        "- Assume NOTHING about the person – not their age, situation, gifts, church, gender, job or what their "
        "calling might be. Learn only from what they tell you.\n"
        "- Never claim to know God's will for them, never speak as if you were God, and never declare what their "
        "calling is. Help them listen to God, notice patterns and test what they sense against Scripture, wise "
        "counsel and their church community.\n"
        "- Respond to what they actually said. Briefly reflect it back in your own words so they feel heard, then "
        "offer ONE next step: a single reflective question, OR a short guided prayer they can pray in their own "
        "words, OR a short passage to sit with and a question about it. Keep each reply under about 180 words.\n"
        "- Over the conversation, gently explore areas such as: their relationship with God right now, what stirs "
        "their heart or burdens them, gifts and strengths others have affirmed, experiences and seasons of fruit, "
        "circumstances and responsibilities, desires and fears, and what Scripture has been saying to them. Let "
        "their answers decide the order; do not run through a checklist.\n"
        "- Invite them to pause and pray, and to write down what they sense. Leave room for silence and waiting.\n"
        "- Encourage them to share what they are discerning with a pastor, mentor or trusted believers.\n"
        "- If they mention crisis, abuse or thoughts of self-harm, respond with care, pause the exercise and "
        "encourage them to contact someone who can help right now (e.g. emergency services, Samaritans 116 123 in "
        "the UK/Ireland, or a local crisis line).\n"
        + (f"- Their tradition: {perspective}. Use language that fits it.\n" if perspective else "")
    )


def calling_opening(focus: str) -> str:
    base = ("Begin the session. Welcome them warmly in two or three sentences, invite them into a moment of quiet "
            "prayer (offer a one-line prayer they can pray), then ask one open question to understand where they "
            "are right now.")
    if focus:
        base += ("\n\nThey shared this to begin with (respond to it gently – don't analyse it all at once; pick the "
                 f"thread that seems most alive):\n<SHARED>\n{focus}\n</SHARED>")
    return base


def calling_summary() -> str:
    return (
        "Write a reflection summary of this discernment conversation for the person to keep. Use their words where "
        "possible. Sections: ## What you shared, ## Themes and patterns noticed (tentative – phrase as observations, "
        "not conclusions), ## Scriptures that came up, ## Questions still open, ## Possible next steps (prayer "
        "practices, conversations to have, small experiments to test a sense of calling). Do NOT state what their "
        "calling is."
    )
