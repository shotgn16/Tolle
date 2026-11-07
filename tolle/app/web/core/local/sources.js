// Study sites for the on-device engine (mirrors server/core/sources.py): fetch a page, keep its main
// text, cache it for 30 days, and share a character budget between the pages sent to the AI.
import { BOOK_BY_NAME, fill, templateVars } from './bible.js';
import { request } from './http.js';
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
  return (main.textContent || '').split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l.length > 2).join('\n');
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

export async function gather(refs, sources, translation, budget, progress = () => {}) {
  const urls = [];
  const seen = new Set();
  for (const ref of refs.slice(0, 8)) {
    const tv = templateVars(ref, translation);
    for (const src of sources) {
      if (!src.enabled) continue;
      const url = fill(src.url, tv);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      urls.push([src, url, ref.display]);
    }
  }
  const results = [];
  for (let i = 0; i < urls.length; i += 1) {
    const [src, url, label] = urls[i];
    progress(`Reading ${src.name} for ${label} (${i + 1}/${urls.length})`);
    const [ok, text] = await fetchPage(url);
    results.push({ name: src.name, kind: src.kind || '', ref: label, url, ok, text: ok ? text : '' });
  }
  const good = results.filter((r) => r.ok);
  if (good.length) {
    // Scripture text is short and most important; share the rest fairly.
    const per = Math.max(1500, Math.floor(budget / Math.max(1, good.length)));
    for (const r of good) {
      const limit = r.kind === 'text' ? per * 2 : per;
      if (r.text.length > limit) r.text = `${r.text.slice(0, limit)}\n[…trimmed]`;
    }
  }
  return results;
}

export function formatForPrompt(results) {
  const blocks = results.filter((r) => r.ok).map((r) => `### SOURCE: ${r.name} — ${r.ref}\nURL: ${r.url}\n${r.text}`);
  return blocks.length ? blocks.join('\n\n') : '(No external sources could be retrieved.)';
}

export const sourceMeta = (results) => results.map((r) => ({ name: r.name, ref: r.ref, url: r.url, ok: r.ok }));
