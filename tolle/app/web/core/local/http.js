// Network requests for the on-device engine.
//
// In the phone and tablet apps requests go through the native HTTP client (Capacitor's CapacitorHttp),
// so Tolle can read study sites and talk to Ollama or AI services directly – web pages normally can't,
// because of cross-origin rules. In a browser it falls back to fetch().
const nativeHttp = () => (window.Capacitor?.isNativePlatform?.() ? window.Capacitor?.Plugins?.CapacitorHttp : null);

export class HttpError extends Error {
  constructor(status, message, data) { super(message); this.status = status; this.data = data; }
}

/**
 * request({ url, method, headers, json, params, timeout }) -> { status, data, text }
 * `data` is parsed JSON when the answer is JSON, otherwise the text.
 */
export async function request({ url, method = 'GET', headers = {}, json, params, timeout = 60000 }) {
  if (params) {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null)).toString();
    if (qs) url += (url.includes('?') ? '&' : '?') + qs;
  }
  const h = { ...headers };
  if (json !== undefined) h['Content-Type'] = 'application/json';
  const native = nativeHttp();
  if (native) {
    let r;
    try {
      r = await native.request({
        url, method, headers: h, data: json, responseType: 'text',
        connectTimeout: Math.min(timeout, 20000), readTimeout: timeout,
      });
    } catch (e) {
      throw new HttpError(0, `Couldn't connect to ${new URL(url).host}: ${e.message || e}`);
    }
    const text = typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
    return { status: r.status, text, data: parseMaybe(text) };
  }
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { method, headers: h, body: json === undefined ? undefined : JSON.stringify(json), signal: ctl.signal });
    const text = await r.text();
    return { status: r.status, text, data: parseMaybe(text) };
  } catch (e) {
    const why = e.name === 'AbortError' ? 'it took too long to answer' : e.message;
    throw new HttpError(0, `Couldn't connect to ${new URL(url).host}: ${why}`);
  } finally { clearTimeout(t); }
}

function parseMaybe(text) {
  const s = (text || '').trimStart();
  if (s.startsWith('{') || s.startsWith('[')) { try { return JSON.parse(text); } catch { /* not JSON */ } }
  return text;
}
