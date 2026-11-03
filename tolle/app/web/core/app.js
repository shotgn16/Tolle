// App shell: sign-in, navigation, routing and background polling.
// Screens come from the features in web/features/ – see features/index.js.
import { get, isNative, post, serverUrl, setServerUrl, token, ApiError } from './api.js';
import { BRAND } from './brand.js';
import { icon } from './icons.js';
import { activeFeatures, setEnabled } from './registry.js';
import { h, toast, errToast, loadSettings, state, field } from './ui.js';
import * as dashboard from './views/dashboard.js';
import * as settingsView from './views/settings.js';

const view = document.getElementById('view');
let cleanup = null;
let routes = [];

// ---------------------------------------------------------------- navigation
function navItems() {
  const items = [{ route: 'dashboard', href: '#/', icon: 'home', label: 'Home', group: null, order: 0, tab: 'Home' }];
  activeFeatures().forEach((f, i) => (f.nav || []).forEach((n, j) => items.push({ order: 10 + i * 10 + j, ...n })));
  items.push({ route: 'settings', href: '#/settings', icon: 'settings', label: 'Settings', group: '', order: 999 });
  return items.sort((a, b) => a.order - b.order);
}

function buildNav() {
  const items = navItems();
  const groups = [];
  for (const it of items) {
    const key = it.group ?? null;
    let g = groups.find((x) => x.key === key);
    if (!g) groups.push((g = { key, items: [] }));
    g.items.push(it);
  }
  // ungrouped first, then named groups, then Settings
  groups.sort((a, b) => (a.key === null ? -1 : b.key === null ? 1 : a.key === '' ? 1 : b.key === '' ? -1 : 0));
  document.getElementById('nav').replaceChildren(...groups.flatMap((g) => [
    g.key ? h('div', { class: 'nav-group' }, g.key) : g.key === '' ? h('div', { style: { height: '10px' } }) : null,
    ...g.items.map((it) => h('a', { href: it.href, 'data-route': it.route }, icon(it.icon), it.label)),
  ].filter(Boolean)));
  const tabs = items.filter((it) => it.tab).slice(0, 4);
  document.getElementById('tabbar').replaceChildren(
    ...tabs.map((it) => h('a', { href: it.href, 'data-route': it.route }, icon(it.icon, 21), it.tab)),
    h('button', { type: 'button', onclick: (e) => { e.stopPropagation(); openMenu(); } }, icon('more', 21), 'More'));
  document.getElementById('menu-btn').replaceChildren(icon('menu', 22));
  document.querySelectorAll('[data-brand-name]').forEach((el) => { el.textContent = BRAND.name; });

  routes = [
    [/^\/?$/, 'dashboard', (v) => dashboard.render(v)],
    ...activeFeatures().flatMap((f) => f.routes || []),
    [/^\/settings$/, 'settings', (v, m, q) => settingsView.render(v, q)],
  ];
}

function openMenu() {
  document.getElementById('sidebar').classList.add('open');
  document.body.append(h('div', { class: 'scrim', onclick: closeMenu }));
}
function closeMenu() {
  document.getElementById('sidebar').classList.remove('open');
  document.querySelectorAll('.scrim').forEach((x) => x.remove());
}

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
      try { cleanup = await fn(view, m, query); } catch (e) {
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
  const input = h('input', { type: 'url', placeholder: 'http://192.168.1.20:8099', value: serverUrl(), autocapitalize: 'none' });
  view.replaceChildren(h('div', { class: 'auth-wrap' }, h('div', { class: 'card auth-card' },
    h('div', { class: 'brand' }, h('img', { src: 'icons/icon-192.png', width: 48, height: 48 }), h('div', {}, h('strong', {}, BRAND.name), h('small', {}, 'Connect to your server'))),
    h('p', {}, `Enter the address of your ${BRAND.name} server, or scan the code shown on your computer with your phone's camera.`),
    field('Server address', input, 'Use HTTPS when connecting over the internet.'),
    h('button', {
      class: 'primary', style: { width: '100%' },
      onclick: async () => {
        let v = input.value.trim();
        if (v && !/^https?:\/\//i.test(v)) v = `http://${v}`;
        setServerUrl(v);
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
      h('div', {}, h('strong', {}, BRAND.name), h('small', { class: 'motto', title: BRAND.mottoTitle }, h('em', {}, BRAND.mottoLead), BRAND.mottoRest))),
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
let featureStops = [];
function startLoops() {
  loops.forEach(clearInterval);
  featureStops.forEach((stop) => stop && stop());
  const poll = async () => {
    if (!token.get()) return;
    try {
      for (const n of await get('api/notifications/pending')) showNotification(n);
    } catch { /* offline */ }
  };
  poll();
  loops = [setInterval(poll, 45000)];
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') poll(); });
  featureStops = activeFeatures().map((f) => (f.onStart ? f.onStart() : null));
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
  try { setEnabled((await get('api/features')).filter((f) => f.enabled !== false).map((f) => f.id)); } catch { /* older server: show all */ }
  buildNav();
  showShell(true);
  refreshChip();
  startLoops();
  route();
}

window.addEventListener('hashchange', () => { if (token.get()) route(); });
window.addEventListener('tolle:logout', () => { loops.forEach(clearInterval); featureStops.forEach((s) => s && s()); authScreen(); });
window.addEventListener('tolle:settings', () => { applyTheme(state.settings['ui.theme']); refreshChip(); });
document.getElementById('menu-btn').addEventListener('click', openMenu);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
buildNav();

// Phone pairing: scanning the code on the computer opens tolle://connect?server=<address>
function handlePairingLink(link) {
  try {
    const u = new URL(link);
    const server = u.searchParams.get('server');
    if (u.protocol !== 'tolle:' || !server || !/^https?:\/\//.test(server)) return;
    if (server.replace(/\/+$/, '') === serverUrl()) return;
    setServerUrl(server); token.set(null); start(); toast(`Connected to ${server}. Sign in to continue.`);
  } catch { /* not a pairing link */ }
}
window.Capacitor?.Plugins?.App?.addListener?.('appUrlOpen', (ev) => handlePairingLink(ev.url));
window.Capacitor?.Plugins?.App?.getLaunchUrl?.().then((r) => r?.url && handlePairingLink(r.url)).catch(() => {});

// Capacitor: tapping a native notification opens its action
window.Capacitor?.Plugins?.LocalNotifications?.addListener?.('localNotificationActionPerformed', (ev) => {
  const a = ev?.notification?.extra?.action; if (a) location.hash = a;
});

start().catch((e) => toast(e.message, 'error'));
