// Study sites for the on-device engine (mirrors server/core/sources.py): fetch a page, keep its main
// text, cache it for 30 days, and share a character budget between the pages sent to the AI.
import { BOOK_BY_NAME, fill, templateVars } from './bible.js';
import { request } from './http.js';
import { PARSERS, pick } from './parsers.js';
import { db } from './store.js';

const CACHE_TTL = 30 * 86400 * 1000;
const CACHE_MAX = 300;              // pages kept on the device
const VERSE_LINE = /^(.+?) (\d+):(\d+) (.*)$/;

export function extractHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,noscript,nav,header,footer,aside,form,svg,iframe').forEach((n) => n.remove());
  const main = doc.querySelector('article') || doc.querySelector('main') || doc.getElementById('content') || doc.body || doc.documentElement;
  // Block elements become line breaks, like BeautifulSoup's get_text("\n").
  main.querySelectorAll('p,div,li,h1,h2,h3,h4,h5,h6,br,tr,section,blockquote,dd,dt').forEach((n) => n.append('\n'));
  // Short lines are mostly menu clutter – but keep numbers (Strong's) and Greek/Hebrew words.
  return (main.textContent || '').split('\n').map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 2 || /^\d+$/.test(l) || /[^\x00-\x7F]/.test(l) && /\p{L}/u.test(l)).join('\n');
}

function extractBibleApi(data) {
  if (data && Array.isArray(data.verses)) {
    return data.verses.map((v) => `${v.book_name} ${v.chapter}:${v.verse} ${v.text.split(/\s+/).filter(Boolean).join(' ')}`).join('\n');
  }
  return (data && data.text) || '';
}

