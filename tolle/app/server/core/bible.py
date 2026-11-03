"""Bible book data, reference parsing and passage text lookup."""
import re
import urllib.parse

# (display name, url slug, chapter count, extra abbreviations)
BOOKS = [
    ("Genesis", "genesis", 50, ["gen", "ge", "gn"]),
    ("Exodus", "exodus", 40, ["exod", "exo", "ex"]),
    ("Leviticus", "leviticus", 27, ["lev", "le", "lv"]),
    ("Numbers", "numbers", 36, ["num", "nu", "nm"]),
    ("Deuteronomy", "deuteronomy", 34, ["deut", "deu", "dt"]),
    ("Joshua", "joshua", 24, ["josh", "jos"]),
    ("Judges", "judges", 21, ["judg", "jdg"]),
    ("Ruth", "ruth", 4, ["ru", "rth"]),
    ("1 Samuel", "1-samuel", 31, ["1 sam", "1sam", "1 sa", "1sa", "i samuel"]),
    ("2 Samuel", "2-samuel", 24, ["2 sam", "2sam", "2 sa", "2sa", "ii samuel"]),
    ("1 Kings", "1-kings", 22, ["1 kgs", "1kgs", "1 ki", "1ki", "i kings"]),
    ("2 Kings", "2-kings", 25, ["2 kgs", "2kgs", "2 ki", "2ki", "ii kings"]),
    ("1 Chronicles", "1-chronicles", 29, ["1 chron", "1 chr", "1chr", "1 ch", "i chronicles"]),
    ("2 Chronicles", "2-chronicles", 36, ["2 chron", "2 chr", "2chr", "2 ch", "ii chronicles"]),
    ("Ezra", "ezra", 10, ["ezr"]),
    ("Nehemiah", "nehemiah", 13, ["neh", "ne"]),
    ("Esther", "esther", 10, ["esth", "est"]),
    ("Job", "job", 42, ["jb"]),
    ("Psalms", "psalms", 150, ["psalm", "ps", "psa", "pss"]),
    ("Proverbs", "proverbs", 31, ["prov", "pro", "prv", "pr"]),
    ("Ecclesiastes", "ecclesiastes", 12, ["eccl", "ecc", "qoh"]),
    ("Song of Solomon", "song-of-solomon", 8, ["song of songs", "song", "sos", "canticles"]),
    ("Isaiah", "isaiah", 66, ["isa", "is"]),
    ("Jeremiah", "jeremiah", 52, ["jer", "je"]),
    ("Lamentations", "lamentations", 5, ["lam", "la"]),
    ("Ezekiel", "ezekiel", 48, ["ezek", "eze", "ezk"]),
    ("Daniel", "daniel", 12, ["dan", "da", "dn"]),
    ("Hosea", "hosea", 14, ["hos", "ho"]),
    ("Joel", "joel", 3, ["jl"]),
    ("Amos", "amos", 9, ["am"]),
    ("Obadiah", "obadiah", 1, ["obad", "ob"]),
    ("Jonah", "jonah", 4, ["jon", "jnh"]),
    ("Micah", "micah", 7, ["mic", "mi"]),
    ("Nahum", "nahum", 3, ["nah", "na"]),
    ("Habakkuk", "habakkuk", 3, ["hab", "hb"]),
    ("Zephaniah", "zephaniah", 3, ["zeph", "zep"]),
    ("Haggai", "haggai", 2, ["hag", "hg"]),
    ("Zechariah", "zechariah", 14, ["zech", "zec"]),
    ("Malachi", "malachi", 4, ["mal"]),
    ("Matthew", "matthew", 28, ["matt", "mat", "mt"]),
    ("Mark", "mark", 16, ["mrk", "mk", "mr"]),
    ("Luke", "luke", 24, ["luk", "lk"]),
    ("John", "john", 21, ["jhn", "jn"]),
    ("Acts", "acts", 28, ["act", "ac"]),
    ("Romans", "romans", 16, ["rom", "ro", "rm"]),
    ("1 Corinthians", "1-corinthians", 16, ["1 cor", "1cor", "1 co", "i corinthians"]),
    ("2 Corinthians", "2-corinthians", 13, ["2 cor", "2cor", "2 co", "ii corinthians"]),
    ("Galatians", "galatians", 6, ["gal", "ga"]),
    ("Ephesians", "ephesians", 6, ["eph", "ephes"]),
    ("Philippians", "philippians", 4, ["phil", "php", "pp"]),
    ("Colossians", "colossians", 4, ["col"]),
    ("1 Thessalonians", "1-thessalonians", 5, ["1 thess", "1thess", "1 th", "i thessalonians"]),
    ("2 Thessalonians", "2-thessalonians", 3, ["2 thess", "2thess", "2 th", "ii thessalonians"]),
    ("1 Timothy", "1-timothy", 6, ["1 tim", "1tim", "1 ti", "i timothy"]),
    ("2 Timothy", "2-timothy", 4, ["2 tim", "2tim", "2 ti", "ii timothy"]),
    ("Titus", "titus", 3, ["tit"]),
    ("Philemon", "philemon", 1, ["philem", "phm"]),
    ("Hebrews", "hebrews", 13, ["heb"]),
    ("James", "james", 5, ["jas", "jm"]),
    ("1 Peter", "1-peter", 5, ["1 pet", "1pet", "1 pe", "i peter"]),
    ("2 Peter", "2-peter", 3, ["2 pet", "2pet", "2 pe", "ii peter"]),
    ("1 John", "1-john", 5, ["1 jn", "1jn", "1 jhn", "i john"]),
    ("2 John", "2-john", 1, ["2 jn", "2jn", "ii john"]),
    ("3 John", "3-john", 1, ["3 jn", "3jn", "iii john"]),
    ("Jude", "jude", 1, ["jud"]),
    ("Revelation", "revelation", 22, ["rev", "re", "revelations", "apocalypse"]),
]

