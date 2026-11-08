import { icon } from '../../core/icons.js';
import { get, post, LS, mode } from '../../core/api.js';
import { h, state, errToast, mount } from '../../core/ui.js';

const TRANSLATIONS = [
  ['web', 'World English Bible'], ['webbe', 'WEB British Edition'], ['kjv', 'King James Version'],
  ['asv', 'American Standard (1901)'], ['bbe', 'Bible in Basic English'], ['ylt', "Young's Literal"],
  ['darby', 'Darby'], ['dra', 'Douay-Rheims'], ['oeb-us', 'Open English Bible (US)'], ['oeb-cw', 'Open English Bible (UK)'],
];

let books = null;

export async function render(view, query) {
  books = books || await get('api/bible/books');
  const saved = JSON.parse(LS.get('tolle.lastChapter') || '{}');
  let book = query.book || saved.book || 'John';
  let chapter = +(query.chapter || saved.chapter || 1);
  let translation = query.t || saved.t || state.settings['bible.translation'] || 'web';

  const bookSel = h('select', { 'aria-label': 'Book' }, books.map((b) => h('option', { value: b.name }, b.name)));
  const chapSel = h('select', { 'aria-label': 'Chapter' });
  const transSel = h('select', { 'aria-label': 'Translation' }, TRANSLATIONS.map(([k, v]) => h('option', { value: k }, v)));
  const text = h('div', { class: 'reader' });
  const timerText = h('span', { class: 'timer' }, '0:00');
  const timer = h('span', { class: 'chip ok', title: 'Reading time for this chapter' }, icon('clock', 13), timerText);
  const askBtn = h('a', { class: 'btn small ai-btn' }, icon('insights', 15), 'Insight on this chapter');
  const studyBtn = h('a', { class: 'btn small' }, icon('research', 15), 'Passage study');

  let readingId = null;
  let seconds = 0;
  let beatTimer = null;
  let tick = null;

  const stopTracking = () => { clearInterval(beatTimer); clearInterval(tick); beatTimer = tick = null; };

  async function startTracking() {
    stopTracking();
    seconds = 0;
    try { readingId = (await post('api/tracker/reading/start', { book, chapter })).id; } catch { readingId = null; }
    tick = setInterval(() => {
      if (document.visibilityState === 'visible') {
        seconds += 1;
        timerText.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
      }
    }, 1000);
    beatTimer = setInterval(async () => {
      if (document.visibilityState !== 'visible' || !readingId) return;
      try { readingId = (await post('api/tracker/reading/beat', { id: readingId })).id; } catch { /* offline */ }
    }, 30000);
  }

  async function load() {
    const b = books.find((x) => x.name === book) || books[42];
    book = b.name;
    chapter = Math.min(Math.max(1, chapter), b.chapters);
    bookSel.value = book; transSel.value = translation;
    chapSel.replaceChildren(...Array.from({ length: b.chapters }, (_, i) => h('option', { value: i + 1, selected: i + 1 === chapter }, i + 1)));
    LS.set('tolle.lastChapter', JSON.stringify({ book, chapter, t: translation }));
    askBtn.href = `#/insights?mode=passage&q=${encodeURIComponent(`${book} ${chapter}`)}`;
    studyBtn.href = `#/research?passages=${encodeURIComponent(`${book} ${chapter}`)}`;
    text.replaceChildren(h('div', { class: 'progress' }, h('div', { class: 'spinner' }), 'Loading…'));
    try {
      const d = await get(`api/bible/chapter?book=${encodeURIComponent(book)}&chapter=${chapter}&translation=${translation}`);
      if (!d.ok || !d.verses.length) {
        text.replaceChildren(h('div', { class: 'empty' }, `Couldn’t load this chapter. ${mode.device() ? 'Check this device is online' : 'Check the server has internet access'} (bible-api.com). Reading time is still being tracked.`));
      } else {
        text.replaceChildren(h('h2', {}, `${book} ${chapter}`),
          h('p', {}, d.verses.map((v) => [h('sup', {}, v.verse), v.text, ' '])),
          h('small', { class: 'muted' }, `${TRANSLATIONS.find(([k]) => k === translation)?.[1] || translation} · via bible-api.com`));
      }
    } catch (e) { errToast(e); }
    startTracking();
  }

  const step = (d) => {
    const i = books.findIndex((x) => x.name === book);
    chapter += d;
    if (chapter < 1 && i > 0) { book = books[i - 1].name; chapter = books[i - 1].chapters; }
    if (chapter > books[i].chapters && i < books.length - 1) { book = books[i + 1].name; chapter = 1; }
    load(); window.scrollTo(0, 0);
  };

  bookSel.addEventListener('change', () => { book = bookSel.value; chapter = 1; load(); });
  chapSel.addEventListener('change', () => { chapter = +chapSel.value; load(); });
  transSel.addEventListener('change', () => { translation = transSel.value; load(); });

  mount(view, 
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Read the Bible'),
      h('p', {}, 'Time spent reading and the chapters you open are logged automatically in your reading tracker.'))),
    h('div', { class: 'reader-bar' }, bookSel, chapSel, transSel, timer, h('span', { class: 'grow' }), studyBtn, askBtn),
    text,
    h('div', { class: 'row', style: { justifyContent: 'space-between', marginTop: '24px', maxWidth: '70ch' } },
      h('button', { onclick: () => step(-1) }, icon('chevronLeft', 16), 'Previous'),
      h('button', { onclick: () => step(1) }, 'Next', icon('chevronRight', 16))));
  await load();
  return stopTracking;
}
