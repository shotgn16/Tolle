// Passage study: research passages in light of a word, sentence or topic.
import { render } from './view.js';

export default {
  id: 'research',
  nav: [{ route: 'research', href: '#/research', icon: 'research', label: 'Passage study', group: 'Study' }],
  routes: [[/^\/research$/, 'research', (view, m, q) => render(view, q)]],
  tiles: [{ href: '#/research', icon: 'research', title: 'Passage study', text: 'Research passages in light of a word or topic', ai: true }],
};
