// Study builder: plans for groups, individuals, meetings and more.
import { render } from './view.js';

export default {
  id: 'builder',
  nav: [{ route: 'builder', href: '#/builder', icon: 'builder', label: 'Study builder', group: 'Study' }],
  routes: [[/^\/builder$/, 'builder', (view) => render(view)]],
  tiles: [{ href: '#/builder', icon: 'builder', title: 'Study builder', text: 'Plan a study for a group, a person or a meeting', ai: true }],
};
