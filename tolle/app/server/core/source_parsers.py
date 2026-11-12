"""Make the most of big study pages.

Some pages hold many separate works: StudyLight's verse page has ~40 commentaries, Bible Hub's ~15, Catena
Bible quotes the Church Fathers verse by verse. Sending only the first few thousand characters would mean
the AI only ever saw the first commentator. Instead each page is split into its works, every work is
labelled (author, era, kind) and the space available is shared out so every kind of voice is heard:
early church, Reformers and Puritans, 18th–19th century and modern commentators, original-language
studies, and sermon and pastoral material.

Each parser takes the page's plain text (one block per line) and returns a list of sections:
{"label", "group", "text"}. An empty list means "nothing useful here". The same rules are in
web/core/local/parsers.js for the phone app; the tests check both give the same result.
"""
import re

# Groups, in the order they take turns when space is short.
GROUPS = ["early church", "reformation & puritan", "language", "pastoral", "1700s–1800s", "modern", "reference"]

_LANGUAGE = re.compile(r"word (pictures|studies)|greek|hebrew|gnom[eo]n|meyer|critical|exegetical|alford|cambridge|keil|"
                       r"vincent|robertson|expositor's greek|lexic|interlinear", re.I)
_PASTORAL = re.compile(r"illustrator|sermon|pulpit|homilet|horae|maclaren|expositions|wells of living water|treasury of david|"
                       r"practical observations|family bible|spurgeon|devotion|morning and evening|church pulpit|biblical illustrator", re.I)
_REFERENCE = re.compile(r"treasury of scripture knowledge|scofield|reference notes|topical|concordance|cross ref", re.I)
_REFORMATION = re.compile(r"calvin|geneva|trapp|poole|luther|beza|henry|bengel|burkitt|gill|wesley|haydock|lapide|"
                          r"jonathan edwards|owen|bunyan|baxter|coke", re.I)
_NINETEENTH = re.compile(r"ellicott|barnes|benson|jamieson|fausset|clarke|whedon|lange|schaff|godet|lightfoot|westcott|"
                         r"kelly|darby|abbott|simeon|nisbet|exell|hengstenberg|edersheim|keil|delitzsch|ryle|spurgeon|"
                         r"fourfold gospel|justin edwards|scott", re.I)
_YEAR = re.compile(r"\b(1[0-9]{3}|20[0-9]{2})\b")


def classify(name: str, year: int | None = None) -> str:
    """Which kind of voice a work is, from its name (and year when known)."""
    if _REFERENCE.search(name):
        return "reference"
    if _LANGUAGE.search(name):
        return "language"
    if _PASTORAL.search(name):
        return "pastoral"
    if year and year < 1000:
        return "early church"
    if _REFORMATION.search(name) or (year and year < 1700):
        return "reformation & puritan"
    if (year and year < 1900) or (not year and _NINETEENTH.search(name)):
        return "1700s–1800s"
    return "modern"


def _lines(text: str) -> list[str]:
    return [ln for ln in (text or "").split("\n") if ln.strip()]


def _words(s: str) -> set[str]:
    return {w for w in re.findall(r"[a-z]+", s.lower()) if len(w) > 2 and w not in {"the", "and", "commentary", "notes", "bible", "whole"}}


# ---------------------------------------------------------------- StudyLight verse pages
_CITE_HEAD = re.compile(r'^.*?Commentary on\W*[^"”]*?\d+(:\d+)?["”]*\.?\s*')


def _citation(cite: str) -> tuple[str, str, int | None]:
    """Clarke, Adam. "Commentary on John 3:16". "The Adam Clarke Commentary". 1832.  →  author, work, year"""
    author = cite.split(". ", 1)[0].strip().rstrip(".")
    rest = _CITE_HEAD.sub("", cite, count=1)
    quoted = re.findall(r'["“]([^"”]+)["”]', rest)
    work = quoted[0].strip() if quoted else rest.split(". ", 1)[0].strip().strip('"“”').rstrip(".")
    years = _YEAR.findall(rest)
    return author, work or cite, int(years[0]) if years else None


