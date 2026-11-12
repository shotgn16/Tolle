// Settings and AI instructions for the on-device engine (mirrors server/core/settings.py and
// server/core/ai/instructions.py). Defaults and wording come from shared.json.
import SHARED from './shared.js';
import { db } from './store.js';

// On a phone there's no server nearby, so start with the on-device model (a small one that suits phones).
const DEVICE_DEFAULTS = { 'ai.provider': 'ondevice', 'ondevice.model': 'Qwen3-1.7B-q4f16_1-MLC' };

export const DEFAULTS = { ...SHARED.defaults, ...DEVICE_DEFAULTS };
export const LEVELS = SHARED.levels;
const SECRET = new Set(SHARED.secret_keys);
const MASK = '••••••••';

// Sources that came with an update are added, and new fields filled in on built-in ones you already have;
// `sources.known` remembers which built-ins you've been given, so one you deleted doesn't come back.
// Same rules as server/core/settings.py (with_new_sources).
const FIRST_SOURCE_IDS = ['bible_text', 'studylight', 'bst_mhc', 'enduring_word', 'bibleproject'];
const DEFAULT_SOURCE_IDS = SHARED.default_sources.map((s) => s.id);

export function withNewSources(sources, known) {
  const out = sources.map((s) => ({ ...s }));
  for (const d of SHARED.default_sources) {
    const mine = out.find((s) => s.id === d.id);
    if (mine) {
      for (const k of ['parser', 'weight']) if (!(k in mine) && d[k] !== undefined) mine[k] = d[k];
      if (d.id === 'studylight' && mine.kind === 'commentary') mine.kind = 'commentaries';
    } else if (!known.includes(d.id)) out.push({ ...d });
  }
  return out;
}

export function all() {
  const saved = db.doc('settings');
  if (Array.isArray(saved.sources)) {
    const known = saved['sources.known'] || FIRST_SOURCE_IDS;
    const updated = withNewSources(saved.sources, known);
    if (JSON.stringify(updated) !== JSON.stringify(saved.sources) || JSON.stringify(known) !== JSON.stringify(DEFAULT_SOURCE_IDS)) {
      db.setDoc('settings', { ...saved, sources: updated, 'sources.known': DEFAULT_SOURCE_IDS });
      return { ...DEFAULTS, ...saved, sources: updated, 'sources.known': DEFAULT_SOURCE_IDS };
    }
  }
  return { ...DEFAULTS, ...saved };
}
export function get(key) { return all()[key]; }

export function publicValues() {
  const v = all();
  for (const k of SECRET) v[k] = v[k] ? MASK : '';
  return v;
}

export function setMany(values) {
  const cur = db.doc('settings');
  for (const [k, v] of Object.entries(values || {})) {
    if (!(k in DEFAULTS)) continue;
    if (SECRET.has(k) && v === MASK) continue; // unchanged masked value
    cur[k] = v;
  }
  db.setDoc('settings', cur);
}

// ---------------------------------------------------------------- AI instructions
const REGISTRY = Object.fromEntries(SHARED.instructions.map((i) => [i.key, i]));
const overrides = () => db.doc('instructions');

export function text(key) {
  const custom = (overrides()[key] || '').trim();
  return custom || REGISTRY[key]?.default || '';
}

export function instructionListing() {
  const over = overrides();
  return SHARED.instructions.map((i) => ({ ...i, value: over[i.key] || i.default, customised: !!(over[i.key] || '').trim() }));
}

export function saveInstructions(values) {
  const data = { ...overrides() };
  for (const [k, v] of Object.entries(values || {})) {
    if (!REGISTRY[k]) continue;
    const t = (v || '').trim();
    if (!t || t === REGISTRY[k].default) delete data[k]; else data[k] = t;
  }
  db.setDoc('instructions', data);
}

// ---------------------------------------------------------------- features switched off
export const disabledFeatures = () => db.doc('features').disabled || [];
export function setDisabledFeatures(ids) {
  const essential = new Set(SHARED.features.filter((f) => f.essential).map((f) => f.id));
  db.setDoc('features', { disabled: ids.filter((id) => !essential.has(id)) });
}
