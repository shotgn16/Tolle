"""Fetch and cache research material from Bible study websites.

Sources are URL templates the user can edit in Settings → Sources, so a site
changing its URL layout never breaks the app permanently. Pages are cached for
30 days to keep load on those sites low; results are always linked back to the
original page in the AI output.
"""
import json
import re
import time
from concurrent.futures import ThreadPoolExecutor

import httpx
from bs4 import BeautifulSoup

from . import db, source_parsers
from .bible import BOOK_BY_NAME, template_vars
from .crypto import dec, enc

CACHE_TTL = 30 * 86400
_VERSE_LINE = re.compile(r"^(.+?) (\d+):(\d+) (.*)$")
UA = "Mozilla/5.0 (compatible; Tolle/0.1; personal Bible study; +https://github.com/shotgn16/Tolle)"
_client = httpx.Client(timeout=25, follow_redirects=True, headers={"User-Agent": UA})


def _extract_html(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript", "nav", "header", "footer", "aside", "form", "svg", "iframe"]):
        tag.decompose()
    main = soup.find("article") or soup.find("main") or soup.find(id="content") or soup.body or soup
    text = main.get_text("\n", strip=True)
    # Short lines are mostly menu clutter – but keep numbers (Strong's) and Greek/Hebrew words.
    lines = [ln for ln in (l.strip() for l in text.splitlines()) if len(ln) > 2 or ln.isdigit() or any(ord(c) > 127 and c.isalpha() for c in ln)]
    return "\n".join(lines)


def _extract_bible_api(raw: str) -> str:
    data = json.loads(raw)
    if "verses" in data:
        return "\n".join(f"{v['book_name']} {v['chapter']}:{v['verse']} {' '.join(v['text'].split())}" for v in data["verses"])
    return data.get("text", "")


def fetch(url: str, force: bool = False) -> tuple[bool, str]:
    row = db.q1("SELECT * FROM source_cache WHERE url=?", (url,))
    if row and not force and time.time() - row["fetched_at"] < CACHE_TTL:
        return bool(row["ok"]), dec(row["text_enc"]) or ""
    ok, text = False, ""
    try:
        resp = _client.get(url)
        if resp.status_code == 200:
            ctype = resp.headers.get("content-type", "")
            if "bible-api.com" in url or "json" in ctype:
                text = _extract_bible_api(resp.text)
            else:
                text = _extract_html(resp.text)
            ok = len(text) > 40
        else:
            text = f"HTTP {resp.status_code}"
    except Exception as exc:  # network problems shouldn't kill a study
        text = f"{type(exc).__name__}: {exc}"
    db.ex(
        "INSERT INTO source_cache(url,fetched_at,ok,text_enc) VALUES(?,?,?,?) "
        "ON CONFLICT(url) DO UPDATE SET fetched_at=excluded.fetched_at, ok=excluded.ok, text_enc=excluded.text_enc",
        (url, time.time(), 1 if ok else 0, enc(text)),
    )
    return ok, text


def passage_text(ref: dict, translation: str) -> str:
    url = f"https://bible-api.com/{template_vars(ref, translation)['ref_q']}?translation={translation}"
    ok, text = fetch(url)
    return text if ok else ""


def chapter(book: str, chapter_no: int, translation: str) -> dict:
    ref = {"book": book, "slug": BOOK_BY_NAME[book][1], "chapter": chapter_no,
           "display": f"{book} {chapter_no}", "verse_start": None}
    url = f"https://bible-api.com/{template_vars(ref, translation)['ref_q']}?translation={translation}"
    ok, _ = fetch(url)
    row = db.q1("SELECT text_enc FROM source_cache WHERE url=?", (url,))
    verses = []
    if ok:
        for line in (dec(row["text_enc"]) or "").splitlines():
            # "John 3:16 For God so loved..."
            m = _VERSE_LINE.match(line)
            if m:
                verses.append({"verse": int(m.group(3)), "text": m.group(4)})
    return {"ok": ok, "book": book, "chapter": chapter_no, "translation": translation, "verses": verses,
            "source": url}


def topic_vars(topic: str) -> dict | None:
    """URL parts for a dictionary look-up of a topic word (e.g. "love" → l/love). Short topics only."""
    words = re.findall(r"[a-z]+", (topic or "").lower())
    if not words or len(words) > 2:
        return None
    slug = "-".join(words)
    return {"topic": " ".join(words), "topic_slug": slug, "topic_letter": slug[0]}


def plan(refs: list[dict], sources: list[dict], translation: str, topics: list[str] | None = None) -> list[tuple]:
    """Which pages to read: (source, url, label) for every enabled source and reference (or topic)."""
    urls, seen = [], set()

    def add(src, tv, label):
        try:
            url = src["url"].format(**tv)
        except (KeyError, IndexError, ValueError):
            return
        if url not in seen:
            seen.add(url)
            urls.append((src, url, label))

    for src in sources:
        if not src.get("enabled"):
            continue
        if src.get("scope") == "topic":
            for t in (topics or [])[:3]:
                tv = topic_vars(t)
                if tv:
                    add(src, tv, t)
            continue
        for ref in refs[:8]:
            add(src, template_vars(ref, translation), ref["display"])
    return urls


def share(results: list[dict], budget: int) -> None:
    """Share the character budget between the pages, by each source's weight (in place)."""
    good = [r for r in results if r["ok"]]
    if not good:
        return
    total = sum(r["weight"] for r in good)
    for r in good:
        room = max(1200, int(budget * r["weight"] / total))
        if r.get("sections"):
            r["sections"] = source_parsers.pick(r["sections"], room)
            r["text"] = ""
        elif len(r["text"]) > room:
            r["text"] = r["text"][:room] + "\n[…trimmed]"


def gather(refs: list[dict], sources: list[dict], translation: str, budget: int,
           progress=lambda msg: None, topics: list[str] | None = None) -> list[dict]:
    """Read every enabled source for the references (and topic words), and fit them to the budget.

    Returns [{name, kind, ref, url, ok, text, sections}]. Pages that hold many works (StudyLight,
    Bible Hub, Catena Bible) are split into those works so each is represented, see source_parsers.
    """
    urls = plan(refs, sources, translation, topics)
    if not urls:
        return []
    progress(f"Reading {len(urls)} study pages…")
    done = [0]

    def read(item):
        src, url, label = item
        ok, text = fetch(url)
        done[0] += 1
        progress(f"Read {src['name']} for {label} ({done[0]}/{len(urls)})")
        sections = []
        parser = source_parsers.PARSERS.get(src.get("parser") or "")
        if ok and parser:
            sections = parser(text)
            if not sections and src.get("parser") in ("catena", "interlinear"):
                ok = False          # the page didn't have what we came for
        return {"name": src["name"], "kind": src.get("kind", ""), "ref": label, "url": url, "ok": ok,
                "text": text if ok else "", "sections": sections, "weight": float(src.get("weight") or 1)}

    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(read, urls))
    share(results, budget)
    return results


