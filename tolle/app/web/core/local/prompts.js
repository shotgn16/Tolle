// Prompt building shared by the features (mirrors server/core/ai/prompts.py and each feature's
// prompts.py). The wording itself comes from shared.json / your edits in Settings → AI instructions;
// tests check these functions build exactly the same prompts as the server.
import SHARED from './shared.js';
import { text } from './settings.js';

export const LEVEL_KEYS = Object.keys(SHARED.levels);
export const levelGuide = (level) => text(`level.${LEVEL_KEYS.includes(level) ? level : 'study'}`);

export function systemBase(perspective = '') {
  const p = perspective
    ? `The user describes their tradition as: ${perspective}. Be sensitive to it, but still present other faithful views where Christians disagree.`
    : 'Do not assume a denomination; where Christians disagree, present the main views fairly.';
  return `${text('assistant')}\n- ${p}`;
}

export const sourcesBlock = (src) => `\n\n<SOURCES>\n${src}\n</SOURCES>`;
export const transcribeImage = () => SHARED.text.transcribe;
