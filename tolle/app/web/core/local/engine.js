// The on-device engine: Tolle without a server.
//
// When the phone/tablet app is set to "This device only", every request the screens make (api/…)
// is answered here instead of by a server. The screens don't know the difference.
//
// Layout (mirrors the server):
//   core/local/engine.js     this file – routing, and the core endpoints (settings, AI, jobs, Bible…)
//   core/local/*.js          storage, encryption, AI providers, study sites, file reading
//   features/<id>/local.js   each feature's own endpoints and AI jobs, loaded automatically
//
// A feature's local.js exports  register(engine)  and uses:
//   engine.route(method, 'path/:id', handler)   handler({ params, query, body }) -> data
//   engine.jobs({ kind: [prepare, finish] })
//   engine.summary(() => ({ … }))                 numbers for the home screen
//   engine.notify(title, body, action)            show a notification on this device
//   engine.onSettings((changed) => …)             run after settings are saved
import SHARED from './shared.js';
import { AIError, listModels, ONDEVICE_MODELS, PROVIDERS } from './ai.js';
import { booksPayload, parseRefs } from './bible.js';
import * as jobs from './jobs.js';
import * as settings from './settings.js';
import { gather } from './sources.js';
import { exportAll, flush, fromB64, importAll, init as initStore, toB64 } from './store.js';

const routes = [];
const summaries = [];
const settingHooks = [];
const pending = [];     // notifications waiting for the app to show them
let nextNote = 1;
let ready = null;

export class ApiError extends Error {
  constructor(status, detail) { super(detail); this.status = status; }
}

function compile(pattern) {
  const names = [];
  const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, n) => { names.push(n); return '([^/]+)'; })}$`);
  return { re, names };
}

const engine = {
  route(method, pattern, handler, feature = null) {
    routes.push({ method, ...compile(pattern), handler, feature });
  },
  jobs(kinds, feature = null) { jobs.register(kinds, feature); },
  summary(fn, feature = null) { summaries.push({ fn, feature }); },
  onSettings(fn) { settingHooks.push(fn); },
  notify(title, body, action = '') { pending.push({ id: nextNote++, title, body, action }); },
};

const withLocal = new Set();   // features that can run on this device (they have a local.js)
const enabled = (id) => withLocal.has(id) && !settings.disabledFeatures().includes(id);

// ---------------------------------------------------------------- core endpoints
function coreRoutes() {
  const r = (m, p, h) => engine.route(m, p, h);
  r('GET', 'health', () => ({ ok: true, version: SHARED.version, mode: 'device' }));
  r('GET', 'auth/status', () => ({ needs_setup: false, app: 'Tolle', version: SHARED.version, addon: false, mode: 'device' }));
  r('GET', 'me', () => ({ id: 1, username: settings.get('device.name') || '', is_admin: true, device_id: 'this-device' }));
  r('POST', 'auth/logout', () => ({ ok: true }));
  r('GET', 'features', () => SHARED.features.map((f) => ({ ...f, enabled: enabled(f.id) })));
  r('PUT', 'admin/features', ({ body }) => { settings.setDisabledFeatures(body.disabled || []); return SHARED.features.map((f) => ({ ...f, enabled: enabled(f.id) })); });
  r('GET', 'admin/instructions', () => settings.instructionListing());
  r('PUT', 'admin/instructions', ({ body }) => { settings.saveInstructions(body); return settings.instructionListing(); });

  r('GET', 'settings', () => ({ values: settings.publicValues(), levels: settings.LEVELS, providers: PROVIDERS,
    default_sources: SHARED.default_sources, addon: false, mode: 'device', ocr: { tesseract: false, pdf_render: true } }));
  r('PUT', 'settings', ({ body }) => {
    settings.setMany(body);
    for (const fn of settingHooks) Promise.resolve().then(() => fn(body)).catch(console.error);
    return { values: settings.publicValues() };
  });

  r('GET', 'ai/models', async ({ query }) => {
    const cfg = settings.all();
    const provider = query.provider || cfg['ai.provider'];
    try { return { provider, models: await listModels(cfg, provider) }; } catch (e) {
      throw new ApiError(502, e instanceof AIError ? e.message : `Couldn't reach ${PROVIDERS[provider] || provider}: ${e.message}`);
    }
  });
  r('GET', 'ai/ondevice-models', () => ONDEVICE_MODELS);
  r('POST', 'ai/jobs', ({ body }) => { const { kind, ...rest } = body; return { id: jobs.create(kind, rest, enabled) }; });
  r('GET', 'ai/jobs/:id', ({ params }) => jobs.get(params.id));
  r('POST', 'ai/jobs/:id/complete', ({ params, body }) => jobs.completeClient(params.id, body.text, body.thinking));
  r('POST', 'ai/jobs/:id/fail', ({ params, body }) => { jobs.failClient(params.id, body.error || 'On-device model failed'); return { ok: true }; });

  r('GET', 'bible/books', () => booksPayload());
  r('GET', 'bible/parse', ({ query }) => parseRefs(query.text || ''));
  r('POST', 'sources/test', async ({ body }) => {
    const refs = parseRefs(body.ref || 'John 3:16');
    if (!refs.length) throw new ApiError(400, 'Enter a valid reference.');
    const res = await gather(refs.slice(0, 1), [{ ...body.source, enabled: true }], settings.get('bible.translation'), 4000);
    return res.map((x) => ({ url: x.url, ok: x.ok, preview: x.text.slice(0, 500) }));
  });

  // Backups: everything on the device, encrypted with a password the user chooses.
  r('POST', 'device/export', async ({ body }) => ({ data: await packBackup(await exportAll(), body.password) }));
  r('POST', 'device/import', async ({ body }) => { await importAll(await unpackBackup(body.data, body.password)); return { ok: true }; });

  // Things that only exist with a server: nothing to show on a single device.
  r('GET', 'devices', () => []);
  r('GET', 'notifications/pending', () => pending.splice(0));
  r('GET', 'server/pairing', () => ({ mode: 'device', addresses: [] }));

  r('GET', 'dashboard', async () => {
    const out = {};
    for (const s of summaries) if (!s.feature || enabled(s.feature)) Object.assign(out, await s.fn());
    const cfg = settings.all();
    out.ai = { provider: cfg['ai.provider'], model: cfg['ai.provider'] === 'ondevice' ? cfg['ondevice.model'] : cfg['ai.model'], thinking: cfg['ai.thinking'] };
    return out;
  });
}

