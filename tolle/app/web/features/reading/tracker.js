import { icon } from '../../core/icons.js';
import { del, get, post, LS } from '../../core/api.js';
import { confirmDialog, errToast, field, h, modal, toast, mount, sectionTitle } from '../../core/ui.js';

export async function render(view, query) {
  const days = 14;
  const st = await get(`api/tracker/stats?days=${days}`);
  const books = await get('api/bible/books');
  const today = st.days[st.today];
  const entries = Object.entries(st.days);
  const max = Math.max(st.goal || 15, ...entries.map(([, d]) => Math.max(d.reading_minutes, d.app_minutes)));

  const bars = h('div', { class: 'bars', role: 'img', 'aria-label': 'Minutes per day for the last 14 days' },
    entries.map(([day, d]) => {
      const r = (d.reading_minutes / max) * 100;
      const a = (Math.max(0, d.app_minutes - d.reading_minutes) / max) * 100;
      return h('div', { class: `bar${day === st.today ? ' today' : ''}`, title: `${day}: ${d.reading_minutes} min reading, ${d.app_minutes} min in app` },
        h('div', { class: 'stack', style: { height: `${Math.max(1, (r + a) * 0.85)}%` } },
          h('div', { class: 'r', style: { height: `${(r / Math.max(1, r + a)) * 100}%` } }),
          h('div', { class: 'a', style: { flex: 1 } })),
        h('small', { class: 'muted' }, new Date(day + 'T12:00').toLocaleDateString(undefined, { weekday: 'narrow' })));
    }));

  const history = entries.slice().reverse().filter(([, d]) => d.chapters.length);

  mount(view, 
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Reading tracker'),
        h('p', {}, 'How long you spend in the Word each day, which chapters you open and when. Reading in Tolle is logged automatically; log anything you read elsewhere by hand.')),
      h('button', { class: 'primary', onclick: () => logDialog(books, () => { view.replaceChildren(); render(view, {}); }) }, icon('plus', 16), 'Log reading')),
    h('div', { class: 'stats' },
      h('div', { class: 'stat-card' }, h('div', { class: 'label' }, 'Today'), h('div', { class: 'stat' }, `${Math.round(today.reading_minutes)} min`),
        h('small', {}, `reading, ${Math.round(today.app_minutes)} min in the app, goal ${st.goal} min`)),
      h('div', { class: 'stat-card' }, h('div', { class: 'label' }, 'Streak'), h('div', { class: 'stat' }, `${st.streak} day${st.streak === 1 ? '' : 's'}`),
        h('small', {}, 'consecutive days with Bible reading'))),
    h('div', { class: 'card', style: { marginTop: '16px' } },
      h('h3', {}, 'Last 14 days'),
      h('div', { class: 'legend', style: { margin: '4px 0 0' } }, h('span', {}, h('span', { class: 'swatch', style: { background: 'var(--brand)' } }), 'Bible reading'),
        h('span', {}, h('span', { class: 'swatch', style: { background: 'var(--line-strong)' } }), 'Other time in the app')),
      bars),
    sectionTitle('Chapters read'),
    history.length ? h('div', {}, history.map(([day, d]) => h('div', { class: 'card' },
      h('div', { class: 'row' }, h('strong', { class: 'grow' }, new Date(day + 'T12:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })),
        h('small', {}, `${Math.round(d.reading_minutes)} min`)),
      h('table', { class: 'simple', style: { marginTop: '8px' } }, d.chapters.map((c) => h('tr', {},
        h('td', { style: { width: '70px' } }, c.time),
        h('td', {}, c.book ? h('a', { href: `#/bible?book=${encodeURIComponent(c.book)}&chapter=${c.chapter}` }, c.label) : h('span', {}, c.label),
          c.note ? h('small', { class: 'muted' }, ` · ${c.note}`) : null),
        h('td', {}, `${c.minutes} min`),
        h('td', {}, h('span', { class: 'chip' }, { auto: 'Tolle reader', manual: 'logged', shared: 'shared', external: 'other app', 'bible-app': 'Bible app' }[c.source] || c.source)),
        h('td', { style: { textAlign: 'right' } }, h('button', {
          class: 'small ghost danger',
          onclick: async () => { if (await confirmDialog(`Remove “${c.label}” at ${c.time}?`, 'Remove')) { await del(`api/tracker/reading/${c.id}`); view.replaceChildren(); render(view, {}); } },
        }, icon('trash', 15))))))))) : h('div', { class: 'empty' }, 'No reading logged in the last two weeks.'),
  );

  if (query.log) logDialog(books, () => { location.hash = '#/tracker'; });
}

function logDialog(books, done) {
  const last = JSON.parse(LS.get('tolle.lastChapter') || '{}');
  const book = h('select', {}, books.map((b) => h('option', { value: b.name, selected: b.name === (last.book || 'John') }, b.name)));
  const chapter = h('input', { type: 'number', min: 1, value: last.chapter || 1 });
  const minutes = h('input', { type: 'number', min: 0, step: 1, value: 10 });
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const when = h('input', { type: 'datetime-local', value: local });
  const note = h('input', { placeholder: 'Optional – e.g. read in YouVersion, church reading' });
  modal('Log Bible reading', h('div', {},
    h('div', { class: 'grid two' }, field('Book', book), field('Chapter', chapter), field('Minutes', minutes), field('When', when)),
    field('Note', note)), [
    { label: 'Cancel' },
    {
      label: 'Log it', class: 'primary',
      onclick: async () => {
        try {
          await post('api/tracker/reading/manual', {
            book: book.value, chapter: +chapter.value, minutes: +minutes.value,
            at: new Date(when.value).getTime() / 1000, note: note.value,
          });
          toast(`Logged ${book.value} ${chapter.value}`);
          done();
        } catch (e) { errToast(e); return false; }
      },
    },
  ]);
}


// Dashboard widget: today's reading against the goal.
export function todayWidget(d) {
  if (!d.tracker) return null;
  const t = d.tracker.days[d.tracker.today];
  const goal = d.tracker.goal || 15;
  const pct = Math.min(100, Math.round((t.reading_minutes / goal) * 100));
  const left = Math.max(0, Math.round(goal - t.reading_minutes));
  const chapters = t.chapters.filter((c) => c.book).length;
  return {
    subtitle: left ? `${left} minute${left === 1 ? '' : 's'} to reach today's reading goal.` : 'You reached today’s reading goal.',
    el: h('div', { class: 'today' },
      h('a', { class: 'panel', href: '#/tracker', style: { textDecoration: 'none', color: 'inherit' } },
        h('div', { class: 'ring', style: { '--p': pct } }, h('div', {}, `${pct}%`)),
        h('div', { class: 'grow' },
          h('div', { class: 'stat' }, `${Math.round(t.reading_minutes)} min`),
          h('small', {}, `read today, goal ${goal} min`),
          h('div', { class: 'row', style: { marginTop: '8px', gap: '6px' } },
            h('span', { class: 'chip ok' }, icon('flame', 13), `${d.tracker.streak}-day streak`),
            h('span', { class: 'chip' }, `${chapters} chapter${chapters === 1 ? '' : 's'}`)))),
      h('div', { class: 'panel verse' },
        h('div', {}, 'Your word is a lamp to my feet and a light to my path.', h('cite', {}, 'Psalm 119:105')))),
  };
}
