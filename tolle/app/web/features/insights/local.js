// Insights on the device (mirrors server/features/insights).
import SHARED from '../../core/local/shared.js';
import { AIError } from '../../core/local/ai.js';
import { parseRefs } from '../../core/local/bible.js';
import * as J from '../../core/local/jobs.js';
import { levelGuide, sourcesBlock } from '../../core/local/prompts.js';
import { formatForPrompt, gather, sourceMeta } from '../../core/local/sources.js';
import * as S from '../../core/local/studies.js';

export function insight(mode, query, level, src) {
  return `The user wants insight on ${SHARED.insight_modes[mode] || 'a topic'}: "${query}".\n\n`
    + `${levelGuide(level)}\n\n`
    + 'Give fresh, careful insight rather than generic statements. For a topic or area of life, identify the key passages across both Testaments, '
    + 'the main biblical principles (each tied to verses), common misunderstandings, and wise, pastoral application. '
    + 'For a passage, highlight what is easily missed. Finish with ## Going deeper (questions and passages to read next).'
    + sourcesBlock(src);
}

export function register(engine) {
  engine.jobs({
    insight: [
      async ({ params, cfg, progress }) => {
        const query = (params.query || '').trim();
        if (!query) throw new AIError('Please enter a passage, topic or area of life.');
        let refs = parseRefs(query, 6);
        if (!refs.length) {
          progress('Finding key passages…');
          refs = await J.suggestRefs(cfg, params._provider, params._model, query);
        }
        const results = await gather(refs, cfg.sources, cfg['bible.translation'], J.budget(cfg, params._provider), progress, parseRefs(query, 1).length ? null : [query]);
        return {
          messages: [J.systemMessage(cfg), { role: 'user', content: insight(params.mode || 'topic', query, J.level(params), formatForPrompt(results)) }],
          meta: { sources: sourceMeta(results), refs: refs.map((r) => r.display) },
        };
      },
      async ({ params, meta, text, thinking, model }) => {
        const sid = S.createStudy('insight', params.query, { mode: params.mode, level: J.level(params), query: params.query });
        return { study_id: sid, entry_id: S.addEntry(sid, 'ai', 'insight', `Insight (${J.levelName(params)})`, text, J.modelMeta(meta, params, model, thinking)) };
      },
    ],
  });
}
