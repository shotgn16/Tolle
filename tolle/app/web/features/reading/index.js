// Bible reader, reading tracker, reminders and YouVersion tracking.
import * as bible from './bible.js';
import * as tracker from './tracker.js';
import { readingSettingsTab } from './settings.js';
import { start } from './background.js';

export default {
  id: 'reading',
  local: () => import('./local.js'),   // used when the app runs on its own (no server)
  nav: [
    { route: 'bible', href: '#/bible', icon: 'bible', label: 'Bible', group: null, tab: 'Bible', order: 1 },
    { route: 'tracker', href: '#/tracker', icon: 'tracker', label: 'Reading tracker', group: null, order: 2 },
  ],
  routes: [
    [/^\/bible$/, 'bible', (view, m, q) => bible.render(view, q)],
    [/^\/tracker$/, 'tracker', (view, m, q) => tracker.render(view, q)],
  ],
  tiles: [{ href: '#/bible', icon: 'bible', title: 'Read the Bible', text: 'Reading time is tracked for you' }],
  dashboard: [{ order: 10, render: tracker.todayWidget }],
  settingsTabs: [{ id: 'reading', label: 'Reading', render: readingSettingsTab }],
  onStart: start,
};
