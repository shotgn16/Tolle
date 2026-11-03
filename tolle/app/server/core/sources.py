"""Fetch and cache research material from Bible study websites.

Sources are URL templates the user can edit in Settings → Sources, so a site
changing its URL layout never breaks the app permanently. Pages are cached for
30 days to keep load on those sites low; results are always linked back to the
original page in the AI output.
"""
import json
import re
import time

import httpx
from bs4 import BeautifulSoup

from . import db
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
    lines = [ln for ln in (l.strip() for l in text.splitlines()) if len(ln) > 2]
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


def gather(refs: list[dict], sources: list[dict], translation: str, budget: int,
           progress=lambda msg: None) -> list[dict]:
    """Return a list of {name, url, ok, text} trimmed to fit the character budget."""
    urls: list[tuple[dict, str, str]] = []
    seen = set()
    for ref in refs[:8]:
        tv = template_vars(ref, translation)
        for src in sources:
            if not src.get("enabled"):
                continue
            try:
                url = src["url"].format(**tv)
            except (KeyError, IndexError, ValueError):
                continue
            if url in seen:
                continue
            seen.add(url)
            urls.append((src, url, ref["display"]))

    results = []
    for i, (src, url, label) in enumerate(urls, 1):
        progress(f"Reading {src['name']} for {label} ({i}/{len(urls)})")
        ok, text = fetch(url)
        results.append({"name": src["name"], "kind": src.get("kind", ""), "ref": label, "url": url,
                        "ok": ok, "text": text if ok else ""})

    good = [r for r in results if r["ok"]]
    if good:
        # Scripture text is short and most important; share the rest fairly.
        per = max(1500, budget // max(1, len(good)))
        for r in good:
            limit = per * 2 if r["kind"] == "text" else per
            if len(r["text"]) > limit:
                r["text"] = r["text"][:limit] + "\n[…trimmed]"
    return results


def format_for_prompt(results: list[dict]) -> str:
    blocks = []
    for r in results:
        if r["ok"]:
            blocks.append(f"### SOURCE: {r['name']} — {r['ref']}\nURL: {r['url']}\n{r['text']}")
    return "\n\n".join(blocks) if blocks else "(No external sources could be retrieved.)"