BOOK_BY_NAME = {b[0]: b for b in BOOKS}
_ALIASES: dict[str, str] = {}
for name, slug, _, abbrs in BOOKS:
    for alias in [name, slug.replace("-", " ")] + abbrs:
        _ALIASES[alias.lower().replace(".", "")] = name

# Two-letter abbreviations ("is", "am", "ex") cause false matches in prose, so
# free-text parsing only uses longer aliases.
_safe_aliases = [a for a in _ALIASES if len(a) >= 3 or a in {"ps", "mt", "mk", "lk", "jn", "rm"}]
_alias_pattern = "|".join(sorted((re.escape(a) for a in _safe_aliases), key=len, reverse=True))
REF_RE = re.compile(
    rf"\b({_alias_pattern})\.?\s+(\d{{1,3}})(?:\s*[:.]\s*(\d{{1,3}})(?:\s*[-–]\s*(\d{{1,3}}))?)?(?:\s*[-–]\s*(\d{{1,3}})(?!\s*[:.]))?",
    re.IGNORECASE,
)


def normalise_book(text: str) -> str | None:
    return _ALIASES.get(text.lower().replace(".", "").strip())


def parse_refs(text: str, limit: int = 40) -> list[dict]:
    """Find Bible references like 'John 3:16-18', '1 Cor 13', 'Ps 23:1'."""
    found, seen = [], set()
    for m in REF_RE.finditer(text or ""):
        book = normalise_book(m.group(1))
        if not book:
            continue
        chapter = int(m.group(2))
        if chapter < 1 or chapter > BOOK_BY_NAME[book][2]:
            continue
        v1 = int(m.group(3)) if m.group(3) else None
        v2 = int(m.group(4)) if m.group(4) else None
        ch_end = int(m.group(5)) if (m.group(5) and not v1) else None
        display = f"{book} {chapter}"
        if v1:
            display += f":{v1}" + (f"-{v2}" if v2 else "")
        elif ch_end and ch_end > chapter:
            display += f"-{ch_end}"
        if display in seen:
            continue
        seen.add(display)
        found.append({
            "book": book, "slug": BOOK_BY_NAME[book][1], "chapter": chapter,
            "verse_start": v1, "verse_end": v2, "chapter_end": ch_end, "display": display,
        })
        if len(found) >= limit:
            break
    return found


def template_vars(ref: dict, translation: str) -> dict:
    return {
        "book": ref["book"],
        "book_slug": ref["slug"],
        "book_q": urllib.parse.quote(ref["book"]),
        "chapter": ref["chapter"],
        "verse": ref.get("verse_start") or 1,
        "ref": ref["display"],
        "ref_q": urllib.parse.quote(ref["display"]),
        "translation": translation,
    }


def books_payload() -> list[dict]:
    return [{"name": n, "slug": s, "chapters": c} for n, s, c, _ in BOOKS]
