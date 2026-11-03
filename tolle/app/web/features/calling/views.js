import { icon } from '../../core/icons.js';
import { del, get, post, waitJob } from '../../core/api.js';
import { aiControls, confirmDialog, errToast, field, fmtDate, fmtDay, h, md, progressBox, toast, mount, sectionTitle, backLink } from '../../core/ui.js';

const STARTERS = [
  'I don’t know where to start',
  'My work or career',
  'Serving in church or ministry',
  'A big decision in front of me',
  'A season of waiting',
  'What my gifts are for',
];

const QUESTIONS = [
  ['now', 'What is going on in your life and walk with God right now?'],
  ['drawn', 'What do you find yourself drawn to, or keep coming back to?'],
  ['burden', 'Is there a need, people group or problem that burdens your heart?'],
  ['affirmed', 'What have other people affirmed or noticed in you?'],
  ['decision', 'Is there a specific decision or question you are bringing to God?'],
];

export async function renderList(view) {
  const sessions = await get('api/calling');
  const focus = h('textarea', { placeholder: 'Optional – what would you like to bring to God today?', style: { minHeight: '80px' } });
  const chips = h('div', { class: 'row', style: { marginTop: '8px' } },
    STARTERS.map((s) => h('button', { class: 'chip', type: 'button', onclick: () => { focus.value = s; } }, s)));
  const form = h('div', { hidden: true }, QUESTIONS.map(([k, q]) => field(q, h('textarea', { 'data-k': k, style: { minHeight: '70px' } }))));
  const toggle = h('button', {
    class: 'small ghost', type: 'button',
    onclick: () => { form.hidden = !form.hidden; toggle.replaceChildren(icon(form.hidden ? 'plus' : 'x', 15), form.hidden ? 'Add a short self-assessment (optional)' : 'Hide self-assessment'); },
  }, icon('plus', 15), 'Add a short self-assessment (optional)');
  const ai = aiControls();
  const work = h('div');
  const go = h('button', {
    class: 'ai-btn',
    onclick: async () => {
      const answers = [...form.querySelectorAll('textarea')].filter((t) => t.value.trim())
        .map((t) => `${QUESTIONS.find(([k]) => k === t.dataset.k)[1]}\n→ ${t.value.trim()}`);
      const opening = [focus.value.trim(), ...answers].filter(Boolean).join('\n\n');
      go.disabled = true;
      const box = progressBox(); work.append(box);
      try {
        const r = await post('api/calling', { focus: opening, ...ai.value() });
        await waitJob(r.job, (m) => box.set(m));
        location.hash = `#/calling/${r.id}`;
      } catch (e) { errToast(e); go.disabled = false; box.remove(); }
    },
  }, icon('calling', 16), 'Begin a guided reflection');

  mount(view, 
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Discerning your calling'),
      h('p', {}, 'A guided time of prayer, Scripture and reflection. The guide assumes nothing about you – it listens to what you share and responds with one question, prayer or passage at a time to help you talk with God and reflect.'))),
    h('div', { class: 'card' },
      field('Where would you like to begin?', h('div', {}, focus, chips)),
      toggle, form,
      h('div', { style: { marginTop: '14px' } }, field('Model', ai)),
      go, work,
      h('p', { class: 'muted', style: { marginTop: '14px', fontSize: '.85rem' } },
        'This is a tool for reflection, not a substitute for prayer, Scripture or wise counsel. Share what you sense with a pastor, mentor or trusted believers.')),
    sectionTitle('Your reflections'),
    sessions.length ? h('div', { class: 'list' }, sessions.map((s) => h('a', { class: 'list-item', href: `#/calling/${s.id}` }, h('span', { class: 'kind-ic' }, icon('calling', 17)),
      h('div', { class: 'grow' }, h('div', { class: 't' }, s.title), h('small', {}, s.focus ? s.focus.split('\n')[0].slice(0, 90) : fmtDay(s.updated_at))))))
      : h('div', { class: 'empty' }, 'No reflections yet.'));
}

