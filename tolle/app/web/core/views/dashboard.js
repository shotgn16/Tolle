// Home screen: a greeting, each feature's dashboard widgets, and "Start something" tiles.
import { get } from '../api.js';
import { icon } from '../icons.js';
import { activeFeatures } from '../registry.js';
import { h, mount, sectionTitle, state } from '../ui.js';

export async function render(view) {
  const d = await get('api/dashboard');
  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const feats = activeFeatures();
  const widgets = feats.flatMap((f) => f.dashboard || []).sort((a, b) => (a.order || 50) - (b.order || 50));
  const tiles = feats.flatMap((f) => f.tiles || []);
  const [top, ...rest] = widgets.map((w) => w.render(d)).filter(Boolean);

  mount(view,
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, state.me.username ? `${hello}, ${state.me.username}` : hello),
      top?.subtitle ? h('p', {}, top.subtitle) : null)),
    !d.ai?.model ? h('a', { class: 'panel setup-nudge', href: '#/settings' },
      h('span', { class: 'kind-ic' }, icon('insights', 18)),
      h('div', { class: 'grow' }, h('strong', {}, 'Choose an AI model to get started'),
        h('div', { class: 'muted' }, 'Studies, insights and the calling guide need an AI. Pick Ollama, a cloud service or an on-device model.')),
      icon('chevronRight', 18)) : null,
    top?.el || top,
    tiles.length ? sectionTitle('Start something') : null,
    h('div', { class: 'grid tiles' }, tiles.map((t) =>
      h('a', { class: `tile${t.ai ? ' ai' : ''}`, href: t.href }, h('span', { class: 'ic' }, icon(t.icon, 20)),
        h('strong', {}, t.title), h('small', { class: 'muted' }, t.text)))),
    ...rest.map((w) => w?.el || w),
  );
}
