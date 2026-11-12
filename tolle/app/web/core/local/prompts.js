// Prompt building shared by the features (mirrors server/core/ai/prompts.py and each feature's
// prompts.py). The wording itself comes from shared.json / your edits in Settings → AI instructions;
// tests check these functions build exactly the same prompts as the server.
import SHARED from './shared.js';
import { text } from './settings.js';

export const LEVEL_KEYS = Object.keys(SHARED.levels);
export const levelGuide = (level) => text(`level.${LEVEL_KEYS.includes(level) ? level : 'study'}`);

export function systemBase(perspective = '', compactRules = false) {
  const p = perspective
    ? `The user describes their tradition as: ${perspective}. Be sensitive to it, but still present other faithful views where Christians disagree.`
    : 'Do not assume a denomination; where Christians disagree, present the main views fairly.';
  return `${text(compactRules ? 'assistant_compact' : 'assistant')}\n- ${p}`;
}

/** Compact prompts for small instruct models (Settings → AI → Prompt style). */
export function compact(cfg) {
  const style = cfg['ai.prompt_style'] || 'auto';   // "auto": compact for models running on the device
  return style === 'compact' || (style === 'auto' && cfg['ai.provider'] === 'ondevice');
}
const COMPACT_SOURCES = 'Use the SOURCES above for this task: compare what the different commentators say, and use the historical, '
  + 'original-language and pastoral material too. Name the sources you use.';
const COMPACT_FOCUS = 'Keep it focused: write every section, briefly and clearly, rather than a few at length. Write the answer now.';
const SOURCES_RE = /\n*<SOURCES>\n([\s\S]*?)\n<\/SOURCES>\s*$/;

/** Small models follow what they read last: sources first, then the task (same as the server). */
export function adaptMessages(cfg, messages) {
  if (!compact(cfg) || !messages.length || messages[messages.length - 1].role !== 'user') return messages;
  const last = messages[messages.length - 1].content;
  const m = last.match(SOURCES_RE);
  if (!m) return messages;
  // The long guidance on using the sources becomes one line: small models do better with less to follow.
  const task = last.slice(0, m.index).replace(text('sources.use'), '').trimEnd();
  const src = m[1].trim();
  const content = (src ? `<SOURCES>\n${src}\n</SOURCES>\n\n${COMPACT_SOURCES}\n\n` : '') + `${task}\n\n${COMPACT_FOCUS}`;
  return [...messages.slice(0, -1), { ...messages[messages.length - 1], content }];
}

export const sourcesBlock = (src) => `\n\n${text('sources.use')}\n\n<SOURCES>\n${src}\n</SOURCES>`;
export const transcribeImage = () => SHARED.text.transcribe;