export async function renderSession(view, id) {
  const s = await get(`api/calling/${id}`);
  const chat = h('div', { class: 'chat' });
  const work = h('div');
  const ai = aiControls();
  const aiWrap = h('details', { class: 'extra' }, h('summary', {}, 'Model settings'), ai);

  const draw = (messages) => {
    chat.replaceChildren(...messages.map((m) => {
      if (m.role === 'summary') {
        return h('article', { class: 'note ai' },
          h('div', { class: 'note-head' }, h('span', { class: 'badge-ai' }, icon('insights', 13), 'AI'), h('span', { class: 'title' }, 'Reflection summary'), h('small', {}, fmtDate(m.created_at))),
          h('div', { class: 'prose', html: md(m.content) }));
      }
      return h('div', { class: `bubble ${m.role === 'ai' ? 'ai' : 'user'}` },
        m.role === 'ai' ? h('div', { style: { marginBottom: '6px' } }, h('span', { class: 'badge-ai' }, icon('insights', 13), 'AI guide')) : null,
        h('div', { class: 'prose', html: md(m.content) }));
    }));
  };
  draw(s.messages);

  const input = h('textarea', { placeholder: 'Write your response or prayer… (Ctrl+Enter to send)' });
  const send = h('button', { class: 'primary', 'aria-label': 'Send' }, icon('send', 17), 'Send');
  const doSend = async () => {
    const text = input.value.trim();
    if (!text) return;
    send.disabled = true;
    s.messages.push({ role: 'user', content: text, created_at: Date.now() / 1000 });
    draw(s.messages); input.value = '';
    const box = progressBox(); box.set('Listening…'); work.append(box);
    try {
      const r = await post(`api/calling/${id}/message`, { content: text, ...ai.value() });
      await waitJob(r.job, (m) => box.set(m));
      const fresh = await get(`api/calling/${id}`);
      s.messages = fresh.messages; draw(s.messages);
      window.scrollTo(0, document.body.scrollHeight);
    } catch (e) { errToast(e); }
    box.remove(); send.disabled = false; input.focus();
  };
  send.addEventListener('click', doSend);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) doSend(); });

  const summary = h('button', {
    class: 'ai-btn small',
    onclick: async () => {
      summary.disabled = true;
      const box = progressBox(); box.set('Writing a summary of your reflection…'); work.append(box);
      try {
        const r = await post(`api/calling/${id}/summary`, ai.value());
        await waitJob(r.job, (m) => box.set(m));
        const fresh = await get(`api/calling/${id}`);
        s.messages = fresh.messages; draw(s.messages);
        toast('Summary added.');
      } catch (e) { errToast(e); }
      box.remove(); summary.disabled = false;
    },
  }, 'Summarise my reflection');

  mount(view, 
    backLink('#/calling', 'Reflections'),
    h('div', { class: 'page-head', style: { marginTop: '8px' } },
      h('div', {}, h('h1', {}, s.title), s.focus ? h('p', {}, s.focus.split('\n')[0]) : null),
      h('div', { class: 'row' },
        h('button', { class: 'small', onclick: prayPause }, icon('candle', 15), 'Pause to pray'),
        summary,
        h('button', {
          class: 'small ghost danger',
          onclick: async () => { if (await confirmDialog('Delete this reflection?')) { await del(`api/calling/${id}`); location.hash = '#/calling'; } },
        }, 'Delete'))),
    chat, work,
    h('div', { class: 'composer' }, input, send),
    aiWrap);
  window.scrollTo(0, document.body.scrollHeight);
}

function prayPause() {
  let secs = 120;
  const count = h('div', { class: 'big' }, '2:00');
  const ov = h('div', { class: 'pray-overlay' }, h('div', {},
    h('p', {}, 'Be still, and know that I am God. — Psalm 46:10'),
    count,
    h('p', { style: { maxWidth: '40ch', margin: '16px auto' } }, 'Take a few moments in silence. Tell God what is on your heart, then listen. Write down anything you sense.'),
    h('button', { onclick: () => { clearInterval(t); ov.remove(); } }, 'I’m ready to continue')));
  document.body.append(ov);
  const t = setInterval(() => {
    secs -= 1;
    count.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    if (secs <= 0) { clearInterval(t); count.textContent = 'Amen'; }
  }, 1000);
}
