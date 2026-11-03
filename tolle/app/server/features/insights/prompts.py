"""Prompt templates for the insights feature."""
from ...core.ai.prompts import LEVEL_GUIDE, sources_block


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
