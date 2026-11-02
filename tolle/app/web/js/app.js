import { get, isNative, post, serverUrl, setServerUrl, token, ApiError, LS } from './api.js';
import { h, toast, errToast, loadSettings, state, field } from './ui.js';
import { icon } from './icons.js';
import * as dashboard from './views/dashboard.js';
import * as notes from './views/notes.js';
import * as research from './views/research.js';
import * as insights from './views/insights.js';
import * as builder from './views/builder.js';
import * as calling from './views/calling.js';
import * as tracker from './views/tracker.js';
import * as bible from './views/bible.js';
import * as settingsView from './views/settings.js';

const view = document.getElementById('view');

const NAV = [
  [null, [['dashboard', '#/', 'home', 'Home'], ['bible', '#/bible', 'bible', 'Bible'], ['tracker', '#/tracker', 'tracker', 'Reading tracker']]],
  ['Study', [['notes', '#/notes', 'notes', 'Study notes'], ['research', '#/research', 'research', 'Passage study'],
    ['insights', '#/insights', 'insights', 'Insights'], ['builder', '#/builder', 'builder', 'Study builder']]],
  ['Reflect', [['calling', '#/calling', 'calling', 'Calling']]],
  [null, [['settings', '#/settings', 'settings', 'Settings']]],
];
const TABS = [['dashboard', '#/', 'home', 'Home'], ['bible', '#/bible', 'bible', 'Bible'], ['notes', '#/notes', 'notes', 'Notes'], ['insights', '#/insights', 'insights', 'Insights']];

function buildNav() {
  const nav = document.getElementById('nav');
  nav.replaceChildren(...NAV.flatMap(([group, items]) => [
    group ? h('div', { class: 'nav-group' }, group) : (nav.childElementCount || items[0][0] === 'settings' ? h('div', { style: { height: '10px' } }) : null),
    ...items.map(([key, href, ic, label]) => h('a', { href, 'data-route': key }, icon(ic), label)),
  ].filter(Boolean)));
  const tabbar = document.getElementById('tabbar');
  tabbar.replaceChildren(...TABS.map(([key, href, ic, label]) => h('a', { href, 'data-route': key }, icon(ic, 21), label)),
    h('button', { type: 'button', onclick: (e) => { e.stopPropagation(); openMenu(); } }, icon('more', 21), 'More'));
  document.getElementById('menu-btn').replaceChildren(icon('menu', 22));
}

function openMenu() {
  const sb = document.getElementById('sidebar');
  sb.classList.add('open');
  const scrim = h('div', { class: 'scrim', onclick: closeMenu });
  document.body.append(scrim);
}
function closeMenu() {
  document.getElementById('sidebar').classList.remove('open');
  document.querySelectorAll('.scrim').forEach((x) => x.remove());
}
let cleanup = null;

const routes = [
  [/^\/?$/, 'dashboard', () => dashboard.render(view)],
  [/^\/notes\/upload$/, 'notes', (m, q) => notes.renderUpload(view, q)],
  [/^\/notes$/, 'notes', () => notes.renderList(view)],
  [/^\/study\/(\d+)$/, 'notes', (m) => notes.renderStudy(view, +m[1])],
  [/^\/research$/, 'research', (m, q) => research.render(view, q)],
  [/^\/insights$/, 'insights', (m, q) => insights.render(view, q)],
  [/^\/builder$/, 'builder', () => builder.render(view)],
  [/^\/calling$/, 'calling', () => calling.renderList(view)],
  [/^\/calling\/(\d+)$/, 'calling', (m) => calling.renderSession(view, +m[1])],
  [/^\/tracker$/, 'tracker', (m, q) => tracker.render(view, q)],
  [/^\/bible$/, 'bible', (m, q) => bible.render(view, q)],
  [/^\/settings$/, 'settings', (m, q) => settingsView.render(view, q)],
];

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  return { path, query: Object.fromEntries(new URLSearchParams(qs || '')) };
}

