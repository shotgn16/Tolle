"""Complete answers: cut-off answers are continued, repeats at the join are removed, small-model prompts."""
import os
import sys
import tempfile
from pathlib import Path

APP = Path(__file__).resolve().parents[1] / "tolle" / "app"
os.environ.setdefault("TOLLE_DATA_DIR", tempfile.mkdtemp(prefix="tolle-ai-"))
sys.path.insert(0, str(APP))

from server.core.ai import prompts, providers  # noqa: E402


def fake(parts):
    """A provider that answers in pieces; every piece but the last hits the length limit."""
    calls = []

    def once(cfg, provider, model, messages, images, thinking, temperature, penalty):
        calls.append(messages)
        i = len(calls) - 1
        return {"text": parts[i], "thinking": "", "truncated": i < len(parts) - 1}
    return once, calls


def test_cut_off_answer_is_continued(monkeypatch):
    once, calls = fake(["## Overview\nGrace is the free gift of God, given", "given to people who could never earn it.\n\n## Application\nRest in it."])
    monkeypatch.setattr(providers, "_chat_once", once)
    out = providers.chat({"ai.auto_continue": 3}, "ollama", "m", [{"role": "user", "content": "Study grace"}])
    assert out["text"] == "## Overview\nGrace is the free gift of God, given to people who could never earn it.\n\n## Application\nRest in it."
    assert len(calls) == 2
    assert calls[1][-2] == {"role": "assistant", "content": "## Overview\nGrace is the free gift of God, given"}
    assert calls[1][-1]["content"] == providers.CONTINUE_PROMPT


def test_gives_up_after_the_limit_with_a_note(monkeypatch):
    once, calls = fake(["Part one is long and", " part two is long and", " part three is long and", " never done"])
    monkeypatch.setattr(providers, "_chat_once", once)
    out = providers.chat({"ai.auto_continue": 1}, "ollama", "m", [{"role": "user", "content": "x"}])
    assert len(calls) == 2 and out["text"].endswith(providers.LIMIT_NOTE)


def test_continue_can_be_switched_off(monkeypatch):
    once, calls = fake(["Cut off here", "more"])
    monkeypatch.setattr(providers, "_chat_once", once)
    out = providers.chat({"ai.auto_continue": 0}, "ollama", "m", [{"role": "user", "content": "x"}])
    assert len(calls) == 1 and providers.LIMIT_NOTE in out["text"]


def test_join_drops_a_restart():
    done = "## Overview\nThe passage opens with a question about faith and works."
    assert providers.join_continuation(done, done + " More text.") == done + " More text."
    assert providers.join_continuation(done, "## Overview\nThe passage opens") == done   # started again, nothing new
    assert providers.join_continuation("He gave", "given freely") == "He gave given freely"   # not a whole-word overlap
    assert providers.join_continuation("Ends mid", "word and carries on.") == "Ends mid word and carries on."
    assert providers.join_continuation("Ends with a list:", "- one\n- two") == "Ends with a list:\n\n- one\n- two"


def test_compact_prompts_put_sources_first():
    cfg = {"ai.prompt_style": "compact"}
    msgs = [{"role": "system", "content": "S"}, {"role": "user", "content": "Write a study on John 1." + prompts.sources_block("Commentary text")}]
    out = prompts.adapt_messages(cfg, msgs)
    assert out[1]["content"].startswith("<SOURCES>\nCommentary text\n</SOURCES>")
    assert out[1]["content"].rstrip().endswith("Write the answer now.")
    assert "Write a study on John 1." in out[1]["content"]
    assert prompts.adapt_messages({"ai.prompt_style": "full"}, msgs) == msgs
    assert "Say each thing once" in prompts.system_base("", True)
