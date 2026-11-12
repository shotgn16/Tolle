// Calling: guided prayer and reflection.
import { renderList, renderSession } from './views.js';

export default {
  id: 'calling',
  local: () => import('./local.js'),
  tasks: { calling_turn: 'Calling reflection', calling_summary: 'Calling summary' },   // names of this feature's AI tasks on the Tasks screen
  nav: [{ route: 'calling', href: '#/calling', icon: 'calling', label: 'Calling', group: 'Reflect' }],
  routes: [
    [/^\/calling$/, 'calling', (view) => renderList(view)],
    [/^\/calling\/(\d+)$/, 'calling', (view, m) => renderSession(view, +m[1])],
  ],
  tiles: [{ href: '#/calling', icon: 'calling', title: 'Calling', text: 'Guided prayer and reflection', ai: true }],
};
