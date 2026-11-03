"""Prompt templates for the passage study feature."""
from ...core.ai.prompts import LEVEL_GUIDE, sources_block


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
