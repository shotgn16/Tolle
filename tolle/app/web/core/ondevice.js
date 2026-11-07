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

export async function runOnDevice(job, onProgress = () => {}) {
  const { messages, model, thinking } = job;
  const e = await ensureModel(model, onProgress);
  const req = { messages, temperature: 0.6, stream: true, frequency_penalty: 0.4, presence_penalty: 0.2 };
  if (/qwen3/i.test(model)) req.extra_body = { enable_thinking: !!thinking };
  onProgress(`Writing on this device with ${model}…`);
  const stream = await e.chat.completions.create(req);
  let text = '';
  let n = 0;
  for await (const chunk of stream) {
    text += chunk.choices?.[0]?.delta?.content || '';
    if (++n % 40 === 0) {
      onProgress(`Writing on this device… ${text.length} characters`);
      if (looping(text)) { e.interruptGenerate(); break; } // stuck repeating a phrase
    }
  }
  const thoughts = [...text.matchAll(/<think>([\s\S]*?)<\/think>/g)].map((m) => m[1]).join('\n');
  text = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  return { text, thinking: thoughts.trim() };
}

// Same idea as the server's check: the end of the text is one phrase repeated over and over.
function looping(text) {
  const tail = text.slice(-1500);
  const m = tail.match(/(.{12,200}?)(?:[\s—–\-,;.:*]*\1){4,}[\s\S]{0,300}$/s);
  return !!m && (m[1].match(/[A-Za-z]/g) || []).length >= 8;
}
