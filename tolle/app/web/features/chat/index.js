// Bible chat: talk about life and faith, with wisdom from the Bible.
import { renderHome, renderThread } from './views.js';

export default {
  id: 'chat',
  local: () => import('./local.js'),   // used when the app runs on its own (no server)
  tasks: { chat_reply: 'Bible chat reply' },   // names of this feature's AI tasks on the Tasks screen
  nav: [{ route: 'chat', href: '#/chat', icon: 'chat', label: 'Bible chat', group: null, tab: 'Chat', order: 3 }],
  routes: [
    [/^\/chat$/, 'chat', (view) => renderHome(view)],
    [/^\/chat\/(\d+)$/, 'chat', (view, m) => renderThread(view, +m[1])],
  ],
  tiles: [{ href: '#/chat', icon: 'chat', title: 'Bible chat', text: 'Talk about life, with wisdom from Scripture', ai: true }],
};
