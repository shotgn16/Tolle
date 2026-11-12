"""Prompts and reference parsing from the server code, for comparing with the on-device engine.

    python3 tests/device/expected.py > expected.json
"""
import json
import os
import sys
import tempfile
from pathlib import Path

APP = Path(__file__).resolve().parents[2] / "tolle" / "app"
os.environ.setdefault("TOLLE_DATA_DIR", tempfile.mkdtemp(prefix="tolle-parity-"))
sys.path.insert(0, str(APP))

from server import features  # noqa: E402

features.load()
from server.core.ai import prompts as core  # noqa: E402
from server.core.bible import parse_refs, template_vars  # noqa: E402
from server.features.builder import prompts as builder  # noqa: E402
from server.features.calling import prompts as calling  # noqa: E402
from server.features.insights import prompts as insights  # noqa: E402
from server.features.library import prompts as library  # noqa: E402
from server.features.research import prompts as research  # noqa: E402

REF_TEXTS = ["John 3:16-18; Rom 8", "1 Cor 13:4-7 and Ps 23", "Gen 1-2, Rev 21:1", "song of songs 2:4 jn 1:1",
             "Jude 3 and 3 John 2", "Matthew 5:3–12; Mk. 1:15", "no references here"]
BUILDER = {"audience": "youth", "size": "8", "duration": "45", "sessions": 2, "passages": "Luke 15",
           "theme": "grace", "notes": "new believers", "format": "", "level": "study"}

from server.core import settings as core_settings, source_parsers, sources as core_sources  # noqa: E402

PAGES = json.loads((Path(__file__).resolve().parents[1] / "fixtures" / "source_pages.json").read_text())
parsed = {k: source_parsers.PARSERS[k.split("_")[0]](v) for k, v in PAGES.items()}
mixed = parsed["studylight"] + parsed["biblehub"] + parsed["catena"]

out = {
    "system": core.system_base("Baptist"),
    "passage": research.passage_study("John 3:16, Romans 8", "love", "deep", "SRC", "sermon", "short"),
    "passage_plain": research.passage_study("Psalm 23", "", "intro", "SRC"),
    "insight": insights.insight("life", "work and rest", "study", "SRC"),
    "builder": builder.builder(BUILDER, "SRC"),
    "notes": library.notes_analysis("My notes", "Some notes", ["John 1"], "SRC", "preach"),
    "calling_system": calling.calling_system("Anglican"),
    "calling_opening": calling.calling_opening("I feel drawn to teaching"),
    "refs": {t: parse_refs(t) for t in REF_TEXTS},
    "template": template_vars(parse_refs("1 John 4:7-12")[0], "kjv"),
    "builder_params": BUILDER,
    "pages": PAGES,
    "parsed": parsed,
    "picked": source_parsers.pick(mixed, 3000),
    "plan": [[s["id"], u, label] for s, u, label in core_sources.plan(
        parse_refs("Song of Solomon 2:4; 1 Corinthians 13:4"), core_settings.DEFAULT_SOURCES, "web", ["love", "work and rest"])],
    "citations": [list(source_parsers._citation(c)) for c in [
        'Clarke, Adam. "Commentary on John 3:16". "The Adam Clarke Commentary". 1832.',
        'Exell, Joseph S. "Commentary on "John 3:16". The Biblical Illustrator. 1905-1909. New York.',
        'Haydock, George Leo. "Commentary on John 3". "George Haydock\'s Catholic Bible Commentary". 1859.']],
}
print(json.dumps(out, ensure_ascii=False))
