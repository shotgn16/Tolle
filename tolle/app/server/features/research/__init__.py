"""Passage study: research one or more passages in light of a word, sentence or topic."""
from ...core import jobs, sources, store
from ...core.ai.providers import AIError
from ...core.bible import parse_refs
from .. import Feature
from . import prompts


def prepare(user_id, params, cfg, progress):
    passages = (params.get("passages") or "").strip()
    focus = (params.get("focus") or "").strip()
    refs = parse_refs(passages + "\n" + focus, limit=8)
    if not refs:
        raise AIError("I couldn't recognise any Bible references. Try a format like 'John 3:1-16; Romans 8'.")
    results = sources.gather(refs, cfg["sources"], cfg["bible.translation"],
                             jobs.budget(cfg, params["_provider"]), progress)
    msgs = [jobs.system_message(cfg), {"role": "user", "content": prompts.passage_study(
        ", ".join(r["display"] for r in refs), focus, jobs.level(params), sources.format_for_prompt(results),
        params.get("purpose") or "", (params.get("notes") or "").strip())}]
    return msgs, None, {"sources": jobs.source_meta(results), "refs": [r["display"] for r in refs]}


def finish(user_id, params, meta, text, thinking, model):
    purpose = prompts.PURPOSES.get(params.get("purpose") or "", ("", "", ""))[0]
    title = ", ".join(meta["refs"]) + (f" — {params['focus']}" if params.get("focus") else "")
    sid = int(params["study_id"]) if params.get("study_id") else store.create_study(
        user_id, "passage", title, {"passages": params.get("passages"), "focus": params.get("focus"),
                                    "level": jobs.level(params), "purpose": purpose})
    label = f"{purpose} notes" if purpose else "Passage study"
    eid = store.add_entry(user_id, sid, "ai", "research", f"{label} ({jobs.level_name(params)})", text,
                          jobs.model_meta(meta, params, model, thinking))
    return {"study_id": sid, "entry_id": eid}


FEATURE = Feature(
    id="research",
    name="Passage study",
    description="Research passages across commentaries, at four levels of depth",
    jobs={"passage_study": (prepare, finish)},
)
