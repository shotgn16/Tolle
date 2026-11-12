// Bible chat screens: a welcome with conversation starters, and the conversation itself.
//
// Replies are AI tasks, so they carry on if you leave the screen or put the app away; coming back to a
// conversation picks up the reply when it's ready (and offers "Ask again" if it never arrived).
import { icon } from '../../core/icons.js';
import { del, get, patch, post, waitJob } from '../../core/api.js';
import { aiControls, backLink, confirmDialog, errToast, fmtDay, h, md, modal, mount, sectionTitle, toast } from '../../core/ui.js';

const FALLBACK_STARTERS = [
  'I’m feeling anxious about the future',
  'How do I forgive someone who hurt me?',
  'I’m struggling to pray',
  'Help me think through a big decision',
];

function composer(onSend, placeholder) {
  const input = h('textarea', { placeholder, rows: 1, 'aria-label': 'Your message' });
  const send = h('button', { class: 'primary send', 'aria-label': 'Send', title: 'Send' }, icon('send', 18));
  const grow = () => { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 200)}px`; };
  const go = async () => {
    const text = input.value.trim();
    if (!text || send.disabled) return;
    send.disabled = true;
    try {
      if ((await onSend(text)) !== false) { input.value = ''; grow(); }
    } finally { send.disabled = false; }
  };
  input.addEventListener('input', grow);
  input.addEventListener('keydown', (e) => {
    // Enter sends on a keyboard; Shift+Enter (or the phone's return key) adds a line.
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && window.matchMedia('(hover: hover)').matches) { e.preventDefault(); go(); }
  });
  send.addEventListener('click', go);
  return { el: h('div', { class: 'composer chat-composer' }, input, send), input, set: (t) => { input.value = t; grow(); input.focus(); } };
}

const typing = () => h('div', { class: 'bubble ai typing', 'aria-label': 'Writing a reply' }, h('span'), h('span'), h('span'));

// ---------------------------------------------------------------- welcome + list
export async function renderHome(view) {
  const [threads, starters] = await Promise.all([get('api/chat'), get('api/chat/starters').catch(() => FALLBACK_STARTERS)]);
  const ai = aiControls();
  const c = composer(async (text) => {
    const r = await post('api/chat', { content: text, ...ai.value() }).catch((e) => { errToast(e); return null; });
    if (!r) return false;
    location.hash = `#/chat/${r.id}`;
    return true;
  }, 'What’s on your heart?');

  mount(view,
    h('div', { class: 'chat-welcome' },
      h('span', { class: 'chat-mark' }, icon('chat', 26)),
      h('h1', {}, 'What’s on your heart?'),
      h('p', {}, 'Talk about anything – life, worries, decisions, faith, a passage you’re reading. Tolle listens and answers with wisdom from the Bible.'),
      h('div', { class: 'starters' }, starters.map((s) => h('button', { class: 'chip', type: 'button', onclick: () => c.set(s) }, s)))),
    c.el,
    h('details', { class: 'extra chat-model' }, h('summary', {}, 'Model'), ai),
    threads.length ? sectionTitle('Your conversations') : null,
    threads.length ? h('div', { class: 'list' }, threads.map((t) => h('a', { class: 'list-item', href: `#/chat/${t.id}` },
      h('span', { class: 'kind-ic' }, icon('chat', 17)),
      h('div', { class: 'grow' }, h('div', { class: 't' }, t.title), h('small', {}, t.last || fmtDay(t.updated_at)))))) : null,
    h('p', { class: 'muted chat-note' },
      'Tolle is an AI, not a pastor or counsellor. For anything serious, talk to someone you trust. If you are in danger or thinking of harming yourself, call 999 (UK) or 112, or Samaritans on 116 123.'));
}