def studylight(text: str) -> list[dict]:
    """Every commentary ends with "Bibliographical Information" and a citation:
    Author. "Commentary on John 3:16". "Work". Year."""
    lines = _lines(text)
    sections, body = [], []
    i = 0
    while i < len(lines):
        ln = lines[i]
        if ln == "Bibliographical Information" and i + 1 < len(lines):
            cite = lines[i + 1]
            author, work, year = _citation(cite)
            # Drop the copyright notice at the end, and anything before the work's own heading.
            if "Copyright Statement" in body:
                body = body[:body.index("Copyright Statement")]
            want = _words(work)
            for j, b in enumerate(body[:60]):
                if want and len(b) < 90 and len(_words(b) & want) >= max(1, (len(want) + 1) // 2):
                    body = body[j + 1:]
                    break
            content = "\n".join(body).strip()
            if len(content) > 40:
                label = f"{author} – {work}" + (f" ({year})" if year else "")
                sections.append({"label": label, "group": classify(f"{author} {work}", year), "text": content})
            body = []
            i += 2
            continue
        body.append(ln)
        i += 1
    return sections


# ---------------------------------------------------------------- Bible Hub commentary pages
_BH_HEADER = re.compile(r"^(EXPOSITORY|EXEGETICAL|HOMILETIC|HOMILETICS|DEVOTIONAL|SERMONS?)\b.*$")
_BH_NAME = re.compile(r"^(The )?[A-Z][\w'.\- ]{2,70}?(Commentary|for English Readers|Commentaries|Notes|Expositions?|Gnom[eo]n|Testament|"
                      r"Word Studies|Treasury of David|Study Bible|Schools and Colleges|Old Testament|Exposition of the Entire Bible|"
                      r"Exposition|Homiletics|Illustrator)( on the [\w ]+)?$")


BH_NAMES = {
    "Ellicott's Commentary for English Readers", "MacLaren's Expositions", "Benson Commentary",
    "Matthew Henry's Concise Commentary", "Matthew Henry's Commentary", "Barnes' Notes on the Bible",
    "Jamieson-Fausset-Brown Bible Commentary", "Matthew Poole's Commentary", "Gill's Exposition of the Entire Bible",
    "Geneva Study Bible", "Meyer's NT Commentary", "Expositor's Greek Testament", "Cambridge Bible for Schools and Colleges",
    "Bengel's Gnomen", "Bengel's Gnomon", "Pulpit Commentary", "Vincent's Word Studies", "The Treasury of David",
    "Keil and Delitzsch Biblical Commentary on the Old Testament", "Pulpit Commentary Homiletics", "Clarke's Commentary",
    "Coffman's Commentary", "Wesley's Notes", "Expositor's Bible Commentary", "Through the Bible Day by Day",
    "Pett's Commentary", "Calvin's Commentary", "Biblical Illustrator", "Sermon Bible", "Kelly Commentary",
    "Darby's Bible Synopsis", "Scofield Reference Notes", "Treasury of Scripture Knowledge", "Lange Commentary",
}


def biblehub(text: str) -> list[dict]:
    """Each commentary starts with its name on a line of its own; category headers are in capitals."""
    lines = _lines(text)
    known = sum(1 for ln in lines if ln in BH_NAMES)
    is_name = (lambda ln: ln in BH_NAMES) if known >= 2 else (lambda ln: len(ln) <= 80 and bool(_BH_NAME.match(ln)))
    sections, cur, body = [], None, []

    def close():
        content = "\n".join(b for b in body if b.lower() not in {"continued...", "continued…"}).strip()
        if cur and len(content) > 40:
            sections.append({"label": cur, "group": classify(cur), "text": content})

    for ln in lines:
        if _BH_HEADER.match(ln):
            continue
        if is_name(ln):
            close()
            cur, body = ln, []
            continue
        if cur:
            body.append(ln)
    close()
    return sections


# ---------------------------------------------------------------- Catena Bible (Church Fathers)
_AD = re.compile(r"^AD (\d{2,4})$")


def catena(text: str) -> list[dict]:
    """Each Father's comment starts with his name and then a line like "AD 430"."""
    lines = _lines(text)
    starts = [i for i in range(1, len(lines)) if _AD.match(lines[i])]
    sections = []
    for n, i in enumerate(starts):
        name = lines[i - 1]
        year = int(_AD.match(lines[i]).group(1))
        end = starts[n + 1] - 1 if n + 1 < len(starts) else len(lines)
        content = "\n".join(ln for ln in lines[i + 1:end] if ln not in {"Read More", "Share"}).strip()
        if len(content) > 40:
            sections.append({"label": f"{name} (AD {year})", "group": "early church" if year < 1000 else classify(name, year),
                             "text": content})
    return sections


# ---------------------------------------------------------------- Bible Hub interlinear
_STRONGS = re.compile(r"^\d{1,5}$")
_PARSE = re.compile(r"^[A-Z][A-Za-z0-9]*(-[A-Za-z0-9]+)*$")


def interlinear(text: str) -> list[dict]:
    """Strong's number, transliteration, original word, English, grammar – five lines per word."""
    lines = _lines(text)
    words = []
    i = 0
    while i + 3 < len(lines):
        if _STRONGS.match(lines[i]) and not _STRONGS.match(lines[i + 1]):
            num, translit, orig, gloss = lines[i], lines[i + 1], lines[i + 2], lines[i + 3]
            grammar = lines[i + 4] if i + 4 < len(lines) and _PARSE.match(lines[i + 4]) and not _STRONGS.match(lines[i + 4]) else ""
            words.append(f"{orig} ({translit}, Strong's {num}) – {gloss}" + (f" [{grammar}]" if grammar else ""))
            i += 5 if grammar else 4
            continue
        i += 1
    if len(words) < 2:
        return []
    return [{"label": "Original-language words", "group": "language", "text": "\n".join(words)}]


PARSERS = {"studylight": studylight, "biblehub": biblehub, "catena": catena, "interlinear": interlinear}


# ---------------------------------------------------------------- sharing out the space
def pick(sections: list[dict], budget: int, min_each: int = 600) -> list[dict]:
    """Choose sections so every group is heard, then share the budget between them."""
    if not sections:
        return []
    room = max(1, min(len(sections), budget // min_each))
    by_group = {g: [s for s in sections if s["group"] == g] for g in GROUPS}
    by_group["other"] = [s for s in sections if s["group"] not in GROUPS]
    chosen = []
    while len(chosen) < room:
        took = False
        for g in [*GROUPS, "other"]:
            if by_group[g] and len(chosen) < room:
                chosen.append(by_group[g].pop(0))
                took = True
        if not took:
            break
    order = {id(s): n for n, s in enumerate(sections)}
    chosen.sort(key=lambda s: order[id(s)])          # keep the page's own order
    each = max(min_each, budget // len(chosen))
    out = []
    for s in chosen:
        t = s["text"]
        if len(t) > each:
            t = t[:each].rsplit(" ", 1)[0] + " […]"
        out.append({**s, "text": t})
    return out
