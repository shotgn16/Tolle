"""Detect and remove repetition loops in model output.

Small local models sometimes get stuck repeating a phrase ("the first verse of the first Gospel —
the first verse of the first Gospel — …") until they run out of tokens. These helpers spot that,
both while streaming (to stop early) and afterwards (to clean what was saved).
"""
import re

# A phrase of 12–300 characters followed by at least `n` more copies of itself (allowing
# punctuation, dashes or whitespace in between).
_SEP = r"[\s—–\-,;.:*]*"


def _loop_re(min_repeats: int) -> re.Pattern:
    return re.compile(rf"(.{{12,300}}?)(?:{_SEP}\1){{{min_repeats},}}", re.S)


_STREAM = _loop_re(4)
_FULL = _loop_re(3)


def _wordy(m: re.Match) -> bool:
    """Ignore repeated punctuation such as Markdown table rules (|---|---|)."""
    return len(re.findall(r"[A-Za-z]", m.group(1))) >= 8


def is_looping(tail: str) -> bool:
    """True when the end of the text is the same phrase over and over (checked while streaming)."""
    tail = tail[-2500:]
    last = None
    for m in _STREAM.finditer(tail):
        if _wordy(m):
            last = m
    return bool(last) and last.end() >= len(tail) - 300


def has_loop(text: str) -> bool:
    return any(_wordy(m) for m in _FULL.finditer(text or ""))


def _repeated_sentences(text: str) -> tuple[str, bool]:
    """Drop sentences that appear 3+ times in the same paragraph (keep the first)."""
    changed = False
    out = []
    for para in text.split("\n"):
        sentences = re.split(r"(?<=[.!?])\s+", para)
        seen: dict[str, int] = {}
        kept = []
        for sent in sentences:
            key = re.sub(r"\W+", " ", sent.lower()).strip()
            if len(key) > 25:
                seen[key] = seen.get(key, 0) + 1
                if seen[key] > 2:
                    changed = True
                    continue
            kept.append(sent)
        out.append(" ".join(kept))
    return "\n".join(out), changed


def clean(text: str) -> tuple[str, bool]:
    """Collapse runs of a repeated phrase to one copy. Returns (text, changed)."""
    if not text:
        return text, False
    new = _FULL.sub(lambda m: m.group(1) if _wordy(m) else m.group(0), text)
    changed = new != text
    new, changed2 = _repeated_sentences(new)
    return new, changed or changed2
