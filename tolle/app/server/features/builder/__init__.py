"""Study builder: plans for a group, an individual, a meeting and more."""
from ...core import jobs, sources, store
from ...core.bible import parse_refs
from .. import Feature
from . import prompts


def prepare(user_id, params, cfg, progress):
    refs = parse_refs(params.get("passages") or "", limit=6)
    if not refs and params.get("theme"):
        progress("Looking for suitable passages…")
        refs = jobs.suggest_refs(cfg, params["_provider"], params["_model"], params["theme"])
    results = sources.gather(refs, cfg["sources"], cfg["bible.translation"],
                             jobs.budget(cfg, params["_provider"]), progress, topics=[params["theme"]] if params.get("theme") else None)
    msgs = [jobs.system_message(cfg),
            {"role": "user", "content": prompts.builder(params, sources.format_for_prompt(results))}]
    return msgs, None, {"sources": jobs.source_meta(results), "refs": [r["display"] for r in refs]}


def finish(user_id, params, meta, text, thinking, model):
    aud = prompts.AUDIENCES.get(params.get("audience"), params.get("audience") or "Study")
    title = params.get("title") or f"{aud.capitalize()}: {params.get('passages') or params.get('theme') or 'Study plan'}"
    sid = store.create_study(user_id, "plan", title, {k: params.get(k) for k in (
        "audience", "size", "duration", "sessions", "passages", "theme", "format", "notes", "level")})
    eid = store.add_entry(user_id, sid, "ai", "plan", "Study plan", text, jobs.model_meta(meta, params, model, thinking))
    return {"study_id": sid, "entry_id": eid}


FEATURE = Feature(
    id="builder",
    name="Study builder",
    description="Plan a study with passage ideas, format, timings and questions",
    jobs={"builder": (prepare, finish)},
)
