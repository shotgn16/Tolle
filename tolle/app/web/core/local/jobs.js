// AI jobs for the on-device engine (mirrors server/core/jobs.py).
//
// A feature registers job kinds as { kind: [prepare, finish] }:
//   prepare({ params, cfg, progress }) -> { messages, images, meta }   (async)
//   finish({ params, meta, text, thinking, model })  -> result          (async)
// With the on-device model the job pauses at status "client"; the app runs the model and posts the
// answer back to ai/jobs/{id}/complete – exactly as with a server.
import { AIError, chat } from './ai.js';
import { parseRefs } from './bible.js';
import { systemBase } from './prompts.js';
import { clean } from './repetition.js';
import * as settings from './settings.js';

const KINDS = {};
const OWNER = {};
const jobs = new Map();
let nextId = 1;

export function register(kinds, featureId) {
  Object.assign(KINDS, kinds);
  if (featureId) for (const k of Object.keys(kinds)) OWNER[k] = featureId;
}

// ---------------------------------------------------------------- helpers for features
export function aiChoice(cfg, params) {
  const provider = params.provider || cfg['ai.provider'];
  const model = params.model || (provider === 'ondevice' ? cfg['ondevice.model'] : cfg['ai.model']);
  const thinking = params.thinking ?? cfg['ai.thinking'];
  return [provider, model, !!thinking];
}
export const level = (params) => (settings.LEVELS[params.level] ? params.level : 'study');
export const levelName = (params) => settings.LEVELS[level(params)];
export function budget(cfg, provider) {
  const b = parseInt(cfg['ai.context_chars'], 10) || 24000;
  return provider === 'ondevice' ? Math.min(b, 9000) : b;
}
export async function suggestRefs(cfg, provider, model, subject, n = 5) {
  if (provider === 'ondevice') return [];
  try {
    const out = await chat(cfg, provider, model, [
      { role: 'system', content: 'You list Bible references only.' },
      { role: 'user', content: `List the ${n} most important Bible passages for studying: ${subject}\nReply with references only, one per line, e.g. 'Romans 8:28-30'.` },
    ], { thinking: false, temperature: 0.2 });
    return parseRefs(out.text, n);
  } catch { return []; }
}
export const systemMessage = (cfg) => ({ role: 'system', content: systemBase(cfg['study.perspective'] || '') });
export const modelMeta = (meta, params, model, thinking) => ({
  ...meta, model, provider: params._provider, level: params.level, thinking: thinking ? thinking.slice(0, 20000) : '',
});
export const aiOverrides = (body) => Object.fromEntries(['provider', 'model', 'thinking'].filter((k) => body[k] != null).map((k) => [k, body[k]]));

// ---------------------------------------------------------------- lifecycle
export function create(kind, params, isEnabled) {
  if (!KINDS[kind]) throw Object.assign(new Error(`Unknown job kind ${kind}`), { status: 400 });
  if (OWNER[kind] && !isEnabled(OWNER[kind])) throw Object.assign(new Error('This part of Tolle is switched off.'), { status: 404 });
  const id = nextId++;
  jobs.set(id, { id, kind, status: 'queued', progress: 'Queued', error: null, result: null });
  run(id, kind, { ...params });
  return id;
}

async function run(id, kind, params) {
  const job = jobs.get(id);
  const [prepare, finish] = KINDS[kind];
  try {
    Object.assign(job, { status: 'running', progress: 'Preparing…' });
    const cfg = settings.all();
    const [provider, model, thinking] = aiChoice(cfg, params);
    Object.assign(params, { _provider: provider, _model: model, _thinking: thinking });
    const { messages, images = null, meta = {} } = await prepare({ params, cfg, progress: (m) => { job.progress = m; } });
    if (provider === 'ondevice') {
      Object.assign(job, { status: 'client', progress: 'Waiting for on-device model…', params, meta, client: { messages, model, thinking } });
      return;
    }
    job.progress = thinking ? `Thinking with ${model}…` : `Writing with ${model}…`;
    const out = await chat(cfg, provider, model, messages, { images, thinking, temperature: parseFloat(cfg['ai.temperature']) || 0.6 });
    if (!out.text) throw new AIError('The model returned an empty answer.');
    const result = await finish({ params, meta, text: out.text, thinking: out.thinking, model });
    Object.assign(job, { status: 'done', progress: 'Done', result });
  } catch (e) {
    console.error(e);
    Object.assign(job, { status: 'error', error: e.message || String(e) });
  }
}

export function get(id) {
  const j = jobs.get(Number(id));
  if (!j) throw Object.assign(new Error('Job not found.'), { status: 404 });
  const out = { id: j.id, kind: j.kind, status: j.status, progress: j.progress, error: j.error, result: j.result };
  if (j.status === 'client') out.client = j.client;
  return out;
}

export async function completeClient(id, text, thinking = '') {
  const j = jobs.get(Number(id));
  if (!j || j.status !== 'client') throw Object.assign(new Error("This job isn't waiting for an on-device answer."), { status: 409 });
  if (!(text || '').trim()) throw Object.assign(new Error('Empty answer.'), { status: 400 });
  let [cleaned, changed] = clean(text);
  if (changed) cleaned = `${cleaned.trimEnd()}\n\n*The model started repeating itself here, so Tolle cut the repeats. Try again or choose a lower depth for a complete answer.*`;
  const result = await KINDS[j.kind][1]({ params: j.params, meta: j.meta, text: cleaned, thinking, model: j.params._model || 'on-device' });
  Object.assign(j, { status: 'done', progress: 'Done', result, client: null });
  return get(id);
}

export function failClient(id, error) {
  const j = jobs.get(Number(id));
  if (j && j.status === 'client') Object.assign(j, { status: 'error', error: String(error).slice(0, 500) });
}
