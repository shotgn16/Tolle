// Bible reader and reading tracker on the device (mirrors server/features/reading).
// The daily reminder is a native notification scheduled on the phone, so it arrives even when
// Tolle is closed. If you have already read today it is moved on to tomorrow.
import { BOOK_BY_NAME, normaliseBook } from '../../core/local/bible.js';
import * as settings from '../../core/local/settings.js';
import { chapter } from '../../core/local/sources.js';
import { db } from '../../core/local/store.js';

const GAP = 180;       // a heartbeat later than this starts a new session
const MAX_STEP = 90;   // never credit more than this per heartbeat
const REMINDER_ID = 7001;
const now = () => Date.now() / 1000;
const bad = (msg) => Object.assign(new Error(msg), { status: 400 });

// ---------------------------------------------------------------- dates in the user's time zone
function tz() {
  const z = settings.get('tracker.timezone') || 'UTC';
  try { new Intl.DateTimeFormat('en-CA', { timeZone: z }); return z; } catch { return 'UTC'; }
}
const dayKey = (secs, zone) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(secs * 1000));
const hhmm = (secs, zone) => new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(secs * 1000));
const addDays = (key, n) => { const d = new Date(`${key}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const round1 = (x) => Math.round(x * 10) / 10;

// ---------------------------------------------------------------- sessions
function beat(table, id, extra = null) {
  const t = now();
  if (id) {
    const r = db.get(table, id);
    if (r && t - r.last_beat < GAP) {
      db.update(table, r.id, { last_beat: t, seconds: r.seconds + Math.floor(Math.min(MAX_STEP, t - r.last_beat)) });
      return r.id;
    }
    if (r && table === 'reading_sessions') extra = { book: r.book, chapter: r.chapter };
  }
  if (table === 'app_sessions') return db.insert('app_sessions', { device_id: 'this-device', started_at: t, last_beat: t, seconds: 0 });
  if (!extra) throw bad('Missing book/chapter.');
  return db.insert('reading_sessions', { device_id: 'this-device', book: extra.book, chapter: extra.chapter, started_at: t, last_beat: t, seconds: 0, source: 'auto', note: '' });
}

function manualLog(book, chapterNo, minutes, at, note, source = 'manual') {
  book = normaliseBook(book || '') || book;
  if (!BOOK_BY_NAME[book]) throw bad('Unknown book.');
  const start = at || now();
  const secs = Math.max(0, Math.floor(parseFloat(minutes || 0) * 60));
  return db.insert('reading_sessions', { device_id: 'this-device', book, chapter: parseInt(chapterNo, 10) || 1, started_at: start, last_beat: start + secs, seconds: secs, source, note: note || '' });
}

const counts = (r) => r.source !== 'auto' || r.seconds >= 20;   // an "auto" chapter only glanced at doesn't count

export function stats(days = 14) {
  const zone = tz();
  const today = dayKey(now(), zone);
  const startDay = addDays(today, -(days - 1));
  const out = {};
  for (let d = 0; d < days; d += 1) out[addDays(startDay, d)] = { app_minutes: 0, reading_minutes: 0, chapters: [] };
  const since = now() - (days + 1) * 86400;
  for (const r of db.all('app_sessions', (x) => x.started_at >= since)) {
    const k = dayKey(r.started_at, zone);
    if (out[k]) out[k].app_minutes += r.seconds / 60;
  }
  for (const r of db.all('reading_sessions', (x) => x.started_at >= since).sort((a, b) => a.started_at - b.started_at)) {
    if (!counts(r)) continue;
    const k = dayKey(r.started_at, zone);
    if (!out[k]) continue;
    out[k].reading_minutes += r.seconds / 60;
    out[k].chapters.push({
      id: r.id, book: r.book, chapter: r.chapter, label: r.book ? `${r.book} ${r.chapter}` : 'Time in the Bible app',
      time: hhmm(r.started_at, zone), minutes: round1(r.seconds / 60), source: r.source, note: r.note || '',
    });
  }
  for (const d of Object.values(out)) { d.app_minutes = round1(d.app_minutes); d.reading_minutes = round1(d.reading_minutes); }
  const readDays = new Set(db.all('reading_sessions', (x) => x.started_at >= now() - 400 * 86400 && counts(x)).map((x) => dayKey(x.started_at, zone)));
  let streak = 0;
  let day = readDays.has(today) ? today : addDays(today, -1);
  while (readDays.has(day)) { streak += 1; day = addDays(day, -1); }
  return { days: out, today, streak, goal: settings.get('tracker.daily_goal_minutes') };
}

// ---------------------------------------------------------------- daily reminder (native notification)
const LN = () => window.Capacitor?.Plugins?.LocalNotifications;

export async function scheduleReminder() {
  const ln = LN();
  if (!ln) return;
  try {
    await ln.cancel({ notifications: [{ id: REMINDER_ID }] });
    if (!settings.get('tracker.reminder_enabled')) return;
    const [hh, mm] = String(settings.get('tracker.reminder_time') || '20:00').split(':').map((x) => parseInt(x, 10));
    if (Number.isNaN(hh) || Number.isNaN(mm)) return;
    const readToday = stats(1).days[dayKey(now(), tz())]?.chapters.length > 0;
    const at = new Date();
    at.setHours(hh, mm, 0, 0);
    if (readToday || at <= new Date()) at.setDate(at.getDate() + 1);
    await ln.schedule({ notifications: [{
      id: REMINDER_ID, title: 'Time in the Word?',
      body: "You haven't logged any Bible reading today. Open the reader, or tap to log a chapter.",
      schedule: { at, allowWhileIdle: true }, extra: { action: '#/tracker?log=1&r=1' },
    }] });
  } catch (e) { console.warn('Reminder not scheduled', e); }
}

// ---------------------------------------------------------------- endpoints
export function register(engine) {
  const r = engine.route;

  r('GET', 'bible/chapter', ({ query }) => {
    const name = normaliseBook(query.book) || query.book;
    if (!BOOK_BY_NAME[name]) throw bad('Unknown book.');
    return chapter(name, parseInt(query.chapter, 10), query.translation || settings.get('bible.translation'));
  });

  r('POST', 'tracker/app', ({ body }) => ({ id: beat('app_sessions', body.id) }));
  r('POST', 'tracker/reading/start', ({ body }) => {
    const book = normaliseBook(body.book) || body.book;
    if (!BOOK_BY_NAME[book]) throw bad('Unknown book.');
    const id = beat('reading_sessions', null, { book, chapter: parseInt(body.chapter, 10) });
    scheduleReminder();
    return { id };
  });
  r('POST', 'tracker/reading/beat', ({ body }) => ({ id: beat('reading_sessions', body.id) }));
  r('POST', 'tracker/reading/manual', ({ body }) => {
    const id = manualLog(body.book, body.chapter || 1, body.minutes || 0, body.at, body.note || '');
    scheduleReminder();
    return { id };
  });
  r('POST', 'tracker/external', ({ body }) => {
    const app = body.app || 'Bible app';
    const minutes = parseFloat(body.minutes || 0);
    if (body.book && body.chapter) return { logged: manualLog(body.book, body.chapter, minutes, null, `via ${app}`, 'external') };
    db.insert('app_sessions', { device_id: `external:${app}`, started_at: now() - minutes * 60, last_beat: now(), seconds: Math.floor(minutes * 60) });
    engine.notify('What did you read?', `You spent ${Math.round(minutes)} min in ${app}. Tap to log the chapter.`, '#/tracker?log=1');
    return { prompted: true };
  });
  r('GET', 'tracker/stats', ({ query }) => stats(Math.max(1, Math.min(parseInt(query.days, 10) || 14, 120))));
  r('DELETE', 'tracker/reading/:id', ({ params }) => { db.remove('reading_sessions', params.id); scheduleReminder(); return { ok: true }; });
  r('GET', 'tracker/ha-app-sensors', () => ({ sensors: [] }));   // needs Home Assistant (server only)

  engine.onSettings((changed) => {
    if (Object.keys(changed).some((k) => k.startsWith('tracker.'))) scheduleReminder();
  });
  engine.summary(() => ({ tracker: stats(7) }));
  scheduleReminder();
}
