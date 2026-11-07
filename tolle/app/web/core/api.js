// API client. Works behind Home Assistant Ingress (relative URLs), on a plain
// port, and inside the Capacitor mobile app (absolute server URL).
import { runOnDevice } from './ondevice.js';

export const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform())
  || location.protocol === 'capacitor:' || location.protocol === 'file:';

export const LS = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } },
};

// "device": the app runs on its own – everything is stored and answered on this phone/tablet
// (core/local/engine.js). "server": the app talks to a Tolle server. Only the mobile apps offer
// device mode; it can also be switched on in a browser for testing (localStorage tolle.mode=device).
export const mode = {
  get: () => LS.get('tolle.mode') || (isNative && serverUrl() ? 'server' : isNative ? null : 'server'),
  set: (m) => LS.set('tolle.mode', m),
  device: () => mode.get() === 'device',
};

let engine = null;
async function deviceEngine() {
  if (!engine) {
    engine = (async () => {
      const [eng, { default: features }] = await Promise.all([import('./local/engine.js'), import('../features/index.js')]);
      await eng.start(features);
      return eng;
    })();
  }
  return engine;
}

export function serverUrl() { return (LS.get('tolle.server') || '').replace(/\/+$/, ''); }
export function setServerUrl(u) { LS.set('tolle.server', u ? u.replace(/\/+$/, '') : null); }

function base() { return isNative ? serverUrl() + '/' : ''; }
export function url(path) { return base() + path.replace(/^\//, ''); }

function randomId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export function deviceId() {
  let id = LS.get('tolle.device');
  if (!id) { id = randomId(); LS.set('tolle.device', id); }
  return id;
}

export function deviceName() {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android'
    : /Mac OS/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Device';
  const br = isNative ? 'Tolle app' : /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome'
    : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${br} on ${os}`;
}

export const token = { get: () => LS.get('tolle.token'), set: (t) => LS.set('tolle.token', t) };
/** True when the app can talk to its data: signed in to a server, or running on its own. */
export const signedIn = () => mode.device() || !!token.get();

export class ApiError extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}

export async function api(method, path, body, opts = {}) {
  if (mode.device()) {
    const eng = await deviceEngine();
    try {
      return await eng.handle(method, path, body);
    } catch (e) {
      throw new ApiError(e.status || 500, e.message || String(e));
    }
  }
  const headers = { 'X-Device-Id': deviceId(), 'X-Device-Name': deviceName() };
  const t = token.get();
  if (t) headers.Authorization = `Bearer ${t}`;
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  let res;
  try {
    res = await fetch(url(path), { method, headers, body: payload });
  } catch (e) {
    throw new ApiError(0, isNative && !serverUrl() ? 'No server set.' : 'Could not reach the Tolle server.');
  }
  if (res.status === 401 && !opts.noAuthRedirect) {
    token.set(null);
    window.dispatchEvent(new Event('tolle:logout'));
  }
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) {
    let msg = data && data.detail ? data.detail : (typeof data === 'string' ? data : `HTTP ${res.status}`);
    if (Array.isArray(msg)) msg = msg.map((m) => m.msg).join('; ');
    throw new ApiError(res.status, msg);
  }
  return data;
}

export const get = (p) => api('GET', p);
export const post = (p, b = {}) => api('POST', p, b);
export const put = (p, b) => api('PUT', p, b);
export const patch = (p, b) => api('PATCH', p, b);
export const del = (p) => api('DELETE', p);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pollEvery = () => (mode.device() ? 400 : 1500);

// Start an AI job and wait for it. Handles on-device jobs transparently.
export async function runJob(kind, params, onProgress = () => {}) {
  const { id } = await post('api/ai/jobs', { kind, ...params });
  return waitJob(id, onProgress);
}

export async function waitJob(id, onProgress = () => {}) {
  let last = '';
  for (;;) {
    const job = await get(`api/ai/jobs/${id}`);
    if (job.progress && job.progress !== last) { last = job.progress; onProgress(job.progress); }
    if (job.status === 'done') return job;
    if (job.status === 'error') throw new ApiError(500, job.error || 'The AI job failed.');
    if (job.status === 'client') {
      try {
        const out = await runOnDevice(job.client, onProgress);
        return await post(`api/ai/jobs/${id}/complete`, out);
      } catch (e) {
        await post(`api/ai/jobs/${id}/fail`, { error: String(e.message || e) }).catch(() => {});
        throw e;
      }
    }
    await sleep(pollEvery());
  }
}

/** Hand a file to the person: the share sheet in the phone apps (Save to Files, Drive, Mail…), a download elsewhere. */
export async function saveOrShare(filename, blob, { open = false } = {}) {
  const P = window.Capacitor?.Plugins;
  if (isNative && P?.Filesystem && P?.Share) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const safe = filename.replace(/[\\/:*?"<>|]+/g, '_') || 'file';
    const { uri } = await P.Filesystem.writeFile({ path: safe, data: btoa(bin), directory: 'CACHE' });
    await P.Share.share({ title: safe, files: [uri] });
    return;
  }
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href; a.rel = 'noopener';
  if (open && /^(image|application\/pdf|text)/.test(blob.type)) a.target = '_blank'; else a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 60000);
}

// Download an encrypted upload with the auth header (never put tokens in URLs).
export async function openFile(fid, filename) {
  let blob;
  if (mode.device()) blob = await get(`api/files/${fid}`);
  else {
    const res = await fetch(url(`api/files/${fid}`), {
      headers: { Authorization: `Bearer ${token.get()}`, 'X-Device-Id': deviceId() },
    });
    if (!res.ok) throw new ApiError(res.status, 'Could not open file.');
    blob = await res.blob();
  }
  await saveOrShare(filename, blob, { open: true });
}
