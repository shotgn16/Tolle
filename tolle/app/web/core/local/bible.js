// Bible books and references – the same rules as server/core/bible.py (tests compare the two).
import SHARED from './shared.js';

export const BOOKS = SHARED.books;
export const BOOK_BY_NAME = Object.fromEntries(BOOKS.map((b) => [b.name, b]));

const ALIASES = {};
for (const b of BOOKS) {
  for (const a of [b.name, b.slug.replace(/-/g, ' '), ...b.abbrs]) ALIASES[a.toLowerCase().replace(/\./g, '')] = b.name;
}
// Two-letter abbreviations ("is", "am", "ex") cause false matches in prose, so only longer ones are used.
const SAFE = Object.keys(ALIASES).filter((a) => a.length >= 3 || ['ps', 'mt', 'mk', 'lk', 'jn', 'rm'].includes(a));
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PATTERN = SAFE.map(esc).sort((a, b) => b.length - a.length).join('|');
const REF_RE = () => new RegExp(
  `\\b(${PATTERN})\\.?\\s+(\\d{1,3})(?:\\s*[:.]\\s*(\\d{1,3})(?:\\s*[-–]\\s*(\\d{1,3}))?)?(?:\\s*[-–]\\s*(\\d{1,3})(?!\\s*[:.]))?`,
  'gi',
);

export function normaliseBook(text) { return ALIASES[(text || '').toLowerCase().replace(/\./g, '').trim()] || null; }

export function parseRefs(text, limit = 40) {
  const found = [];
  const seen = new Set();
  for (const m of (text || '').matchAll(REF_RE())) {
    const book = normaliseBook(m[1]);
    if (!book) continue;
    const chapter = parseInt(m[2], 10);
    if (chapter < 1 || chapter > BOOK_BY_NAME[book].chapters) continue;
    const v1 = m[3] ? parseInt(m[3], 10) : null;
    const v2 = m[4] ? parseInt(m[4], 10) : null;
    const chEnd = m[5] && !v1 ? parseInt(m[5], 10) : null;
    let display = `${book} ${chapter}`;
    if (v1) display += `:${v1}${v2 ? `-${v2}` : ''}`;
    else if (chEnd && chEnd > chapter) display += `-${chEnd}`;
    if (seen.has(display)) continue;
    seen.add(display);
    found.push({ book, slug: BOOK_BY_NAME[book].slug, chapter, verse_start: v1, verse_end: v2, chapter_end: chEnd, display });
    if (found.length >= limit) break;
  }
  return found;
}

// Python's urllib.parse.quote: keeps letters, digits, "_.-~" and "/".
const quote = (s) => encodeURIComponent(s).replace(/%2F/g, '/').replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export function templateVars(ref, translation) {
  return {
    book: ref.book, book_slug: ref.slug, book_q: quote(ref.book), chapter: ref.chapter,
    verse: ref.verse_start || 1, ref: ref.display, ref_q: quote(ref.display), translation,
  };
}

export function fill(template, vars) {
  let missing = false;
  const out = template.replace(/\{(\w+)\}/g, (_, k) => { if (!(k in vars)) missing = true; return String(vars[k]); });
  return missing ? null : out;
}

export function booksPayload() { return BOOKS.map((b) => ({ name: b.name, slug: b.slug, chapters: b.chapters })); }
