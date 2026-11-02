// On-device AI using WebLLM (WebGPU). The model downloads once and is cached by
// the browser / mobile WebView; after that it runs fully offline on the device.
let engine = null;
let loaded = null;
let webllm = null;

export function webgpuAvailable() { return !!navigator.gpu; }

async function lib() {
  if (!webllm) webllm = await import('https://esm.run/@mlc-ai/web-llm');
  return webllm;
}

export async function ensureModel(model, onProgress = () => {}) {
  if (!webgpuAvailable()) {
    throw new Error('On-device AI needs WebGPU (Chrome/Edge 113+, Safari 18+ or the Tolle mobile app on a recent phone). '
      + 'Choose another AI provider in Settings, or open Tolle in a supported browser.');
  }
  const w = await lib();
  const progress = (r) => onProgress(`Loading ${model}: ${r.text || ''}`);
  if (!engine) {
    engine = await w.CreateMLCEngine(model, { initProgressCallback: progress });
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
  const req = { messages, temperature: 0.6, stream: true };
  if (/qwen3/i.test(model)) req.extra_body = { enable_thinking: !!thinking };
  onProgress(`Writing on this device with ${model}…`);
  const stream = await e.chat.completions.create(req);
  let text = '';
  let n = 0;
  for await (const chunk of stream) {
    text += chunk.choices?.[0]?.delta?.content || '';
    if (++n % 40 === 0) onProgress(`Writing on this device… ${text.length} characters`);
  }
  const thoughts = [...text.matchAll(/<think>([\s\S]*?)<\/think>/g)].map((m) => m[1]).join('\n');
  text = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  return { text, thinking: thoughts.trim() };
}
