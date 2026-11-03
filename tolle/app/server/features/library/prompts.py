"""Prompt templates for the study notes feature."""
from ...core.ai.prompts import LEVEL_GUIDE, sources_block


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
