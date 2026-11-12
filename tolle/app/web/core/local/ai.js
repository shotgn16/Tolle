// AI providers for the on-device engine – the same providers and rules as server/core/ai/providers.py.
// Requests go straight from this device to Ollama (on your network) or the AI service.
// The "ondevice" provider never comes here: jobs hand those to the device's own model (core/ondevice.js).
import SHARED from './shared.js';
import { request } from './http.js';
import { clean, hasLoop, LOOP_NOTE } from './repetition.js';

export const PROVIDERS = SHARED.providers;
export const ONDEVICE_MODELS = SHARED.ondevice_models;

export class AIError extends Error {}

const LONG = 15 * 60 * 1000;
const REASONING = /^(o\d|gpt-5|gpt-oss)/i;
const THINK_TAG = /<think>([\s\S]*?)<\/think>/g;

function stripThink(text) {
  const thoughts = [...(text || '').matchAll(THINK_TAG)].map((m) => m[1]).join('\n');
  return [(text || '').replace(THINK_TAG, '').trim(), thoughts.trim()];
}

function split(messages) {
  return [messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n'), messages.filter((m) => m.role !== 'system')];
}

function fail(r, name) {
  const detail = typeof r.data === 'object' ? JSON.stringify(r.data.error || r.data).slice(0, 300) : String(r.text).slice(0, 300);
  return new AIError(`${name} returned HTTP ${r.status}: ${detail}`);
}

async function call(name, opts) {
  try { return await request({ timeout: LONG, ...opts }); } catch (e) { throw new AIError(`${name}: ${e.message}`); }
}

const mime = (b64) => (b64.startsWith('iVBOR') ? 'image/png' : b64.startsWith('R0lG') ? 'image/gif' : b64.startsWith('UklG') ? 'image/webp' : 'image/jpeg');

// ---------------------------------------------------------------- Ollama
const ollamaUrl = (cfg) => (cfg['ollama.url'] || 'http://localhost:11434').replace(/\/+$/, '');

async function ollamaModels(cfg) {
  const r = await call('Ollama', { url: `${ollamaUrl(cfg)}/api/tags`, timeout: 20000 });
  if (r.status !== 200) throw fail(r, 'Ollama');
  const out = [];
  for (const m of (r.data.models || []).slice(0, 60)) {
    let caps = [];
    try {
      const s = await request({ url: `${ollamaUrl(cfg)}/api/show`, method: 'POST', json: { model: m.name }, timeout: 15000 });
      if (s.status === 200) caps = s.data.capabilities || [];
    } catch { /* capabilities unknown */ }
    out.push({ id: m.name, thinking: caps.length ? caps.includes('thinking') : null, vision: caps.length ? caps.includes('vision') : null });
  }
  return out;
}

/** The longest answer to ask for, in tokens (Settings → AI → Longest answer). */
export const outTokens = (cfg) => Math.max(256, parseInt(cfg['ai.max_output_tokens'], 10) || 8000);
const penaltyOf = (cfg) => parseFloat(cfg['ai.repeat_penalty']) || 1.12;

function ollamaOptions(cfg, messages, temperature, penalty) {
  // Size the context window to the request: Ollama otherwise silently cuts long requests short.
  const chars = messages.reduce((n, m) => n + (m.content || '').length, 0);
  const out = outTokens(cfg);
  const needed = Math.floor(chars / 3.2) + out + 512;
  const cap = parseInt(cfg['ollama.num_ctx'], 10) || 16384;
  const pow2 = 2 ** Math.ceil(Math.log2(Math.max(needed, 2)));
  return { temperature, num_ctx: Math.max(4096, Math.min(cap, pow2)), num_predict: out,
    repeat_penalty: penalty, repeat_last_n: 256, top_p: 0.9 };
}

async function ollamaChat(cfg, model, messages, images, thinking, temperature, penalty) {
  const msgs = messages.map((m) => ({ ...m }));
  if (images?.length) msgs[msgs.length - 1].images = images;
  const body = { model, messages: msgs, stream: false, think: !!thinking, options: ollamaOptions(cfg, msgs, temperature, penalty) };
  let r = await call('Ollama', { url: `${ollamaUrl(cfg)}/api/chat`, method: 'POST', json: body });
  if (r.status === 400 && /think/i.test(r.text)) { delete body.think; r = await call('Ollama', { url: `${ollamaUrl(cfg)}/api/chat`, method: 'POST', json: body }); }
  if (r.status !== 200) throw fail(r, 'Ollama');
  const msg = r.data.message || {};
  const [text, tagged] = stripThink(msg.content || '');
  return { text, thinking: msg.thinking || tagged, truncated: r.data.done_reason === 'length' };
}

// ---------------------------------------------------------------- OpenAI and OpenAI-compatible
const oa = (cfg, compat) => (compat
  ? [(cfg['compat.base_url'] || '').replace(/\/+$/, ''), cfg['compat.key'] || 'none']
  : [(cfg['openai.base_url'] || 'https://api.openai.com/v1').replace(/\/+$/, ''), cfg['openai.key']]);

async function openaiModels(cfg, compat) {
  const [base, key] = oa(cfg, compat);
  if (!key) throw new AIError('No API key set.');
  const r = await call(compat ? 'OpenAI-compatible API' : 'OpenAI', { url: `${base}/models`, headers: { Authorization: `Bearer ${key}` }, timeout: 20000 });
  if (r.status !== 200) throw fail(r, 'OpenAI');
  let ids = (r.data.data || []).map((m) => m.id).sort();
  if (!compat) ids = ids.filter((i) => /^(gpt|o\d|chatgpt)/.test(i) && !/(audio|realtime|tts|transcribe|image|embedding|search|moderation)/.test(i));
  return ids.map((id) => ({ id, thinking: REASONING.test(id) || null, vision: null }));
}

async function openaiChat(cfg, model, messages, images, thinking, temperature, compat) {
  const [base, key] = oa(cfg, compat);
  const name = compat ? 'OpenAI-compatible API' : 'OpenAI';
  if (!key) throw new AIError('No API key set for this provider (Settings → AI).');
  const msgs = messages.map((m) => ({ ...m }));
  if (images?.length) {
    const last = msgs[msgs.length - 1];
    last.content = [{ type: 'text', text: last.content }, ...images.map((b) => ({ type: 'image_url', image_url: { url: `data:${mime(b)};base64,${b}` } }))];
  }
  const body = { model, messages: msgs };
  if (compat) body.max_tokens = outTokens(cfg);   // local servers often default to a short answer
  if (REASONING.test(model)) body.reasoning_effort = thinking ? 'high' : 'low'; else body.temperature = temperature;
  const headers = { Authorization: `Bearer ${key}` };
  let r = await call(name, { url: `${base}/chat/completions`, method: 'POST', json: body, headers });
  if (r.status === 400 && /reasoning|temperature/.test(r.text)) {
    delete body.reasoning_effort; delete body.temperature;
    r = await call(name, { url: `${base}/chat/completions`, method: 'POST', json: body, headers });
  }
  if (r.status === 400 && /max_tokens/.test(r.text)) {
    delete body.max_tokens;
    r = await call(name, { url: `${base}/chat/completions`, method: 'POST', json: body, headers });
  }
  if (r.status !== 200) throw fail(r, name);
  const choice = r.data.choices[0];
  const msg = choice.message;
  const [text, tagged] = stripThink(msg.content || '');
  return { text, thinking: msg.reasoning_content || msg.reasoning || tagged, truncated: choice.finish_reason === 'length' };
}

// ---------------------------------------------------------------- Gemini
const GEM = 'https://generativelanguage.googleapis.com/v1beta';

async function geminiModels(cfg) {
  if (!cfg['gemini.key']) throw new AIError('No Gemini API key set.');
  const r = await call('Gemini', { url: `${GEM}/models`, params: { pageSize: 200 }, headers: { 'x-goog-api-key': cfg['gemini.key'] }, timeout: 20000 });
  if (r.status !== 200) throw fail(r, 'Gemini');
  return (r.data.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent') && m.name.includes('gemini'))
    .map((m) => ({ id: m.name.split('/').slice(1).join('/'), thinking: m.thinking ?? null, vision: true }));
}

async function geminiChat(cfg, model, messages, images, thinking, temperature) {
  const key = cfg['gemini.key'];
  if (!key) throw new AIError('No Gemini API key set (Settings → AI).');
  const [system, rest] = split(messages);
  const contents = rest.map((m, i) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }, ...(images?.length && i === rest.length - 1 ? images.map((b) => ({ inline_data: { mime_type: mime(b), data: b } })) : [])],
  }));
  // Gemini counts its thinking against the same limit as the answer, so leave room for both.
  const body = { contents, generationConfig: { temperature, maxOutputTokens: Math.min(65536, outTokens(cfg) + (thinking ? 16384 : 4096)),
    thinkingConfig: { includeThoughts: true, thinkingBudget: thinking ? -1 : 0 } } };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  const opts = { url: `${GEM}/models/${model}:generateContent`, method: 'POST', headers: { 'x-goog-api-key': key } };
  let r = await call('Gemini', { ...opts, json: body });
  if (r.status === 400 && /thinking/i.test(r.text)) {
    if (thinking) delete body.generationConfig.thinkingConfig; else body.generationConfig.thinkingConfig = { includeThoughts: false };
    r = await call('Gemini', { ...opts, json: body });
    if (r.status === 400) { delete body.generationConfig.thinkingConfig; r = await call('Gemini', { ...opts, json: body }); }
  }
  if (r.status === 400 && /maxoutputtokens/i.test(r.text)) {
    body.generationConfig.maxOutputTokens = 8192;   // older models allow less
    r = await call('Gemini', { ...opts, json: body });
  }
  if (r.status !== 200) throw fail(r, 'Gemini');
  const cand = (r.data.candidates || [])[0];
  if (!cand) throw new AIError(`Gemini returned no answer: ${JSON.stringify(r.data.promptFeedback || r.data).slice(0, 200)}`);
  const parts = cand.content?.parts || [];
  return { text: parts.filter((p) => !p.thought).map((p) => p.text || '').join('').trim(),
    thinking: parts.filter((p) => p.thought).map((p) => p.text || '').join('\n').trim(),
    truncated: cand.finishReason === 'MAX_TOKENS' };
}

