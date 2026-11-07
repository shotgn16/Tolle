// Calling on the device (mirrors server/features/calling).
import SHARED from '../../core/local/shared.js';
import { AIError } from '../../core/local/ai.js';
import * as J from '../../core/local/jobs.js';
import * as settings from '../../core/local/settings.js';
import { db } from '../../core/local/store.js';

const now = () => Date.now() / 1000;

export function callingSystem(perspective = '') {
  const tradition = perspective ? `\n- Their tradition: ${perspective}. Use language that fits it.` : '';
  return `${settings.text('calling.guide')}${tradition}\n`;
}

export function callingOpening(focus) {
  let base = SHARED.text.calling_opening;
  if (focus) {
    base += "\n\nThey shared this to begin with (respond to it gently – don't analyse it all at once; pick the "
      + `thread that seems most alive):\n<SHARED>\n${focus}\n</SHARED>`;
  }
  return base;
}

function session(id) {
  const s = db.get('calling_sessions', id);
  if (!s) throw Object.assign(new Error('Session not found.'), { status: 404 });
  return s;
}

function history(id) {
  const s = session(id);
  const msgs = db.all('calling_messages', (m) => m.session_id === s.id && m.role !== 'summary').sort((a, b) => a.id - b.id);
  return [s, msgs.map((m) => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.content || '' }))];
}

function dateTitle() {
  const d = new Date();
  return `Reflection ${String(d.getDate()).padStart(2, '0')} ${d.toLocaleString('en-GB', { month: 'short' })} ${d.getFullYear()}`;
}

export function register(engine) {
  const r = engine.route;

  r('GET', 'calling', () => db.all('calling_sessions').sort((a, b) => b.updated_at - a.updated_at)
    .map(({ id, title, focus, status, created_at, updated_at }) => ({ id, title, focus, status, created_at, updated_at })));

  r('POST', 'calling', ({ body }) => {
    const t = now();
    const id = db.insert('calling_sessions', { title: body.title || dateTitle(), focus: body.focus || '', status: 'open', created_at: t, updated_at: t });
    return { id, job: J.create('calling_turn', { session_id: id, ...J.aiOverrides(body) }, () => true) };
  });

  r('GET', 'calling/:id', ({ params }) => {
    const s = session(params.id);
    const messages = db.all('calling_messages', (m) => m.session_id === s.id).sort((a, b) => a.id - b.id)
      .map(({ id, role, content, created_at }) => ({ id, role, content, created_at }));
    return { id: s.id, title: s.title, focus: s.focus, status: s.status, messages };
  });

  r('POST', 'calling/:id/message', ({ params, body }) => {
    const s = session(params.id);
    const text = (body.content || '').trim();
    if (!text) throw Object.assign(new Error('Write something first.'), { status: 400 });
    db.insert('calling_messages', { session_id: s.id, role: 'user', content: text, created_at: now() });
    return { job: J.create('calling_turn', { session_id: s.id, ...J.aiOverrides(body) }, () => true) };
  });

  r('POST', 'calling/:id/summary', ({ params, body }) => ({ job: J.create('calling_summary', { session_id: Number(params.id), ...J.aiOverrides(body || {}) }, () => true) }));

  r('DELETE', 'calling/:id', ({ params }) => {
    const id = Number(params.id);
    db.remove('calling_messages', (m) => m.session_id === id);
    db.remove('calling_sessions', id);
    return { ok: true };
  });

  engine.jobs({
    calling_turn: [
      async ({ params, cfg }) => {
        const [s, hist] = history(params.session_id);
        const messages = [{ role: 'system', content: callingSystem(cfg['study.perspective'] || '') }];
        if (!hist.length) messages.push({ role: 'user', content: callingOpening(s.focus || '') });
        else {
          messages.push(...hist.slice(-40));
          if (messages[1].role === 'assistant') messages.splice(1, 0, { role: 'user', content: '(Session start)' });
        }
        return { messages, meta: {} };
      },
      async ({ params, text }) => {
        const sid = Number(params.session_id);
        const mid = db.insert('calling_messages', { session_id: sid, role: 'ai', content: text, created_at: now() });
        db.update('calling_sessions', sid, { updated_at: now() });
        return { session_id: sid, message_id: mid };
      },
    ],
    calling_summary: [
      async ({ params, cfg }) => {
        const [, hist] = history(params.session_id);
        if (hist.length < 2) throw new AIError('Talk a little more before asking for a summary.');
        const convo = hist.map((m) => `${m.role === 'assistant' ? 'GUIDE' : 'ME'}: ${m.content}`).join('\n\n');
        return {
          messages: [
            { role: 'system', content: callingSystem(cfg['study.perspective'] || '') },
            { role: 'user', content: `${SHARED.text.calling_summary}\n\n<CONVERSATION>\n${convo.slice(-30000)}\n</CONVERSATION>` },
          ],
          meta: {},
        };
      },
      async ({ params, text }) => {
        const sid = Number(params.session_id);
        return { session_id: sid, message_id: db.insert('calling_messages', { session_id: sid, role: 'summary', content: text, created_at: now() }) };
      },
    ],
  });
}
