// Studies, notes and uploaded files on the device (mirrors server/core/store.py).
// Passage studies, insights and study plans are saved as studies too, so these helpers are shared.
import { db, loadBlob, removeBlob, saveBlob } from './store.js';

const now = () => Date.now() / 1000;      // seconds, like the server
export const notFound = (what) => Object.assign(new Error(`${what} not found.`), { status: 404 });

export function createStudy(kind, title, meta = {}) {
  const t = now();
  return db.insert('studies', { kind, title, meta, created_at: t, updated_at: t });
}

export function getStudy(id) {
  const s = db.get('studies', id);
  if (!s) throw notFound('Study');
  return s;
}

export const touchStudy = (id) => db.update('studies', id, { updated_at: now() });

export function addEntry(studyId, author, type, title, content, meta = {}) {
  const t = now();
  const id = db.insert('entries', { study_id: Number(studyId), author, type, title, content, meta, created_at: t, updated_at: t });
  touchStudy(studyId);
  return id;
}

export function studyDict(s, withCounts = true) {
  const d = { id: s.id, kind: s.kind, title: s.title || 'Untitled', meta: s.meta || {}, created_at: s.created_at, updated_at: s.updated_at };
  if (withCounts) {
    const entries = db.all('entries', (e) => e.study_id === s.id);
    d.entries = entries.length;
    d.ai_entries = entries.filter((e) => e.author === 'ai').length;
    d.files = db.all('files', (f) => f.study_id === s.id).length;
  }
  return d;
}

export const entryDict = (e) => ({ id: e.id, study_id: e.study_id, author: e.author, type: e.type, title: e.title || '',
  content: e.content || '', meta: e.meta || {}, created_at: e.created_at, updated_at: e.updated_at });

export const fileDict = (f) => ({ id: f.id, study_id: f.study_id, filename: f.filename, mime: f.mime, size: f.size,
  extracted: f.extracted || '', created_at: f.created_at });

export async function saveFile(studyId, filename, mime, bytes, extracted) {
  const blob = `${crypto.randomUUID ? crypto.randomUUID() : Date.now() + Math.random()}.bin`;
  await saveBlob(blob, bytes);
  const id = db.insert('files', { study_id: Number(studyId), filename, mime, size: bytes.length, blob, extracted, created_at: now() });
  touchStudy(studyId);
  return id;
}

export async function loadFile(id) {
  const f = db.get('files', id);
  if (!f) throw notFound('File');
  return [fileDict(f), await loadBlob(f.blob)];
}

export async function deleteFile(id) {
  const f = db.get('files', id);
  if (!f) return;
  await removeBlob(f.blob);
  db.remove('files', id);
}

export async function deleteStudy(id) {
  getStudy(id);
  for (const f of db.all('files', (x) => x.study_id === Number(id))) await deleteFile(f.id);
  db.remove('entries', (e) => e.study_id === Number(id));
  db.remove('studies', id);
}
