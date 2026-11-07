// TEMPLATE – copy this folder to start a new feature (see server/features/_template for the API side).
//
// A feature describes its menu entries, screens (routes), home-screen tiles, dashboard widgets,
// settings tabs and background work. Everything except `id` is optional.
import { get, post, runJob } from '../../core/api.js';
import { errToast, field, h, mount, runWithProgress } from '../../core/ui.js';

async function render(view) {
  const list = h('div', { class: 'list' });
  const draw = async () => {
    const items = await get('api/prayer');
    list.replaceChildren(...items.map((r) => h('div', { class: 'list-item' }, r.text)));
  };
  const input = h('input', { placeholder: 'Add a prayer request' });
  const work = h('div');
  mount(view,
    h('div', { class: 'page-head' }, h('h1', {}, 'Prayer list')),
    h('div', { class: 'card' }, field('New request', input),
      h('button', { class: 'primary', onclick: async () => { await post('api/prayer', { text: input.value }); input.value = ''; draw(); } }, 'Add'),
      h('button', {
        class: 'ai-btn', style: { marginLeft: '8px' },
        onclick: async (e) => {
          try {
            const job = await runWithProgress(work, 'prayer_compose', {}, e.currentTarget);
            work.append(h('div', { class: 'note ai' }, job.result.prayer));
          } catch (err) { errToast(err); }
        },
      }, 'Write a prayer'), work),
    list);
  draw();
}

export default {
  id: '_template',
  nav: [{ route: 'prayer', href: '#/prayer', icon: 'calling', label: 'Prayer list', group: 'Reflect' }],
  routes: [[/^\/prayer$/, 'prayer', (view) => render(view)]],
  tiles: [{ href: '#/prayer', icon: 'calling', title: 'Prayer list', text: 'Keep track of prayer requests', ai: true }],
  // dashboard: [{ order: 30, render: (data) => h('div', {}, '…') }],
  // settingsTabs: [{ id: 'prayer', label: 'Prayer', render: (root) => root.append(h('p', {}, '…')) }],
  // local: () => import('./local.js'),   // lets the feature work in the phone app with no server
  // onStart: () => { const t = setInterval(() => {}, 60000); return () => clearInterval(t); },
};
