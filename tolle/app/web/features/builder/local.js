// Study builder on the device (mirrors server/features/builder).
import SHARED from '../../core/local/shared.js';
import { parseRefs } from '../../core/local/bible.js';
import * as J from '../../core/local/jobs.js';
import { levelGuide, sourcesBlock } from '../../core/local/prompts.js';
import { formatForPrompt, gather, sourceMeta } from '../../core/local/sources.js';
import * as S from '../../core/local/studies.js';

const AUDIENCES = SHARED.audiences;

export function builder(p, src) {
  const lines = [
    `Build a Bible study plan for ${AUDIENCES[p.audience] || p.audience || 'a group'}.`,
    `Group size: ${p.size || 'not specified'}`,
    `Length of session: ${p.duration || '60'} minutes`,
    `Number of sessions: ${p.sessions || 1}`,
    `Passage(s): ${p.passages || 'NOT CHOSEN – suggest 3 suitable passage options first, then build the study on the best one'}`,
    `Theme / topic: ${p.theme || 'not specified'}`,
    `Audience notes (maturity, background, needs): ${p.notes || 'none'}`,
    `Preferred format: ${p.format || 'suggest what fits best'}`,
    levelGuide(p.level),
    '',
    'Include: ## Passage ideas (with one line on why each fits), ## Aim of the study, ## Format and timings '
      + '(a timed run-sheet: welcome, opening, reading, discussion, prayer…), ## Leader\'s background notes, '
      + '## Discussion questions — grouped as Observation, Interpretation and Application, with a few follow-up '
      + 'prompts, ## Activities or creative elements (optional), ## Prayer points, ## Take-home challenge. '
      + 'If more than one session, give an outline for each session.',
  ];
  return lines.join('\n') + sourcesBlock(src);
}

const capitalize = (s) => (s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s);

export function register(engine) {
  engine.jobs({
    builder: [
      async ({ params, cfg, progress }) => {
        let refs = parseRefs(params.passages || '', 6);
        if (!refs.length && params.theme) {
          progress('Looking for suitable passages…');
          refs = await J.suggestRefs(cfg, params._provider, params._model, params.theme);
        }
        const results = await gather(refs, cfg.sources, cfg['bible.translation'], J.budget(cfg, params._provider), progress, params.theme ? [params.theme] : null);
        return {
          messages: [J.systemMessage(cfg), { role: 'user', content: builder(params, formatForPrompt(results)) }],
          meta: { sources: sourceMeta(results), refs: refs.map((r) => r.display) },
        };
      },
      async ({ params, meta, text, thinking, model }) => {
        const aud = AUDIENCES[params.audience] || params.audience || 'Study';
        const title = params.title || `${capitalize(aud)}: ${params.passages || params.theme || 'Study plan'}`;
        const meta2 = Object.fromEntries(['audience', 'size', 'duration', 'sessions', 'passages', 'theme', 'format', 'notes', 'level'].map((k) => [k, params[k] ?? null]));
        const sid = S.createStudy('plan', title, meta2);
        return { study_id: sid, entry_id: S.addEntry(sid, 'ai', 'plan', 'Study plan', text, J.modelMeta(meta, params, model, thinking)) };
      },
    ],
  });
}
