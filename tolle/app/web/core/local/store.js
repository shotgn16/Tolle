// Encrypted storage for Tolle when it runs on this device only.
//
// Data is kept as "collections" (studies, entries, settings…) of records with numeric ids, the same
// shape as the server's tables. Each collection is saved as one file, and each uploaded file as its
// own file. Everything is encrypted with AES-GCM (256-bit) before it is written.
//
//   In the phone/tablet apps: files in the app's private folder (Capacitor Filesystem), key in the
//   app's private preferences. Both are also protected by the phone's own encryption.
//   In a browser (development, testing): IndexedDB.
const ENC = new TextEncoder();
const DEC = new TextDecoder();

const FS = () => window.Capacitor?.Plugins?.Filesystem;
const PREFS = () => window.Capacitor?.Plugins?.Preferences;
const NATIVE = () => !!(window.Capacitor?.isNativePlatform?.() && FS() && PREFS());

// ---------------------------------------------------------------- byte helpers
export function toB64(bytes) {
  let s = '';
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromB64(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i);
  return out;
}

// ---------------------------------------------------------------- where bytes are kept
const idb = {
  db: null,
  async open() {
    if (this.db) return this.db;
    this.db = await new Promise((resolve, reject) => {
      const r = indexedDB.open('tolle-device', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('blobs');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    return this.db;
  },
  async op(mode, fn) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('blobs', mode);
      const req = fn(tx.objectStore('blobs'));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
    });
  },
  read(name) { return this.op('readonly', (s) => s.get(name)).then((v) => (v ? new Uint8Array(v) : null)); },
  write(name, bytes) { return this.op('readwrite', (s) => s.put(bytes, name)); },
  remove(name) { return this.op('readwrite', (s) => s.delete(name)); },
};

const nativeFiles = {
  dir: 'DATA',
  path: (name) => `tolle/${name}`,
  async read(name) {
    try {
      const r = await FS().readFile({ path: this.path(name), directory: this.dir });
      return fromB64(r.data);
    } catch { return null; }
  },
  async write(name, bytes) {
    await FS().writeFile({ path: this.path(name), directory: this.dir, data: toB64(bytes), recursive: true });
  },
  async remove(name) {
    try { await FS().deleteFile({ path: this.path(name), directory: this.dir }); } catch { /* already gone */ }
  },
};

const backend = () => (NATIVE() ? nativeFiles : idb);

// ---------------------------------------------------------------- encryption
let key = null;

async function loadKey() {
  if (key) return key;
  let raw = null;
  if (NATIVE()) {
    const { value } = await PREFS().get({ key: 'tolle.device.key' });
    if (value) raw = fromB64(value);
  } else {
    raw = await idb.read('__key__');
  }
  if (!raw) {
    raw = crypto.getRandomValues(new Uint8Array(32));
    if (NATIVE()) await PREFS().set({ key: 'tolle.device.key', value: toB64(raw) });
    else await idb.write('__key__', raw);
  }
  key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  return key;
}

async function seal(bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await loadKey(), bytes));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv); out.set(ct, 12);
  return out;
}

async function open(bytes) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) },
    await loadKey(), bytes.subarray(12)));
}

// ---------------------------------------------------------------- collections
const cols = new Map();       // name -> { next, rows: Map(id -> record) }
const dirty = new Set();
let timer = null;

export async function init(names) {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Tolle can only run on its own from a secure page (the phone and tablet apps, or https). Connect to a Tolle server instead.');
  }
  await loadKey();
  await Promise.all(names.map(async (name) => {
    const bytes = await backend().read(`${name}.json`);
    let data = { next: 1, rows: [] };
    if (bytes) {
      try { data = JSON.parse(DEC.decode(await open(bytes))); } catch (e) {
        // Keep the unreadable copy rather than overwrite it with an empty one.
        console.error(`Tolle: couldn't read ${name}`, e);
        await backend().write(`${name}.unreadable-${Date.now()}.json`, bytes).catch(() => {});
      }
    }
    cols.set(name, { next: data.next || 1, rows: new Map(data.rows.map((r) => [r.id, r])) });
  }));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  window.addEventListener('pagehide', () => flush());
}

function col(name) {
  if (!cols.has(name)) cols.set(name, { next: 1, rows: new Map() });
  return cols.get(name);
}

function changed(name) {
  dirty.add(name);
  clearTimeout(timer);
  timer = setTimeout(flush, 300);
}

export async function flush() {
  clearTimeout(timer);
  const names = [...dirty];
  dirty.clear();
  await Promise.all(names.map(async (name) => {
    const c = col(name);
    const json = JSON.stringify({ next: c.next, rows: [...c.rows.values()] });
    await backend().write(`${name}.json`, await seal(ENC.encode(json)));
  }));
}

export const db = {
  all(name, filter = () => true) { return [...col(name).rows.values()].filter(filter); },
  get(name, id) { return col(name).rows.get(Number(id)) || null; },
  insert(name, record) {
    const c = col(name);
    const row = { ...record, id: c.next };
    c.next += 1;
    c.rows.set(row.id, row);
    changed(name);
    return row.id;
  },
  update(name, id, fields) {
    const row = col(name).rows.get(Number(id));
    if (!row) return null;
    Object.assign(row, fields);
    changed(name);
    return row;
  },
  remove(name, idOrFilter) {
    const c = col(name);
    if (typeof idOrFilter === 'function') {
      for (const [id, r] of c.rows) if (idOrFilter(r)) c.rows.delete(id);
    } else c.rows.delete(Number(idOrFilter));
    changed(name);
  },
  // A single record holding settings-like values (id 1).
  doc(name) { return col(name).rows.get(1)?.value || {}; },
  setDoc(name, value) {
    const c = col(name);
    c.rows.set(1, { id: 1, value });
    c.next = Math.max(c.next, 2);
    changed(name);
  },
};

// ---------------------------------------------------------------- uploaded files
export async function saveBlob(name, bytes) { await backend().write(`files/${name}`, await seal(bytes)); }
export async function loadBlob(name) {
  const b = await backend().read(`files/${name}`);
  return b ? open(b) : null;
}
export async function removeBlob(name) { await backend().remove(`files/${name}`); }

export const isNativeStorage = NATIVE;

// ---------------------------------------------------------------- backup (see engine: device/export, device/import)
/** Everything on this device as plain data: { collections: {name: {next, rows}}, blobs: {name: base64} }. */
export async function exportAll() {
  await flush();
  const collections = {};
  for (const [name, c] of cols) collections[name] = { next: c.next, rows: [...c.rows.values()] };
  const blobs = {};
  for (const f of collections.files?.rows || []) {
    if (!f.blob) continue;
    const bytes = await loadBlob(f.blob);
    if (bytes) blobs[f.blob] = toB64(bytes);
  }
  return { collections, blobs };
}

/** Replace everything on this device with a backup made by exportAll(). */
export async function importAll(data) {
  for (const f of col('files').rows.values()) if (f.blob) await removeBlob(f.blob).catch(() => {});
  for (const [name, blob] of Object.entries(data.blobs || {})) await saveBlob(name, fromB64(blob));
  for (const name of new Set([...cols.keys(), ...Object.keys(data.collections || {})])) {
    const c = data.collections[name] || { next: 1, rows: [] };
    cols.set(name, { next: c.next || 1, rows: new Map((c.rows || []).map((r) => [r.id, r])) });
    dirty.add(name);
  }
  await flush();
}
