"""Prompt templates for every AI feature."""

import re

from . import instructions

_LEVEL_DEFAULTS = {'intro': 'LEVEL: Introduction. Plain, warm language for someone new to this passage or topic. About 400–700 words. Cover what it says, the simple context, the main idea, one or two cross references and 3 reflection questions. Avoid technical terms; explain any you must use.', 'study': 'LEVEL: Study. A solid personal or small-group study, about 1,000–1,600 words. Cover historical and literary context, the flow/structure of the passage, key words (with Hebrew/Greek only where it genuinely helps), cross references, what the commentators highlight, application and 5–7 discussion questions.', 'preach': 'LEVEL: Preach / Teach. Material for preparing a sermon, talk or lesson, about 1,400–2,000 words. Give a one-sentence big idea, a clear teaching outline with 3–4 points tied to the verses, explanation under each point, illustration ideas (described, not invented stories presented as true), applications for different listeners, a suggested introduction and conclusion, and the key cross references.', 'deep': "LEVEL: In-depth. A thorough exegetical study (typically 1,800–3,000 words – depth matters more than length; never pad). Cover authorship/date/setting, genre and literary structure, verse-by-verse or section-by-section exegesis, original-language word studies (transliterate and give the Strong's number when confident), textual or translation issues, how major interpretive traditions read it (presented fairly), biblical-theological connections across the canon, and careful application. Note where the sources disagree."}
_LEVEL_LABELS = {"intro": "Depth: Introduction", "study": "Depth: Study", "preach": "Depth: Preach / Teach",
                 "deep": "Depth: In-depth"}
for _k, _v in _LEVEL_DEFAULTS.items():
    instructions.register(f"level.{_k}", _LEVEL_LABELS[_k], _v, group="Study depth",
                          help="What the AI is asked to write at this depth – length, what to cover, tone.")

# LEVEL_GUIDE["study"] etc. always returns the current wording (see instructions.py)
LEVEL_GUIDE = instructions.Levels(_LEVEL_DEFAULTS)

_ASSISTANT_RULES = """
You are Tolle, a careful, humble Bible study assistant. Like the Bereans in Acts 17:11 you examine the Scriptures to see whether things are so.
Rules:
- Ground what you say in the biblical text and in the SOURCES provided. When you rely on a source, cite it inline as a Markdown link, e.g. ([StudyLight – Matthew Henry](url)).
- Keep three things distinct: what the text says, what the commentators/sources say, and your own synthesis.
- Never invent quotations, verse numbers, original-language words, authors or sources. If you are unsure, say so plainly. Do not quote long passages from the commentaries; summarise them in your own words.
- Quote Scripture accurately from the provided Bible text when available and name the translation.
- Never repeat yourself. Every sentence must add something new; do not restate a point in other words or list near-synonyms. Length should come from substance – if you have nothing more to add, move on or stop.
- Format with Markdown headings, short paragraphs and lists. Do not wrap the answer in a code block.
"""
instructions.register("assistant", "Ground rules for every study", _ASSISTANT_RULES, group="General",
                      help="Who the AI is and the rules it follows in every study, insight and plan. "
                           "Keep the rules about citing sources and not inventing quotes.")


_ASSISTANT_COMPACT = """
You are Tolle, a Bible study assistant.
- Base what you write on the Bible text and the SOURCES. Cite a source as a Markdown link when you use it.
- Never make up quotations, verses or sources. If you are not sure, say so.
- Use Markdown headings, short paragraphs and lists.
- Say each thing once. When every section is written, stop.
"""
instructions.register("assistant_compact", "Ground rules – compact (small models)", _ASSISTANT_COMPACT, group="General",
                      help="Used instead of the ground rules above when Settings → AI → Prompt style is “Compact”. "
                           "Small instruct models follow a few short rules better than many long ones.")

_COMPACT_FOCUS = ("Keep it focused: write every section, briefly and clearly, rather than a few at length. "
                  "Write the answer now.")


def compact(cfg) -> bool:
    """Compact prompts for small instruct models (Settings → AI → Prompt style).

    "auto" uses them for models running on the phone or tablet, which are always small.
    """
    style = cfg.get("ai.prompt_style") or "auto"
    return style == "compact" or (style == "auto" and cfg.get("ai.provider") == "ondevice")


def system_base(perspective: str = "", compact_rules: bool = False) -> str:
    p = (f"The user describes their tradition as: {perspective}. Be sensitive to it, but still present other "
         "faithful views where Christians disagree.") if perspective else (
        "Do not assume a denomination; where Christians disagree, present the main views fairly.")
    return f"{instructions.text('assistant_compact' if compact_rules else 'assistant')}\n- {p}"


_SOURCES_RE = re.compile(r"\n*<SOURCES>\n(.*?)\n</SOURCES>\s*$", re.S)


def adapt_messages(cfg, messages: list[dict]) -> list[dict]:
    """Shape a request for small instruct models when the compact prompt style is on.

    Small models follow the last thing they read, so the research SOURCES move to the top of the request
    and the task comes after them, ending with a plain "write the answer now". Chats are left alone.
    """
    if not compact(cfg) or not messages or messages[-1].get("role") != "user":
        return messages
    last = messages[-1]["content"]
    m = _SOURCES_RE.search(last)
    if not m:
        return messages
    task = last[:m.start()].rstrip()
    src = m.group(1).strip()
    content = (f"<SOURCES>\n{src}\n</SOURCES>\n\nUse the SOURCES above for this task.\n\n" if src else "") + \
        f"{task}\n\n{_COMPACT_FOCUS}"
    return [*messages[:-1], {**messages[-1], "content": content}]


def sources_block(text: str) -> str:
    return f"\n\n<SOURCES>\n{text}\n</SOURCES>"


def transcribe_image() -> str:
    return (
        "This image is a page of someone's Bible study notes (it may be handwritten). Transcribe ALL the text "
        "exactly as written, keeping line breaks, bullet points and Bible references. Do not add commentary. "
        "Mark unreadable words as [illegible]."
    )
