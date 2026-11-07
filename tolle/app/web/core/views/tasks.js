// Tasks: the AI work you've started and how it's going.
//
// AI tasks (passage studies, insights, note analyses…) keep running on the server – or in the app when
// it runs on its own – even if you leave the screen or put the app in the background. This screen
// lists them, and the watcher below keeps a count in the menu and tells you when one finishes.
import { del, get, post, waitJob, watching } from '../api.js';
import { icon } from '../icons.js';
import { activeFeatures } from '../registry.js';
import { errToast, h, mount } from '../ui.js';

const ACTIVE = new Set(['queued', 'running', 'client']);
const STATUS = {
  queued: ['Waiting to start', 'working'],
  running: ['Working', 'working'],
  client: ['Needs this device', 'waiting'],
  done: ['Done', 'done'],
  error: ['Didn’t finish', 'failed'],
};

/** "Passage study", from the feature that owns the task (features list them in index.js → tasks). */
export function taskName(kind) {
  for (const f of activeFeatures()) if (f.tasks?.[kind]) return f.tasks[kind];
  return kind.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

function ago(ts) {
  const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 50) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ts * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

// ---------------------------------------------------------------- the screen
export async function render(view) {
  const list = h('div', { class: 'tasks' });
  const clearBtn = h('button', { class: 'small', hidden: true, onclick: async () => {
    try { await post('api/ai/jobs/clear', {}); refresh(); } catch (e) { errToast(e); }
  } }, 'Clear finished');
  mount(view,
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Tasks'),
      h('p', {}, 'AI work you’ve started. It carries on if you leave this screen or put the app in the background.')), clearBtn),
    list);

  let timer = null;
  let alive = true;
  async function refresh() {
    if (!alive || !view.isConnected) { alive = false; return; }
    let tasks;
    try { tasks = await get('api/ai/jobs'); } catch (e) { list.replaceChildren(h('div', { class: 'empty' }, e.message)); return; }
    const active = tasks.filter((t) => ACTIVE.has(t.status));
    const done = tasks.filter((t) => !ACTIVE.has(t.status));
    clearBtn.hidden = !done.length;
    list.replaceChildren(...(tasks.length ? [
      active.length ? h('h2', { class: 'tasks-head' }, 'In progress') : null,
      ...active.map((t) => row(t, refresh)),
      done.length ? h('h2', { class: 'tasks-head' }, 'Finished') : null,
      ...done.map((t) => row(t, refresh)),
    ].filter(Boolean) : [h('div', { class: 'empty' }, 'No tasks yet. Start a passage study, insight or study plan and it will show here while it works.')]));
    clearTimeout(timer);
    timer = setTimeout(refresh, active.length ? 2000 : 15000);
  }
  await refresh();
  return () => { alive = false; clearTimeout(timer); };
}

function row(t, refresh) {
  const [label, tone] = STATUS[t.status] || [t.status, 'working'];
  const working = tone === 'working';
  const actions = [];
  if (t.status === 'done' && t.link) actions.push(h('a', { class: 'btn small primary', href: t.link }, 'Open'));
  if (t.status === 'client' && !watching.has(t.id)) {
    actions.push(h('button', { class: 'small primary', onclick: async (e) => {
      e.target.disabled = true;
      try { await waitJob(t.id); } catch (err) { errToast(err); }
      refresh();
    } }, 'Continue on this device'));
  }
  if (!ACTIVE.has(t.status)) {
    actions.push(h('button', { class: 'icon-btn', title: 'Remove from the list', 'aria-label': 'Remove from the list', onclick: async () => {
      try { await del(`api/ai/jobs/${t.id}`); refresh(); } catch (e) { errToast(e); }
    } }, icon('x', 16)));
  }
  const detail = t.status === 'error' ? t.error
    : t.status === 'client' ? (watching.has(t.id) ? t.progress : 'The AI model on this device runs while Tolle is open. Tap Continue to finish it.')
      : working ? t.progress : `Finished ${ago(t.updated_at)}`;
  return h('div', { class: `card task task-${tone}` },
    h('div', { class: 'task-icon' }, working || watching.has(t.id) ? h('span', { class: 'spinner' }) : icon(tone === 'done' ? 'check' : tone === 'failed' ? 'alert' : 'clock', 18)),
    h('div', { class: 'task-main' },
      h('div', { class: 'task-title' }, h('strong', {}, taskName(t.kind)), t.subject ? h('span', {}, t.subject) : null),
      h('div', { class: 'task-detail' }, h('span', { class: `task-status ${tone}` }, label), detail ? h('span', {}, detail) : null,
        ACTIVE.has(t.status) ? h('span', { class: 'task-when' }, `started ${ago(t.created_at)}`) : null)),
    actions.length ? h('div', { class: 'task-actions' }, ...actions) : null);
}

// ---------------------------------------------------------------- watcher (count + "finished" message)
let watchTimer = null;
let known = null;   // id -> status from the last look

async function tick() {
  clearTimeout(watchTimer);
  let active = 0;
  try {
    const tasks = await get('api/ai/jobs');
    const prev = known;
    known = new Map(tasks.map((t) => [t.id, t.status]));
    active = tasks.filter((t) => ACTIVE.has(t.status)).length;
    if (prev) {
      for (const t of tasks) {
        const was = prev.get(t.id);
        if (was && ACTIVE.has(was) && !ACTIVE.has(t.status)) announce(t);
        else if (t.status === 'client' && was !== 'client' && !watching.has(t.id)) announce(t);
      }
    }
  } catch { /* offline: try again later */ }
  setBadge(active);
  clearTimeout(watchTimer);
  watchTimer = setTimeout(tick, document.visibilityState === 'visible' ? (active ? 3000 : 20000) : 30000);
}

// Coming back to the app: look straight away, so the count and "ready" messages are fresh.
function onVisible() { if (document.visibilityState === 'visible') tick(); }
function onStarted() { clearTimeout(watchTimer); watchTimer = setTimeout(tick, 300); }

export function startWatcher() {
  stopWatcher();
  known = null;
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('tolle:job-started', onStarted);
  tick();
}

export function stopWatcher() {
  clearTimeout(watchTimer);
  document.removeEventListener('visibilitychange', onVisible);
  window.removeEventListener('tolle:job-started', onStarted);
}

function setBadge(n) {
  document.querySelectorAll('[data-task-count]').forEach((el) => {
    el.textContent = n ? String(n) : '';
    el.hidden = !n;
  });
  const btn = document.getElementById('tasks-btn');
  if (btn) btn.title = n ? `${n} task${n > 1 ? 's' : ''} in progress` : 'Tasks';
}

function announce(t) {
  // The screen that started it shows the result itself; only speak up when you're elsewhere.
  if (watching.has(t.id) || location.hash.startsWith('#/tasks')) return;
  const name = taskName(t.kind);
  const text = t.status === 'done' ? `${name} is ready${t.subject ? `: ${t.subject}` : ''}`
    : t.status === 'client' ? `${name} needs this device to finish`
      : `${name} didn’t finish`;
  const href = t.status === 'done' && t.link ? t.link : '#/tasks';
  const el = h('div', { class: `toast ${t.status === 'error' ? 'error' : 'task-toast'}` },
    h('span', {}, text),
    h('a', { href, class: 'toast-action', onclick: () => el.remove() }, t.status === 'done' && t.link ? 'Open' : 'View'));
  el.addEventListener('click', (e) => { if (e.target === el) el.remove(); });
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), 12000);
}
