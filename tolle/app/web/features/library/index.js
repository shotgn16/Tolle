// Study notes: write and upload notes, AI analysis and transcription.
import * as views from './views.js';

export default {
  id: 'library',
  local: () => import('./local.js'),
  tasks: { notes_analyze: 'Notes analysis', transcribe: 'Transcription' },   // names of this feature's AI tasks on the Tasks screen   // used when the app runs on its own (no server)
  nav: [{ route: 'notes', href: '#/notes', icon: 'notes', label: 'Study notes', group: 'Study', tab: 'Notes' }],
  routes: [
    [/^\/notes\/upload$/, 'notes', (view, m, q) => views.renderUpload(view, q)],
    [/^\/notes$/, 'notes', (view) => views.renderList(view)],
    [/^\/study\/(\d+)$/, 'notes', (view, m) => views.renderStudy(view, +m[1])],
  ],
  tiles: [{ href: '#/notes', icon: 'notes', title: 'Study notes', text: 'Write or upload notes and compare them with commentaries' }],
  dashboard: [{ order: 50, render: views.recentWidget }],
};