// ---------------------------------------------------------------- backup files
const BACKUP_KIND = 'tolle-device-backup';
async function backupKey(password, salt) {
  if ((password || '').length < 8) throw new ApiError(400, 'Choose a backup password of at least 8 characters.');
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 310000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function packBackup(data, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(data));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await backupKey(password, salt), plain));
  return JSON.stringify({ kind: BACKUP_KIND, version: 1, app: SHARED.version, created: new Date().toISOString(), kdf: 'PBKDF2-SHA256-310000', salt: toB64(salt), iv: toB64(iv), data: toB64(ct) });
}
async function unpackBackup(text, password) {
  let f;
  try { f = JSON.parse(text); } catch { throw new ApiError(400, 'That file isn’t a Tolle backup.'); }
  if (f.kind !== BACKUP_KIND) throw new ApiError(400, 'That file isn’t a Tolle backup.');
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(f.iv) }, await backupKey(password, fromB64(f.salt)), fromB64(f.data));
    return JSON.parse(new TextDecoder().decode(plain));
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(400, 'Wrong password, or the backup file is damaged.');
  }
}

// ---------------------------------------------------------------- start-up
const COLLECTIONS = ['settings', 'instructions', 'features', 'studies', 'entries', 'files', 'source_cache',
  'calling_sessions', 'calling_messages', 'reading_sessions', 'app_sessions'];

export function start(featureDefs) {
  if (!ready) {
    ready = (async () => {
      await initStore(COLLECTIONS);
      coreRoutes();
      for (const f of featureDefs) {
        if (!f.local) continue;
        withLocal.add(f.id);
        const mod = await f.local();
        mod.register({
          route: (m, p, h) => engine.route(m, p, h, f.id),
          jobs: (k) => engine.jobs(k, f.id),
          summary: (fn) => engine.summary(fn, f.id),
          notify: engine.notify,
          onSettings: engine.onSettings,
        });
      }
    })();
  }
  return ready;
}

/** Answer one request: handle('GET', 'api/studies?kind=notes', body) -> data (or throws ApiError). */
export async function handle(method, path, body) {
  await ready;
  const [raw, qs = ''] = path.replace(/^\/?api\//, '').split('?');
  const query = Object.fromEntries(new URLSearchParams(qs));
  for (const rt of routes) {
    if (rt.method !== method) continue;
    const m = raw.match(rt.re);
    if (!m) continue;
    if (rt.feature && !enabled(rt.feature)) throw new ApiError(404, 'This part of Tolle is switched off.');
    const params = Object.fromEntries(rt.names.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
    try {
      return await rt.handler({ params, query, body: body ?? {} });
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError(e.status || (e instanceof AIError ? 502 : 500), e.message || String(e));
    }
  }
  throw new ApiError(404, `Not available on this device: ${method} ${raw}`);
}

export { flush };
