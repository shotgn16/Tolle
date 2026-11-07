// Insights on a passage, a topic or an area of life.
import { render } from './view.js';

export default {
  id: 'insights',
  local: () => import('./local.js'),   // used when the app runs on its own (no server)
  nav: [{ route: 'insights', href: '#/insights', icon: 'insights', label: 'Insights', group: 'Study', tab: 'Insights' }],
  routes: [[/^\/insights$/, 'insights', (view, m, q) => render(view, q)]],
  tiles: [{ href: '#/insights', icon: 'insights', title: 'Insights', text: 'A passage, a topic or an area of life', ai: true }],
};
