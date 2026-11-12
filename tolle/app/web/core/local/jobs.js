// AI jobs for the on-device engine (mirrors server/core/jobs.py).
//
// A feature registers job kinds as { kind: [prepare, finish] }:
//   prepare({ params, cfg, progress }) -> { messages, images, meta }   (async)
//   finish({ params, meta, text, thinking, model })  -> result          (async)
// With the on-device model the job pauses at status "client"; the app runs the model and posts the
// answer back to ai/jobs/{id}/complete – exactly as with a server.
import { AIError, chat, continueRounds, outTokens } from './ai.js';
import { parseRefs } from './bible.js';
import { adaptMessages, compact, systemBase } from './prompts.js';
import { clean } from './repetition.js';
import * as settings from './settings.js';
import { db } from './store.js';

const KINDS = {};
const OWNER = {};

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
/** Source text to send: the setting, but never more than fits the model (same rules as the server). */
export function budget(cfg, provider) {
  const b = parseInt(cfg['ai.context_chars'], 10) || 40000;
  if (provider === 'ondevice') return Math.min(b, 9000);
  if (provider === 'ollama') {
    const ctx = parseInt(cfg['ollama.num_ctx'], 10) || 16384;
    const fits = Math.floor((ctx - outTokens(cfg) - 2500) * 3.2);
    return Math.max(4000, Math.min(b, fits));
  }
  return b;
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
export const systemMessage = (cfg) => ({ role: 'system', content: systemBase(cfg['study.perspective'] || '', compact(cfg)) });
export const modelMeta = (meta, params, model, thinking) => ({
  ...meta, model, provider: params._provider, level: params.level, thinking: thinking ? thinking.slice(0, 20000) : '',
});
export const aiOverrides = (body) => Object.fromEntries(['provider', 'model', 'thinking'].filter((k) => body[k] != null).map((k) => [k, body[k]]));

// ---------------------------------------------------------------- lifecycle
// Jobs are kept (encrypted) in the "jobs" collection, so the Tasks screen still shows them after the
// app was closed. A job that was running when the app closed can't finish; recover() marks it.
const now = () => Date.now() / 1000;
const SUBJECT_KEYS = ['title', 'passages', 'query', 'theme', 'focus', 'filename'];

function set(id, fields) { db.update('jobs', id, { ...fields, updated_at: now() }); }
function job(id) {
  const j = db.get('jobs', Number(id));
  if (!j || j.hidden) throw Object.assign(new Error('Job not found.'), { status: 404 });
  return j;
}

export function recover() {
  for (const j of db.all('jobs', (x) => x.status === 'queued' || x.status === 'running')) {
    set(j.id, { status: 'error', error: 'The app was closed before this finished. Please run it again.' });
  }
  const old = now() - 14 * 86400;
  db.remove('jobs', (x) => x.created_at < old);
}

export function create(kind, params, isEnabled) {
  if (!KINDS[kind]) throw Object.assign(new Error(`Unknown job kind ${kind}`), { status: 400 });
  if (OWNER[kind] && !isEnabled(OWNER[kind])) throw Object.assign(new Error('This part of Tolle is switched off.'), { status: 404 });
  const t = now();
  const id = db.insert('jobs', { kind, status: 'queued', progress: 'Queued', error: null, result: null, params: { ...params }, created_at: t, updated_at: t, hidden: false });
  run(id, kind, { ...params });
  return id;
}

async function run(id, kind, params) {
  const [prepare, finish] = KINDS[kind];
  try {
    set(id, { status: 'running', progress: 'Preparing…' });
    const cfg = settings.all();
    const [provider, model, thinking] = aiChoice(cfg, params);
    Object.assign(params, { _provider: provider, _model: model, _thinking: thinking });
    const prepared = await prepare({ params, cfg, progress: (m) => set(id, { progress: m }) });
    const { images = null, meta = {} } = prepared;
    const messages = adaptMessages(cfg, prepared.messages);
    if (provider === 'ondevice') {
      set(id, { status: 'client', progress: 'Waiting for on-device model…', params, meta,
        client: { messages, model, thinking, max_tokens: outTokens(cfg), auto_continue: continueRounds(cfg) } });
      return;
    }
    set(id, { progress: thinking ? `Thinking with ${model}…` : `Writing with ${model}…` });
    const out = await chat(cfg, provider, model, messages, { images, thinking, temperature: parseFloat(cfg['ai.temperature']) || 0.6, progress: (m) => set(id, { progress: m }) });
    if (!out.text) throw new AIError('The model returned an empty answer.');
    const result = await finish({ params, meta, text: out.text, thinking: out.thinking, model });
    set(id, { status: 'done', progress: 'Done', result });
  } catch (e) {
    console.error(e);
    set(id, { status: 'error', error: e.message || String(e) });
  }
}

export function get(id) {
  const j = job(id);
  const out = { id: j.id, kind: j.kind, status: j.status, progress: j.progress, error: j.error, result: j.result };
  if (j.status === 'client') out.client = j.client;
  return out;
}

function subject(j) {
  const p = j.params || {};
  for (const k of SUBJECT_KEYS) if (String(p[k] || '').trim()) return String(p[k]).trim().slice(0, 120);
  if (p.study_id) return (db.get('studies', Number(p.study_id))?.title || '').slice(0, 120);
  if (p.thread_id) return (db.get('chat_threads', Number(p.thread_id))?.title || '').slice(0, 120);
  if (p.session_id) return (db.get('calling_sessions', Number(p.session_id))?.title || '').slice(0, 120);
  if (p.file_id) return (db.get('files', Number(p.file_id))?.filename || '').slice(0, 120);
  return '';
}

function link(j) {
  const r = j.result || {};
  const p = j.params || {};
  if (r.thread_id || j.kind.startsWith('chat')) { const tid = r.thread_id || p.thread_id; return tid ? `#/chat/${tid}` : ''; }
  if (r.session_id || j.kind.startsWith('calling')) { const sid = r.session_id || p.session_id; return sid ? `#/calling/${sid}` : ''; }
  const sid = r.study_id || p.study_id;
  return sid ? `#/study/${sid}` : '';
}

/** Recent tasks for the Tasks screen, newest first (same shape as the server's GET ai/jobs). */
export function list(limit = 40) {
  return db.all('jobs', (j) => !j.hidden).sort((a, b) => b.id - a.id).slice(0, limit).map((j) => ({
    id: j.id, kind: j.kind, status: j.status, progress: j.progress, error: j.error, subject: subject(j),
    link: j.status === 'done' ? link(j) : '', created_at: j.created_at, updated_at: j.updated_at,
  }));
}

export function dismiss(id = null) {
  const finished = (j) => j.status === 'done' || j.status === 'error';
  for (const j of db.all('jobs', (x) => !x.hidden && finished(x) && (id == null || x.id === Number(id)))) set(j.id, { hidden: true });
}

export async function completeClient(id, text, thinking = '') {
  const j = db.get('jobs', Number(id));
  if (!j || j.status !== 'client') throw Object.assign(new Error("This job isn't waiting for an on-device answer."), { status: 409 });
  if (!(text || '').trim()) throw Object.assign(new Error('Empty answer.'), { status: 400 });
  let [cleaned, changed] = clean(text);
  if (changed) cleaned = `${cleaned.trimEnd()}\n\n*The model started repeating itself here, so Tolle cut the repeats. Try again or choose a lower depth for a complete answer.*`;
  const result = await KINDS[j.kind][1]({ params: j.params, meta: j.meta, text: cleaned, thinking, model: j.params._model || 'on-device' });
  set(j.id, { status: 'done', progress: 'Done', result, client: null });
  return get(id);
}

export function failClient(id, error) {
  const j = db.get('jobs', Number(id));
  if (j && j.status === 'client') set(j.id, { status: 'error', error: String(error).slice(0, 500) });
}