export async function fetchPage(url, force = false) {
  const hit = db.all('source_cache', (r) => r.url === url)[0];
  if (hit && !force && Date.now() - hit.fetched_at < CACHE_TTL) return [!!hit.ok, hit.text || ''];
  let ok = false;
  let text = '';
  try {
    const r = await request({ url, timeout: 25000, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Tolle; personal Bible study)' } });
    if (r.status === 200) {
      text = (url.includes('bible-api.com') || typeof r.data === 'object') ? extractBibleApi(r.data) : extractHtml(r.text);
      ok = text.length > 40;
    } else text = `HTTP ${r.status}`;
  } catch (e) { text = e.message; }
  if (hit) db.update('source_cache', hit.id, { fetched_at: Date.now(), ok: ok ? 1 : 0, text });
  else db.insert('source_cache', { url, fetched_at: Date.now(), ok: ok ? 1 : 0, text });
  const all = db.all('source_cache');
  if (all.length > CACHE_MAX) all.sort((a, b) => a.fetched_at - b.fetched_at).slice(0, all.length - CACHE_MAX).forEach((r) => db.remove('source_cache', r.id));
  return [ok, text];
}

export async function chapter(book, chapterNo, translation) {
  const ref = { book, slug: BOOK_BY_NAME[book].slug, chapter: chapterNo, display: `${book} ${chapterNo}`, verse_start: null };
  const url = `https://bible-api.com/${templateVars(ref, translation).ref_q}?translation=${translation}`;
  const [ok, text] = await fetchPage(url);
  const verses = [];
  if (ok) {
    for (const line of text.split('\n')) {
      const m = line.match(VERSE_LINE);
      if (m) verses.push({ verse: parseInt(m[3], 10), text: m[4] });
    }
  }
  return { ok, book, chapter: chapterNo, translation, verses, source: url };
}

/** URL parts for a dictionary look-up of a topic word (e.g. "love" → l/love). Short topics only. */
export function topicVars(topic) {
  const words = (topic || '').toLowerCase().match(/[a-z]+/g) || [];
  if (!words.length || words.length > 2) return null;
  const slug = words.join('-');
  return { topic: words.join(' '), topic_slug: slug, topic_letter: slug[0] };
}

/** Which pages to read: [source, url, label] for every enabled source and reference (or topic). */
export function plan(refs, sources, translation, topics = null) {
  const urls = [];
  const seen = new Set();
  const add = (src, tv, label) => {
    const url = fill(src.url, tv);
    if (url && !seen.has(url)) { seen.add(url); urls.push([src, url, label]); }
  };
  for (const src of sources) {
    if (!src.enabled) continue;
    if (src.scope === 'topic') {
      for (const t of (topics || []).slice(0, 3)) { const tv = topicVars(t); if (tv) add(src, tv, t); }
      continue;
    }
    for (const ref of refs.slice(0, 8)) add(src, templateVars(ref, translation), ref.display);
  }
  return urls;
}

/** Share the character budget between the pages, by each source's weight (in place). */
export function share(results, budget) {
  const good = results.filter((r) => r.ok);
  if (!good.length) return;
  const total = good.reduce((n, r) => n + r.weight, 0);
  for (const r of good) {
    const room = Math.max(1200, Math.floor(budget * r.weight / total));
    if (r.sections?.length) { r.sections = pick(r.sections, room); r.text = ''; } else if (r.text.length > room) r.text = `${r.text.slice(0, room)}\n[…trimmed]`;
  }
}

/** Read every enabled source for the references (and topic words), split big pages into their works, fit the budget. */
export async function gather(refs, sources, translation, budget, progress = () => {}, topics = null) {
  const urls = plan(refs, sources, translation, topics);
  if (!urls.length) return [];
  progress(`Reading ${urls.length} study pages…`);
  let done = 0;
  const read = async ([src, url, label]) => {
    let [ok, text] = await fetchPage(url);
    done += 1;
    progress(`Read ${src.name} for ${label} (${done}/${urls.length})`);
    let sections = [];
    const parser = PARSERS[src.parser || ''];
    if (ok && parser) {
      sections = parser(text);
      if (!sections.length && ['catena', 'interlinear'].includes(src.parser)) ok = false;   // the page didn't have what we came for
    }
    return { name: src.name, kind: src.kind || '', ref: label, url, ok, text: ok ? text : '', sections, weight: parseFloat(src.weight) || 1 };
  };
  // Six at a time, like the server.
  const results = new Array(urls.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(6, urls.length) }, async () => {
    while (next < urls.length) { const i = next; next += 1; results[i] = await read(urls[i]); }
  }));
  share(results, budget);
  return results;
}

/** What a source found, for the Test button in Settings → Sources. */
export function preview(r) {
  if (r.sections?.length) {
    const names = r.sections.slice(0, 12).map((s) => s.label).join(', ');
    const more = r.sections.length > 12 ? ` and ${r.sections.length - 12} more` : '';
    return `${r.sections.length} works used: ${names}${more}\n\n${r.sections[0].text.slice(0, 300)}`;
  }
  return r.text.slice(0, 500);
}

const KIND_ORDER = ['text', 'commentaries', 'commentary', 'historical', 'language', 'pastoral', 'dictionary', 'overview', 'other'];
const kindRank = (k) => (KIND_ORDER.includes(k) ? KIND_ORDER.indexOf(k) : 99);

export function formatForPrompt(results) {
  const good = results.filter((r) => r.ok).map((r, i) => [r, i]).sort((a, b) => kindRank(a[0].kind) - kindRank(b[0].kind) || a[1] - b[1]).map(([r]) => r);
  const blocks = [];
  for (const r of good) {
    const head = `### SOURCE: ${r.name} — ${r.ref}\nURL: ${r.url}`;
    if (r.sections?.length) blocks.push(`${head}\n${r.sections.map((s) => `#### ${s.label} · ${s.group}\n${s.text}`).join('\n\n')}`);
    else if (r.text) blocks.push(`${head}\n${r.text}`);
  }
  return blocks.length ? blocks.join('\n\n') : '(No external sources could be retrieved.)';
}

export const sourceMeta = (results) => results.map((r) => ({ name: r.name, ref: r.ref, url: r.url, ok: r.ok }));