// ---------------------------------------------------------------- Anthropic
const ANT = 'https://api.anthropic.com/v1';
const antHeaders = (key) => ({ 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' });

async function anthropicModels(cfg) {
  if (!cfg['anthropic.key']) throw new AIError('No Anthropic API key set.');
  const r = await call('Anthropic', { url: `${ANT}/models`, params: { limit: 100 }, headers: antHeaders(cfg['anthropic.key']), timeout: 20000 });
  if (r.status !== 200) throw fail(r, 'Anthropic');
  return (r.data.data || []).map((m) => ({ id: m.id, thinking: true, vision: true }));
}

async function anthropicChat(cfg, model, messages, images, thinking, temperature) {
  const key = cfg['anthropic.key'];
  if (!key) throw new AIError('No Anthropic API key set (Settings → AI).');
  const [system, rest] = split(messages);
  const msgs = rest.map((m, i) => ({
    role: m.role,
    content: [...(images?.length && i === rest.length - 1 ? images.map((b) => ({ type: 'image', source: { type: 'base64', media_type: mime(b), data: b } })) : []),
      { type: 'text', text: m.content }],
  }));
  const body = { model, max_tokens: outTokens(cfg) + (thinking ? 8000 : 0), messages: msgs };
  if (system) body.system = system;
  if (thinking) body.thinking = { type: 'enabled', budget_tokens: 8000 }; else body.temperature = temperature;
  const opts = { url: `${ANT}/messages`, method: 'POST', headers: antHeaders(key) };
  let r = await call('Anthropic', { ...opts, json: body });
  if (r.status === 400 && /thinking/.test(r.text)) { delete body.thinking; r = await call('Anthropic', { ...opts, json: body }); }
  if (r.status !== 200) throw fail(r, 'Anthropic');
  const blocks = r.data.content || [];
  return { text: blocks.filter((b) => b.type === 'text').map((b) => b.text).join('').trim(),
    thinking: blocks.filter((b) => b.type === 'thinking').map((b) => b.thinking || '').join('\n').trim(),
    truncated: r.data.stop_reason === 'max_tokens' };
}

// ---------------------------------------------------------------- dispatch
export async function listModels(cfg, provider) {
  switch (provider) {
    case 'ollama': return ollamaModels(cfg);
    case 'openai': return openaiModels(cfg, false);
    case 'openai_compat': return openaiModels(cfg, true);
    case 'gemini': return geminiModels(cfg);
    case 'anthropic': return anthropicModels(cfg);
    case 'ondevice': return ONDEVICE_MODELS;
    default: throw new AIError(`Unknown provider ${provider}`);
  }
}

function once(cfg, provider, model, messages, images, thinking, temperature, penalty) {
  switch (provider) {
    case 'ollama': return ollamaChat(cfg, model, messages, images, thinking, temperature, penalty);
    case 'openai': return openaiChat(cfg, model, messages, images, thinking, temperature, false);
    case 'openai_compat': return openaiChat(cfg, model, messages, images, thinking, temperature, true);
    case 'gemini': return geminiChat(cfg, model, messages, images, thinking, temperature);
    case 'anthropic': return anthropicChat(cfg, model, messages, images, thinking, temperature);
    default: throw new AIError(`Provider ${provider} can't be used here.`);
  }
}

// ---------------------------------------------------------------- complete answers
// Same rules and wording as server/core/ai/providers.py.
export const CONTINUE_PROMPT = 'Your answer above was cut off because it reached the length limit. Continue it from exactly where '
  + 'it stopped – mid-sentence if need be. Do not repeat anything already written, do not start again, '
  + 'and do not add an introduction or a note about continuing. Complete the remaining sections, '
  + 'then stop.';
export const LIMIT_NOTE = '\n\n*This answer reached the length limit. Raise “Longest answer” in Settings → AI, choose a lower depth, '
  + 'or ask for less at once.*';

/** Stitch a continuation onto a cut-off answer, dropping any part the model repeated. */
export function joinContinuation(done, more) {
  more = (more || '').replace(/^\n+/, '');
  if (!more) return done;
  const tail = done.slice(-400);
  let overlapped = false;
  const alnum = (c) => /[A-Za-z0-9]/.test(c || '');
  for (let size = Math.min(tail.length, more.length); size > 3; size -= 1) {
    if (!more.startsWith(tail.slice(-size))) continue;
    // Short overlaps only count when they are whole words ("…given" + "given to…").
    const whole = (size === done.length || !alnum(done[done.length - size - 1])) && (size === more.length || !alnum(more[size]));
    if (size >= 12 || whole) { more = more.slice(size); overlapped = true; break; }
  }
  if (!overlapped) {
    const head = done.trim().slice(0, 120);
    const m = more.trim();
    if (head && (m.startsWith(head) || (m.length >= 12 && head.startsWith(m)))) return done;
  }
  if (!more.trim()) return done;
  let joiner = '';
  if (!(/[ \n]$/.test(done) || /^[ \n,.;:)]/.test(more))) {
    joiner = /[A-Za-z0-9]$/.test(done) && /^[A-Za-z0-9]/.test(more) && !done.endsWith('-') ? ' ' : '';
  }
  if (/^\s*(#|- |\* |1\.|\|)/.test(more) && !done.endsWith('\n')) joiner = '\n\n';
  return done + joiner + more;
}

/** How many times to continue an answer that hit the length limit (Settings → AI → Keep going). */
export const continueRounds = (cfg) => { const n = parseInt(cfg['ai.auto_continue'], 10); return Number.isNaN(n) ? 3 : Math.max(0, n); };

/**
 * Keep asking for more while the answer was cut off by the length limit.
 * ask(messages) -> { text, truncated, looped }  (any provider, including the on-device model)
 */
export async function complete(cfg, messages, first, ask, progress = () => {}) {
  let text = first.text;
  let looped = !!first.looped;
  let truncated = !!first.truncated && !looped;
  for (let n = 1; truncated && n <= continueRounds(cfg) && text.trim(); n += 1) {
    progress(`The answer is long – continuing (${n})…`);
    const more = await ask([...messages, { role: 'assistant', content: text }, { role: 'user', content: CONTINUE_PROMPT }]);
    const before = text;
    text = joinContinuation(text, more.text);
    looped = !!more.looped;
    truncated = !!more.truncated && !looped && text !== before;
  }
  return { text, looped, truncated };
}

async function run(cfg, provider, model, messages, images, thinking, temperature) {
  let out = await once(cfg, provider, model, messages, images, thinking, temperature, penaltyOf(cfg));
  if (hasLoop(out.text)) {
    const retry = await once(cfg, provider, model, messages, images, thinking, Math.min(1, temperature + 0.15), penaltyOf(cfg) + 0.13);
    if (!hasLoop(retry.text) || clean(retry.text)[0].length > clean(out.text)[0].length) out = retry;
  }
  return out;
}

/** Run a chat and return a complete, clean answer: continue cut-off answers, never keep a repetition loop. */
export async function chat(cfg, provider, model, messages, { images = null, thinking = false, temperature = 0.6, progress } = {}) {
  if (!model) throw new AIError('No model selected. Choose one in Settings → AI or in the model picker.');
  const first = await run(cfg, provider, model, messages, images, thinking, temperature);
  const done = await complete(cfg, messages, first, (msgs) => run(cfg, provider, model, msgs, null, false, temperature), progress);
  let [text, changed] = clean(done.text);
  if (changed || done.looped) text = text.trimEnd() + LOOP_NOTE;
  else if (done.truncated) text = text.trimEnd() + LIMIT_NOTE;
  return { text, thinking: first.thinking || '' };
}