async function route() {
  if (typeof cleanup === 'function') { try { cleanup(); } catch { /* ignore */ } }
  cleanup = null;
  closeMenu();
  const { path, query } = parseHash();
  for (const [re, name, fn] of routes) {
    const m = path.match(re);
    if (m) {
      document.querySelectorAll('#nav a, #tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.route === name));
      view.replaceChildren();
      window.scrollTo(0, 0);
      try { cleanup = await fn(m, query); } catch (e) {
        if (!(e instanceof ApiError && e.status === 401)) {
          view.replaceChildren(h('div', { class: 'card' }, h('h2', {}, 'Something went wrong'), h('p', {}, e.message)));
        }
      }
      return;
    }
  }
  location.hash = '#/';
}

// ---------------------------------------------------------------- shell
function showShell(on) {
  document.getElementById('app').classList.toggle('no-shell', !on);
  document.getElementById('sidebar').hidden = !on;
  document.getElementById('topbar').hidden = !on;
  document.getElementById('tabbar').hidden = !on;
}

function applyTheme(t) {
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}

export function refreshChip() {
  const s = state.settings;
  if (!s) return;
  const model = s['ai.provider'] === 'ondevice' ? s['ondevice.model'] : s['ai.model'];
  const text = `${(state.providers[s['ai.provider']] || '').split(' (')[0]}${model ? ' · ' + model : ''}${s['ai.thinking'] ? ' · thinking' : ''}`;
  const chip = document.getElementById('ai-chip');
  chip.className = 'chip ai';
  chip.textContent = model || 'No AI';
  const name = state.me?.username || '';
  document.getElementById('sidebar-foot').replaceChildren(h('a', { class: 'who', href: '#/settings?tab=account', style: { textDecoration: 'none', color: 'inherit' } },
    h('span', { class: 'avatar' }, name.slice(0, 1).toUpperCase()),
    h('span', {}, h('div', { class: 'name' }, name), h('div', { class: 'model', title: text }, model ? `AI: ${model}` : 'No AI model set'))));
}

// ---------------------------------------------------------------- auth screens
function serverScreen() {
  showShell(false);
  const input = h('input', { type: 'url', placeholder: 'https://homeassistant.local:8099', value: serverUrl() });
  view.replaceChildren(h('div', { class: 'auth-wrap' }, h('div', { class: 'card auth-card' },
    h('div', { class: 'brand' }, h('img', { src: 'icons/icon-192.png', width: 48, height: 48 }), h('div', {}, h('strong', {}, 'Tolle'), h('small', {}, 'Connect to your server'))),
    h('p', {}, 'Enter the address of your Tolle server (Home Assistant add-on port or Docker container).'),
    field('Server address', input, 'Use HTTPS when connecting over the internet.'),
    h('button', {
      class: 'primary', style: { width: '100%' },
      onclick: async () => {
        setServerUrl(input.value.trim());
        try { await get('api/health'); start(); } catch (e) { errToast(e); }
      },
    }, 'Connect'))));
}

async function authScreen() {
  showShell(false);
  let status;
  try { status = await get('api/auth/status'); } catch (e) {
    if (isNative) return serverScreen();
    view.replaceChildren(h('div', { class: 'auth-wrap' }, h('div', { class: 'card' }, e.message)));
    return;
  }
  const setup = status.needs_setup;
  const user = h('input', { autocomplete: 'username', autocapitalize: 'none' });
  const pass = h('input', { type: 'password', autocomplete: setup ? 'new-password' : 'current-password' });
  const pass2 = h('input', { type: 'password', autocomplete: 'new-password' });
  const submit = async (e) => {
    e.preventDefault();
    try {
      if (setup && pass.value !== pass2.value) throw new Error('Passwords do not match.');
      const r = await post(setup ? 'api/auth/setup' : 'api/auth/login', { username: user.value, password: pass.value });
      token.set(r.token);
      start();
    } catch (err) { errToast(err); }
  };
  view.replaceChildren(h('div', { class: 'auth-wrap' }, h('form', { class: 'card auth-card', onsubmit: submit },
    h('div', { class: 'brand' }, h('img', { src: 'icons/icon-192.png', width: 48, height: 48 }),
      h('div', {}, h('strong', {}, 'Tolle'), h('small', { class: 'motto' }, h('em', {}, 'Tolle lege'), ', take up and read'))),
    h('p', { style: { textAlign: 'center', fontWeight: 600, margin: '0 0 18px' } }, setup ? 'Create your account' : 'Sign in'),
    setup ? h('p', {}, 'Welcome! Create the first account. It becomes the administrator. Everything you store is encrypted.') : null,
    field('Username', user), field('Password', pass, setup ? 'At least 8 characters.' : null),
    setup ? field('Confirm password', pass2) : null,
    h('button', { class: 'primary', type: 'submit', style: { width: '100%' } }, setup ? 'Create account' : 'Sign in'),
    isNative ? h('p', { style: { marginTop: '14px', textAlign: 'center' } },
      h('a', { href: '#', onclick: (e) => { e.preventDefault(); serverScreen(); } }, `Server: ${serverUrl()} – change`)) : null)));
  user.focus();
}

// ---------------------------------------------------------------- background loops
let loops = [];
function startLoops() {
  loops.forEach(clearInterval);
  let appSession = null;
  const beat = async () => {
    if (document.visibilityState !== 'visible' || !token.get()) return;
    try { appSession = (await post('api/tracker/app', { id: appSession })).id; } catch { /* offline */ }
  };
  const poll = async () => {
    if (!token.get()) return;
    try {
      for (const n of await get('api/notifications/pending')) showNotification(n);
    } catch { /* offline */ }
  };
  beat(); poll(); syncExternalUsage();
  loops = [setInterval(beat, 60000), setInterval(poll, 45000)];
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { beat(); poll(); syncExternalUsage(); } });
}

