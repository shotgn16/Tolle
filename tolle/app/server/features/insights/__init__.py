"""Insights on a passage, a biblical topic, or an area of life."""
from ...core import jobs, sources, store
from ...core.ai.providers import AIError
from ...core.bible import parse_refs
from .. import Feature
from . import prompts


def prepare(user_id, params, cfg, progress):
    query = (params.get("query") or "").strip()
    if not query:
        raise AIError("Please enter a passage, topic or area of life.")
    refs = parse_refs(query, limit=6)
    if not refs:
        progress("Finding key passages…")
        refs = jobs.suggest_refs(cfg, params["_provider"], params["_model"], query)
    results = sources.gather(refs, cfg["sources"], cfg["bible.translation"],
                             jobs.budget(cfg, params["_provider"]), progress, topics=[query] if not parse_refs(query, limit=1) else None)
    msgs = [jobs.system_message(cfg), {"role": "user", "content": prompts.insight(
        params.get("mode") or "topic", query, jobs.level(params), sources.format_for_prompt(results))}]
    return msgs, None, {"sources": jobs.source_meta(results), "refs": [r["display"] for r in refs]}


def finish(user_id, params, meta, text, thinking, model):
    sid = store.create_study(user_id, "insight", params["query"],
                             {"mode": params.get("mode"), "level": jobs.level(params), "query": params["query"]})
    eid = store.add_entry(user_id, sid, "ai", "insight", f"Insight ({jobs.level_name(params)})", text,
                          jobs.model_meta(meta, params, model, thinking))
    return {"study_id": sid, "entry_id": eid}


FEATURE = Feature(
    id="insights",
    name="Insights",
    description="Insight on a passage, topic or area of life",
    jobs={"insight": (prepare, finish)},
)