// ---------------------------------------------------------------- a conversation
export async function renderThread(view, id) {
  let t = await get(`api/chat/${id}`);
  const list = h('div', { class: 'chat', 'aria-live': 'polite' });
  const ai = aiControls();
  let waiting = false;
  let alive = true;

  const bubble = (m, last) => h('div', { class: `bubble ${m.role === 'ai' ? 'ai' : 'user'}` },
    h('div', { class: 'prose', html: md(m.content) }),
    m.role === 'ai' ? h('div', { class: 'bubble-tools' },
      h('button', { class: 'icon-btn', title: 'Copy', 'aria-label': 'Copy', onclick: () => navigator.clipboard?.writeText(m.content).then(() => toast('Copied')) }, icon('copy', 15)),
      last ? h('button', { class: 'icon-btn', title: 'Ask again', 'aria-label': 'Ask again', onclick: () => ask(`api/chat/${id}/retry`, {}) }, icon('refresh', 15)) : null) : null);

  const draw = () => {
    const msgs = t.messages;
    const lastAi = msgs.length && msgs[msgs.length - 1].role === 'ai' ? msgs.length - 1 : -1;
    const items = msgs.map((m, i) => bubble(m, i === lastAi && !waiting));
    if (waiting) items.push(typing());
    else if (msgs.length && msgs[msgs.length - 1].role === 'user') {
      items.push(h('div', { class: 'chat-missing' }, 'No reply yet.',
        h('button', { class: 'small', onclick: () => ask(`api/chat/${id}/retry`, {}) }, icon('refresh', 15), 'Ask again')));
    }
    list.replaceChildren(...items);
    requestAnimationFrame(() => window.scrollTo(0, document.body.scrollHeight));
  };

  async function refresh() { t = await get(`api/chat/${id}`); }

  async function ask(path, body) {
    waiting = true; draw();
    try {
      const r = await post(path, { ...body, ...ai.value() });
      await waitJob(r.job);
    } catch (e) { errToast(e); }
    waiting = false;
    if (alive) { await refresh().catch(() => {}); draw(); }
  }

  const c = composer(async (text) => {
    if (waiting) return false;
    t.messages.push({ role: 'user', content: text, created_at: Date.now() / 1000 });
    ask(`api/chat/${id}/message`, { content: text });
    return true;
  }, 'Write a message…');

  // Came back while a reply was being written (e.g. after putting the app away): wait for it.
  const last = t.messages[t.messages.length - 1];
  if (last?.role === 'user') {
    const active = (await get('api/ai/jobs').catch(() => [])).find((j) => j.kind === 'chat_reply' && ['queued', 'running', 'client'].includes(j.status) && j.subject === t.title);
    if (active) {
      waiting = true;
      waitJob(active.id).catch(() => {}).finally(async () => { waiting = false; if (alive) { await refresh().catch(() => {}); draw(); } });
    }
  }

  const title = h('h1', { class: 'chat-title' }, t.title);
  mount(view,
    backLink('#/chat', 'Conversations'),
    h('div', { class: 'page-head chat-head' }, title,
      h('div', { class: 'row' },
        h('button', { class: 'small ghost', onclick: async () => {
          const name = await renamePrompt(t.title);
          if (name) { await patch(`api/chat/${id}`, { title: name }).catch(errToast); t.title = name; title.textContent = name; }
        } }, 'Rename'),
        h('button', { class: 'small ghost danger', onclick: async () => {
          if (await confirmDialog('Delete this conversation?')) { await del(`api/chat/${id}`); location.hash = '#/chat'; }
        } }, 'Delete'))),
    list,
    c.el,
    h('details', { class: 'extra chat-model' }, h('summary', {}, 'Model'), ai));
  draw();
  return () => { alive = false; };
}

async function renamePrompt(current) {
  const input = h('input', { value: current, maxlength: 120 });
  const ok = await modal('Rename conversation', input, [{ label: 'Cancel', value: false }, { label: 'Save', class: 'primary', value: true }]);
  return ok ? input.value.trim() || null : null;
}
