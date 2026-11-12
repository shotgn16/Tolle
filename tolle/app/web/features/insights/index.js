// Insights on a passage, a topic or an area of life.
import { render } from './view.js';

export default {
  id: 'insights',
  local: () => import('./local.js'),
  tasks: { insight: 'Insight' },   // names of this feature's AI tasks on the Tasks screen   // used when the app runs on its own (no server)
  nav: [{ route: 'insights', href: '#/insights', icon: 'insights', label: 'Insights', group: 'Study'}],
  routes: [[/^\/insights$/, 'insights', (view, m, q) => render(view, q)]],
  tiles: [{ href: '#/insights', icon: 'insights', title: 'Insights', text: 'A passage, a topic or an area of life', ai: true }],
};
