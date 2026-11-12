// Bible chat on the device (mirrors server/features/chat).
import SHARED from '../../core/local/shared.js';
import * as J from '../../core/local/jobs.js';
import * as settings from '../../core/local/settings.js';
import { db } from '../../core/local/store.js';

const HISTORY_CHARS = 24000;
const now = () => Date.now() / 1000;
const bad = (status, msg) => Object.assign(new Error(msg), { status });

export function chatSystem(perspective = '') {
  const tradition = perspective ? `\n- They describe their tradition as: ${perspective}. Use language that fits it.` : '';
  return `${settings.text('chat.guide').trim()}${tradition}\n`;
}

export function titleFor(first) {
  const t = first.split(/\s+/).filter(Boolean).join(' ');
  if (t.length <= 60) return t;
  const cut = t.slice(0, 57);
  return `${cut.includes(' ') ? cut.slice(0, cut.lastIndexOf(' ')) : cut}…`;
}

/** The most recent part of the conversation that fits the budget, starting with something the person said. */
export function historyFor(messages, budget = HISTORY_CHARS) {
  const out = [];
  let used = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    used += messages[i].content.length;
    if (out.length && used > budget) break;
    out.unshift(messages[i]);
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

function thread(id) {
  const t = db.get('chat_threads', Number(id));
  if (!t) throw bad(404, 'Conversation not found.');
  return t;
}

function add(tid, role, content) {
  const id = db.insert('chat_messages', { thread_id: Number(tid), role, content, created_at: now() });
  db.update('chat_threads', Number(tid), { updated_at: now() });
  return id;
}

const messagesOf = (tid) => db.all('chat_messages', (m) => m.thread_id === Number(tid)).sort((a, b) => a.id - b.id);
const reply = (tid, body) => J.create('chat_reply', { thread_id: Number(tid), ...J.aiOverrides(body || {}) }, () => true);

export function register(engine) {
  const r = engine.route;

  r('GET', 'chat', () => db.all('chat_threads').sort((a, b) => b.updated_at - a.updated_at).map((t) => {
    const msgs = messagesOf(t.id);
    return { id: t.id, title: t.title, created_at: t.created_at, updated_at: t.updated_at, last: (msgs[msgs.length - 1]?.content || '').slice(0, 140) };
  }));
  r('GET', 'chat/starters', () => SHARED.chat_starters);

  r('POST', 'chat', ({ body }) => {
    const text = (body.content || '').trim();
    if (!text) throw bad(400, 'Write something first.');
    const t = now();
    const id = db.insert('chat_threads', { title: titleFor(text), created_at: t, updated_at: t });
    add(id, 'user', text);
    return { id, job: reply(id, body) };
  });

  r('GET', 'chat/:id', ({ params }) => {
    const t = thread(params.id);
    return { id: t.id, title: t.title, messages: messagesOf(t.id).map(({ id, role, content, created_at }) => ({ id, role, content, created_at })) };
  });

  r('POST', 'chat/:id/message', ({ params, body }) => {
    thread(params.id);
    const text = (body.content || '').trim();
    if (!text) throw bad(400, 'Write something first.');
    add(params.id, 'user', text);
    return { job: reply(params.id, body) };
  });

  r('POST', 'chat/:id/retry', ({ params, body }) => {
    thread(params.id);
    const msgs = messagesOf(params.id);
    const last = msgs[msgs.length - 1];
    if (last?.role === 'ai') db.remove('chat_messages', last.id);
    return { job: reply(params.id, body) };
  });

  r('PATCH', 'chat/:id', ({ params, body }) => {
    thread(params.id);
    const title = (body.title || '').trim();
    if (title) db.update('chat_threads', Number(params.id), { title: title.slice(0, 120) });
    return { ok: true };
  });

  r('DELETE', 'chat/:id', ({ params }) => {
    const id = Number(params.id);
    db.remove('chat_messages', (m) => m.thread_id === id);
    db.remove('chat_threads', id);
    return { ok: true };
  });

  engine.jobs({
    chat_reply: [
      async ({ params, cfg }) => {
        thread(params.thread_id);
        const msgs = messagesOf(params.thread_id).map((m) => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.content || '' }));
        const budget = Math.min(HISTORY_CHARS, parseInt(cfg['ai.context_chars'], 10) || HISTORY_CHARS);
        return { messages: [{ role: 'system', content: chatSystem(cfg['study.perspective'] || '') }, ...historyFor(msgs, budget)], meta: {} };
      },
      async ({ params, text }) => ({ thread_id: Number(params.thread_id), message_id: add(params.thread_id, 'ai', text) }),
    ],
  });
}