def preview(r: dict) -> str:
    """What a source found, for the Test button in Settings → Sources."""
    if r.get("sections"):
        names = ", ".join(s["label"] for s in r["sections"][:12])
        more = f" and {len(r['sections']) - 12} more" if len(r["sections"]) > 12 else ""
        return f"{len(r['sections'])} works used: {names}{more}\n\n{r['sections'][0]['text'][:300]}"
    return r["text"][:500]


_KIND_ORDER = ["text", "commentaries", "commentary", "historical", "language", "pastoral", "dictionary", "overview", "other"]


def format_for_prompt(results: list[dict]) -> str:
    good = sorted((r for r in results if r["ok"]), key=lambda r: _KIND_ORDER.index(r["kind"]) if r["kind"] in _KIND_ORDER else 99)
    blocks = []
    for r in good:
        head = f"### SOURCE: {r['name']} — {r['ref']}\nURL: {r['url']}"
        if r.get("sections"):
            parts = "\n\n".join(f"#### {s['label']} · {s['group']}\n{s['text']}" for s in r["sections"])
            blocks.append(f"{head}\n{parts}")
        elif r["text"]:
            blocks.append(f"{head}\n{r['text']}")
    return "\n\n".join(blocks) if blocks else "(No external sources could be retrieved.)"
