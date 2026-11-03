"""Prompt templates for the study builder feature."""
from ...core.ai.prompts import LEVEL_GUIDE, sources_block


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
