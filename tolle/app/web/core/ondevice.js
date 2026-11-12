// On-device AI using WebLLM (WebGPU). The model downloads once and is cached by
// the browser / mobile WebView; after that it runs fully offline on the device.
// The WebLLM library itself ships with the app (vendor/web-llm), so nothing loads from a CDN.
let engine = null;
let loaded = null;
let webllm = null;

export function webgpuAvailable() { return !!navigator.gpu; }

async function lib() {
  if (!webllm) webllm = await import('../vendor/web-llm/web-llm.js');
  return webllm;
}

// Inside the phone/tablet apps the browser Cache API isn't always kept, so models go in IndexedDB.
function appConfig(w) {
  const native = !!window.Capacitor?.isNativePlatform?.();
  const backend = native || !('caches' in window) ? 'indexeddb' : 'cache';
  return { ...w.prebuiltAppConfig, cacheBackend: backend, useIndexedDBCache: backend === 'indexeddb' };
}

export async function ensureModel(model, onProgress = () => {}) {
  if (!webgpuAvailable()) {
    throw new Error('On-device AI needs WebGPU (Chrome/Edge 113+, Safari 18+ or the Tolle mobile app on a recent phone). '
      + 'Choose another AI provider in Settings, or open Tolle in a supported browser.');
  }
  const w = await lib();
  const progress = (r) => onProgress(`Loading ${model}: ${r.text || ''}`);
  if (!engine) {
    engine = await w.CreateMLCEngine(model, { initProgressCallback: progress, appConfig: appConfig(w) });
  } else if (loaded !== model) {
    engine.setInitProgressCallback(progress);
    await engine.reload(model);
  }
  loaded = model;
  return engine;
}

async function generate(e, model, messages, thinking, maxTokens, onProgress) {
  const req = { messages, temperature: 0.6, stream: true, frequency_penalty: 0.4, presence_penalty: 0.2, max_tokens: maxTokens };
  if (/qwen3/i.test(model)) req.extra_body = { enable_thinking: !!thinking };
  const stream = await e.chat.completions.create(req);
  let text = '';
  let n = 0;
  let reason = '';
  let looped = false;
  for await (const chunk of stream) {
    text += chunk.choices?.[0]?.delta?.content || '';
    reason = chunk.choices?.[0]?.finish_reason || reason;
    if (++n % 40 === 0) {
      onProgress(`Writing on this device… ${text.length} characters`);
      if (looping(text)) { e.interruptGenerate(); looped = true; break; } // stuck repeating a phrase
    }
  }
  const thoughts = [...text.matchAll(/<think>([\s\S]*?)<\/think>/g)].map((m) => m[1]).join('\n');
  text = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  return { text, thinking: thoughts.trim(), truncated: reason === 'length', looped };
}

export async function runOnDevice(job, onProgress = () => {}) {
  const { messages, model, thinking } = job;
  const maxTokens = Math.min(4096, Math.max(256, parseInt(job.max_tokens, 10) || 3000));   // small models: a few thousand tokens of memory
  const rounds = Number.isInteger(job.auto_continue) ? job.auto_continue : 2;
  const e = await ensureModel(model, onProgress);
  onProgress(`Writing on this device with ${model}…`);
  const first = await generate(e, model, messages, thinking, maxTokens, onProgress);
  let { text } = first;
  let truncated = first.truncated && !first.looped;
  if (truncated && rounds > 0) {
    // Small on-device models have little memory, so continuing sends only the end of the answer so far.
    const { CONTINUE_PROMPT, joinContinuation } = await import('./local/ai.js');
    const system = messages.find((m) => m.role === 'system');
    for (let n = 1; truncated && n <= rounds; n += 1) {
      onProgress(`The answer is long – continuing (${n})…`);
      const ask = [...(system ? [system] : []), { role: 'user', content:
        `This is the end of an answer you were writing:\n<ANSWER_SO_FAR>\n${text.slice(-2000)}\n</ANSWER_SO_FAR>\n\n${CONTINUE_PROMPT}` }];
      const more = await generate(e, model, ask, false, maxTokens, onProgress);
      const before = text;
      text = joinContinuation(text, more.text);
      truncated = more.truncated && !more.looped && text !== before;
    }
  }
  if (truncated) text += '\n\n*This answer reached the length limit. Raise “Longest answer” in Settings → AI, choose a lower depth, or ask for less at once.*';
  return { text, thinking: first.thinking };
}

// Same idea as the server's check: the end of the text is one phrase repeated over and over.
function looping(text) {
  const tail = text.slice(-1500);
  const m = tail.match(/(.{12,200}?)(?:[\s—–\-,;.:*]*\1){4,}[\s\S]{0,300}$/s);
  return !!m && (m[1].match(/[A-Za-z]/g) || []).length >= 8;
}
