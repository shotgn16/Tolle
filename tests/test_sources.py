"""Study sources: big pages split into their works, every kind of voice represented, new sources reach users."""
import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
os.environ.setdefault("TOLLE_DATA_DIR", tempfile.mkdtemp(prefix="tolle-src-"))
sys.path.insert(0, str(ROOT / "tolle" / "app"))

from server.core import settings, source_parsers as P, sources  # noqa: E402
from server.core.bible import parse_refs  # noqa: E402

PAGES = json.loads((ROOT / "tests" / "fixtures" / "source_pages.json").read_text())


def test_studylight_page_is_split_into_its_commentaries():
    secs = P.studylight(PAGES["studylight"])
    assert [s["label"] for s in secs] == [
        "Clarke, Adam – The Adam Clarke Commentary (1832)", "Calvin, John – Calvin's Commentary on the Bible (1840)",
        "Exell, Joseph S – The Biblical Illustrator (1905)", "Robertson, A.T – Robertson's Word Pictures of the New Testament (1932)",
        "Constable, Thomas – Expository Notes of Dr. Thomas Constable (2012)"]
    assert [s["group"] for s in secs] == ["1700s–1800s", "reformation & puritan", "pastoral", "language", "modern"]
    assert "Copyright" not in secs[0]["text"] and secs[0]["text"].startswith("For God so loved")


def test_other_pages():
    assert [s["group"] for s in P.biblehub(PAGES["biblehub"])] == ["1700s–1800s", "pastoral", "language", "pastoral"]
    assert "continued" not in P.biblehub(PAGES["biblehub"])[1]["text"]
    assert [s["label"] for s in P.catena(PAGES["catena"])] == ["Augustine of Hippo (AD 430)", "John Chrysostom (AD 407)"]
    assert P.catena(PAGES["catena_empty"]) == []          # Fathers not on the page: nothing, rather than noise
    words = P.interlinear(PAGES["interlinear"])[0]["text"].splitlines()
    assert words[2] == "ἠγάπησεν (ēgapēsen, Strong's 25) – loved [V-AIA-3S]"


def test_every_kind_of_voice_gets_a_turn():
    many = [{"label": f"{g} {n}", "group": g, "text": "x " * 2000} for g in ["modern"] * 8 + ["pastoral", "early church", "language"] for n in range(1)]
    chosen = P.pick(many, 2400)                           # room for four
    assert {s["group"] for s in chosen} == {"modern", "pastoral", "early church", "language"}
    assert all(len(s["text"]) <= 620 for s in chosen)


def test_all_built_in_sources_make_urls():
    ref = parse_refs("Song of Solomon 2:4")
    urls = {s["id"]: u for s, u, _ in [(src, u, l) for src, u, l in sources.plan(ref, settings.DEFAULT_SOURCES, "web", ["love"])]}
    assert urls["biblehub"] == "https://biblehub.com/commentaries/songs/2-4.htm"
    assert urls["catena"] == "https://catenabible.com/sg/2/4"
    assert urls["studylight"] == "https://www.studylight.org/commentary/song-of-solomon/2-4.html"
    assert urls["easton"] == "https://www.studylight.org/dictionaries/eng/ebd/l/love.html"
    assert sources.plan(parse_refs("1 Corinthians 13:4"), [settings.DEFAULT_SOURCES[2]], "web")[0][1] == \
        "https://biblehub.com/commentaries/1_corinthians/13-4.htm"
    assert sources.topic_vars("work and rest") is None    # dictionaries only for a word or two


def test_existing_users_get_the_new_sources():
    old = [{"id": "bible_text", "name": "Bible", "kind": "text", "enabled": True, "url": "x"},
           {"id": "studylight", "name": "My StudyLight", "kind": "commentary", "enabled": False, "url": "y"}]
    new, known = settings.with_new_sources(old, settings._FIRST_SOURCE_IDS)
    ids = [s["id"] for s in new]
    assert "biblehub" in ids and "catena" in ids and "easton" in ids
    assert "bst_mhc" not in ids                           # one they deleted earlier stays deleted
    sl = new[1]
    assert sl["name"] == "My StudyLight" and sl["enabled"] is False and sl["parser"] == "studylight" and sl["kind"] == "commentaries"
    again, _ = settings.with_new_sources([s for s in new if s["id"] != "catena"], known)
    assert "catena" not in [s["id"] for s in again]       # deleting a new one sticks too


def test_budget_fits_ollama_context():
    from server.core import jobs
    assert jobs.budget({"ai.context_chars": 40000, "ollama.num_ctx": 16384, "ai.max_output_tokens": 8000}, "ollama") == int((16384 - 8000 - 2500) * 3.2)
    assert jobs.budget({"ai.context_chars": 40000}, "gemini") == 40000
    assert jobs.budget({"ai.context_chars": 40000}, "ondevice") == 9000


def test_prompt_lists_sources_by_kind_with_labels():
    results = [{"name": "Bible", "kind": "text", "ref": "John 3:16", "url": "u1", "ok": True, "text": "For God so loved", "sections": [], "weight": 1},
               {"name": "StudyLight", "kind": "commentaries", "ref": "John 3:16", "url": "u2", "ok": True, "text": "",
                "sections": P.studylight(PAGES["studylight"]), "weight": 4}]
    sources.share(results, 6000)
    out = sources.format_for_prompt(results)
    assert out.index("### SOURCE: Bible") < out.index("### SOURCE: StudyLight")
    assert "#### Calvin, John – Calvin's Commentary on the Bible (1840) · reformation & puritan" in out
