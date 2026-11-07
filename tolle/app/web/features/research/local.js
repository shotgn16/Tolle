// Passage study on the device (mirrors server/features/research).
import SHARED from '../../core/local/shared.js';
import { AIError } from '../../core/local/ai.js';
import { parseRefs } from '../../core/local/bible.js';
import * as J from '../../core/local/jobs.js';
import { levelGuide, sourcesBlock } from '../../core/local/prompts.js';
import { formatForPrompt, gather, sourceMeta } from '../../core/local/sources.js';
import * as S from '../../core/local/studies.js';

const PURPOSES = SHARED.purposes;

export function passageStudy(passages, focus, level, src, purpose = '', notes = '') {
  const focusTxt = focus
    ? `Study these Scriptures in light of this word / sentence / topic: "${focus}". Trace how the focus appears in, or is illuminated by, each passage and how the passages speak to one another.`
    : 'Study these Scriptures together and show how they relate.';
  let structure;
  if (PURPOSES[purpose]) {
    const [, brief, sections] = PURPOSES[purpose];
    structure = `This study is for ${brief}. Start with ## Big idea (one memorable sentence) and ## Context, then use these sections as ## headings, in this order: ${sections}. Finish with ## Prayer and ## Sources consulted.`;
  } else {
    structure = 'Suggested structure (adapt to the level): ## Overview, ## The passages in context, ## The focus across the passages, '
      + '## What the commentators say, ## Cross references, ## Application, ## Questions, ## Sources consulted (a list of the source links you used).';
  }
  const keep = notes ? `\n\nKeep in mind: ${notes}` : '';
  return `PASSAGES: ${passages}\n\n${focusTxt}\n\n${levelGuide(level)}${keep}\n\n${structure}${sourcesBlock(src)}`;
}

export function register(engine) {
  engine.jobs({
    passage_study: [
      async ({ params, cfg, progress }) => {
        const passages = (params.passages || '').trim();
        const focus = (params.focus || '').trim();
        const refs = parseRefs(`${passages}\n${focus}`, 8);
        if (!refs.length) throw new AIError("I couldn't recognise any Bible references. Try a format like 'John 3:1-16; Romans 8'.");
        const results = await gather(refs, cfg.sources, cfg['bible.translation'], J.budget(cfg, params._provider), progress);
        return {
          messages: [J.systemMessage(cfg), { role: 'user', content: passageStudy(refs.map((r) => r.display).join(', '), focus, J.level(params), formatForPrompt(results), params.purpose || '', (params.notes || '').trim()) }],
          meta: { sources: sourceMeta(results), refs: refs.map((r) => r.display) },
        };
      },
      async ({ params, meta, text, thinking, model }) => {
        const purpose = (PURPOSES[params.purpose || ''] || [''])[0];
        const title = meta.refs.join(', ') + (params.focus ? ` — ${params.focus}` : '');
        const sid = params.study_id ? Number(params.study_id)
          : S.createStudy('passage', title, { passages: params.passages, focus: params.focus, level: J.level(params), purpose });
        const label = purpose ? `${purpose} notes` : 'Passage study';
        return { study_id: sid, entry_id: S.addEntry(sid, 'ai', 'research', `${label} (${J.levelName(params)})`, text, J.modelMeta(meta, params, model, thinking)) };
      },
    ],
  });
}