// Android app only: time spent in other Bible apps (YouVersion etc.) via the optional BibleUsage plugin.
async function syncExternalUsage() {
  const BU = window.Capacitor?.Plugins?.BibleUsage;
  const apps = state.settings?.['tracker.external_apps'] || [];
  if (!BU || !apps.length) return;
  try {
    if (!(await BU.hasPermission()).granted) return;
    const since = +(LS.get('tolle.usageSince') || Date.now() - 6 * 3600e3);
    const now = Date.now();
    const r = await BU.usage({ packages: apps.map((a) => a.package), since });
    for (const u of r.apps || []) {
      if (u.minutes < 1) continue;
      const name = apps.find((a) => a.package === u.package)?.name || u.package;
      await post('api/tracker/external', { app: name, minutes: Math.round(u.minutes) });
    }
    LS.set('tolle.usageSince', String(now));
  } catch { /* permission revoked or plugin missing */ }
}

async function showNotification(n) {
  const go = () => { window.focus(); if (n.action) location.hash = n.action.replace(/^#/, '#'); };
  const LN = window.Capacitor?.Plugins?.LocalNotifications;
  if (LN) {
    try {
      await LN.schedule({ notifications: [{ id: n.id % 2147483647, title: n.title, body: n.body, extra: { action: n.action } }] });
      return;
    } catch { /* fall through */ }
  }
  if ('Notification' in window && Notification.permission === 'granted') {
    try { const x = new Notification(n.title, { body: n.body, icon: 'icons/icon-192.png' }); x.onclick = go; return; } catch { /* Android Chrome needs SW */ }
  }
  const t = h('div', { class: 'toast', onclick: () => { go(); t.remove(); } }, h('strong', {}, n.title), h('div', {}, n.body));
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), 15000);
}

// ---------------------------------------------------------------- boot
async function start() {
  if (isNative && !serverUrl()) return serverScreen();
  if (!token.get()) return authScreen();
  try {
    state.me = await get('api/me');
    await loadSettings(true);
  } catch (e) {
    if (e.status === 401) return authScreen();
    if (isNative) return serverScreen();
    view.replaceChildren(h('div', { class: 'card' }, e.message));
    return;
  }
  applyTheme(state.settings['ui.theme']);
  // keep the reminder timezone in step with the device
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (tz && state.settings['tracker.timezone'] !== tz && state.settings['tracker.timezone_auto']) {
    import('./api.js').then(({ put }) => put('api/settings', { 'tracker.timezone': tz })).catch(() => {});
    state.settings['tracker.timezone'] = tz;
  }
  showShell(true);
  refreshChip();
  startLoops();
  route();
}

window.addEventListener('hashchange', () => { if (token.get()) route(); });
window.addEventListener('tolle:logout', () => { loops.forEach(clearInterval); authScreen(); });
window.addEventListener('tolle:settings', () => { applyTheme(state.settings['ui.theme']); refreshChip(); });
document.getElementById('menu-btn').addEventListener('click', openMenu);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
buildNav();

// Capacitor: tapping a native notification opens its action
window.Capacitor?.Plugins?.LocalNotifications?.addListener?.('localNotificationActionPerformed', (ev) => {
  const a = ev?.notification?.extra?.action; if (a) location.hash = a;
});

start().catch((e) => toast(e.message, 'error'));
