import { icon } from '../../core/icons.js';
import { get } from '../../core/api.js';
import { aiControls, errToast, field, h, levelPicker, runWithProgress, studyListItem, mount, sectionTitle , studyList } from '../../core/ui.js';

const AUDIENCES = [
  ['group', 'users', 'Small group'],
  ['individual', 'user', 'Individual'],
  ['meeting', 'presentation', 'Meeting'],
  ['one_to_one', 'handshake', 'One-to-one'],
  ['youth', 'zap', 'Youth group'],
  ['family', 'house2', 'Family'],
  ['class', 'graduation', 'Bible class'],
];
const FORMATS = ['Let the AI suggest', 'Discussion-based', 'Inductive (Observation · Interpretation · Application)',
  'Lectio Divina', 'Verse-by-verse', 'Topical', 'Story / narrative', 'Interactive with activities', 'Short devotional'];

export async function render(view) {
  const past = await get('api/studies?kind=plan');
  let audience = 'group';
  const audWrap = h('div', { class: 'grid tiles' });
  const drawAud = () => audWrap.replaceChildren(...AUDIENCES.map(([k, ic, label]) => h('button', {
    type: 'button', class: `tile${k === audience ? ' on' : ''}`, 'aria-pressed': String(k === audience),
    onclick: () => { audience = k; drawAud(); otherAud.hidden = true; },
  }, h('span', { class: 'ic' }, icon(ic, 19)), h('strong', {}, label))));
  const otherAud = h('input', { placeholder: 'Describe the audience', hidden: true });

  const title = h('input', { placeholder: 'Optional – a name for this study' });
  const passages = h('input', { placeholder: 'Leave blank for passage ideas' });
  const theme = h('input', { placeholder: 'e.g. hope in suffering, the parables, prayer' });
  const size = h('input', { placeholder: 'e.g. 8 adults' });
  const duration = h('select', {}, ['20', '30', '45', '60', '75', '90', '120'].map((m) => h('option', { value: m, selected: m === '60' }, `${m} minutes`)));
  const sessions = h('input', { type: 'number', min: 1, max: 12, value: 1 });
  const format = h('select', {}, FORMATS.map((f) => h('option', {}, f)));
  const notes = h('textarea', { placeholder: 'Who are they? New believers, mature, mixed ages, any needs or goals…', style: { minHeight: '90px' } });
  const level = levelPicker();
  const ai = aiControls();
  const work = h('div');
  const go = h('button', {
    class: 'ai-btn',
    onclick: async () => {
      try {
        const job = await runWithProgress(work, 'builder', {
          audience: otherAud.hidden ? audience : otherAud.value, title: title.value, passages: passages.value,
          theme: theme.value, size: size.value, duration: duration.value, sessions: sessions.value,
          format: format.value === FORMATS[0] ? '' : format.value, notes: notes.value, level: level.value, ...ai.value(),
        }, go);
        location.hash = `#/study/${job.result.study_id}`;
      } catch (e) { errToast(e); }
    },
  }, icon('insights', 16), 'Build my study');

  mount(view, 
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Study builder'),
      h('p', {}, 'Tell Tolle who the study is for. It will suggest passages, a format with timings, leader notes and Observation / Interpretation / Application questions.'))),
    h('div', { class: 'card' },
      field('Who is it for?', h('div', {}, audWrap,
        h('button', { class: 'small ghost', type: 'button', style: { marginTop: '8px' }, onclick: () => { otherAud.hidden = false; audience = ''; drawAud(); otherAud.focus(); } }, 'Something else…'),
        otherAud)),
      h('div', { class: 'grid two' },
        field('Passage(s)', passages, 'Blank = the AI suggests options.'),
        field('Theme or topic', theme),
        field('Group size', size),
        field('Session length', duration),
        field('Number of sessions', sessions),
        field('Format', format)),
      field('About the people', notes),
      field('Title', title),
      field('Depth', level),
      field('Model', ai),
      go, work),
    sectionTitle('Saved study plans'),
    studyList(past, 'Plans you build are saved here.'));
  drawAud();
}
