import { get } from '../api.js';
import { icon } from '../icons.js';
import { h, mount, sectionTitle, state, studyList } from '../ui.js';

const TILES = [
  ['#/notes', 'notes', 'Study notes', 'Write or upload notes and compare them with commentaries', false],
  ['#/research', 'research', 'Passage study', 'Research passages in light of a word or topic', true],
  ['#/insights', 'insights', 'Insights', 'A passage, a topic or an area of life', true],
  ['#/builder', 'builder', 'Study builder', 'Plan a study for a group, a person or a meeting', true],
  ['#/calling', 'calling', 'Calling', 'Guided prayer and reflection', true],
  ['#/bible', 'bible', 'Read the Bible', 'Reading time is tracked for you', false],
];

export async function render(view) {
  const d = await get('api/dashboard');
  const t = d.tracker.days[d.tracker.today];
  const goal = d.tracker.goal || 15;
  const pct = Math.min(100, Math.round((t.reading_minutes / goal) * 100));
  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const left = Math.max(0, Math.round(goal - t.reading_minutes));

  mount(view,
    h('div', { class: 'page-head' }, h('div', {},
      h('h1', {}, `${hello}, ${state.me.username}`),
      h('p', {}, left ? `${left} minute${left === 1 ? '' : 's'} to reach today's reading goal.` : 'You reached today’s reading goal.'))),
    h('div', { class: 'today' },
      h('a', { class: 'panel', href: '#/tracker', style: { textDecoration: 'none', color: 'inherit' } },
        h('div', { class: 'ring', style: { '--p': pct } }, h('div', {}, `${pct}%`)),
        h('div', { class: 'grow' },
          h('div', { class: 'stat' }, `${Math.round(t.reading_minutes)} min`),
          h('small', {}, `read today, goal ${goal} min`),
          h('div', { class: 'row', style: { marginTop: '8px', gap: '6px' } },
            h('span', { class: 'chip ok' }, icon('flame', 13), `${d.tracker.streak}-day streak`),
            h('span', { class: 'chip' }, `${t.chapters.filter((c) => c.book).length} chapter${t.chapters.filter((c) => c.book).length === 1 ? '' : 's'}`)))),
      h('div', { class: 'panel verse' },
        h('div', {}, 'They received the word with all readiness of mind, and searched the scriptures daily, whether those things were so.',
          h('cite', {}, 'Acts 17:11')))),
    sectionTitle('Start something'),
    h('div', { class: 'grid tiles' }, TILES.map(([href, ic, title, sub, ai]) =>
      h('a', { class: `tile${ai ? ' ai' : ''}`, href }, h('span', { class: 'ic' }, icon(ic, 20)), h('strong', {}, title), h('small', { class: 'muted' }, sub)))),
    sectionTitle('Recent', h('a', { href: '#/notes', style: { fontSize: '.9rem', fontWeight: 600 } }, 'All notes')),
    studyList(d.recent, 'Nothing here yet. Write a note or start a passage study.'),
    !d.ai.model ? h('p', { class: 'muted', style: { marginTop: '18px' } }, 'No AI model chosen yet. ', h('a', { href: '#/settings' }, 'Choose one in Settings')) : null,
  );
}
