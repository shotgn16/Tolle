import { icon } from '../icons.js';
import { get } from '../api.js';
import { aiControls, errToast, field, h, levelPicker, runWithProgress, studyListItem, toast, mount, sectionTitle , studyList } from '../ui.js';

const PURPOSES = [
  ['', 'General study'], ['personal', 'Personal study'], ['homegroup', 'Home group'], ['preaching', 'Preaching'],
  ['teaching', 'Teaching'], ['youth', 'Youth & children'], ['word', 'Word & theme study'], ['discipleship', 'One-to-one'],
];

const LEVEL_HELP = {
  intro: 'Plain language, key ideas and a few reflection questions.',
  study: 'Context, structure, key words, cross references and discussion questions.',
  preach: 'Big idea, teaching outline, illustration ideas and applications.',
  deep: 'Full exegesis: setting, original languages, interpretive views and theology.',
};

export async function render(view, query) {
  const past = await get('api/studies?kind=passage');
  const passages = h('input', { placeholder: 'e.g. John 15:1-17; Galatians 5:16-26', value: query.passages || '' });
  const chips = h('div', { class: 'row', style: { marginTop: '6px' } });
  const focus = h('input', { placeholder: 'e.g. abide · “bear much fruit” · the Holy Spirit', value: query.focus || '' });
  const help = h('div', { class: 'hint' });
  const purpose = h('select', {}, PURPOSES.map(([k, l]) => h('option', { value: k, selected: k === (query.purpose || '') }, l)));
  const keep = h('input', { placeholder: 'e.g. 8 people, 45 minutes, some new to the Bible' });
  const level = levelPicker();
  const showHelp = () => { help.textContent = LEVEL_HELP[level.value]; };
  level.addEventListener('click', showHelp);
  const ai = aiControls();
  const work = h('div');

  let timer;
  passages.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const refs = passages.value.trim() ? await get(`api/bible/parse?text=${encodeURIComponent(passages.value)}`) : [];
      chips.replaceChildren(...refs.map((r) => h('span', { class: 'chip ok' }, icon('check', 13), r.display)),
        passages.value.trim() && !refs.length ? h('small', { class: 'muted' }, 'No references recognised yet') : null);
    }, 350);
  });

  const go = h('button', {
    class: 'ai-btn',
    onclick: async () => {
      if (!passages.value.trim()) return toast('Enter at least one passage.', 'error');
      try {
        const job = await runWithProgress(work, 'passage_study',
          { passages: passages.value, focus: focus.value, level: level.value, purpose: purpose.value, notes: keep.value, ...ai.value() }, go);
        location.hash = `#/study/${job.result.study_id}`;
      } catch (e) { errToast(e); }
    },
  }, icon('insights', 16), 'Research these passages');

  mount(view, 
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Passage study'),
      h('p', {}, 'Enter one or more passages and, optionally, a word, sentence or topic. The AI reads the Bible text and commentaries on each passage across your sources and applies them to your focus.'))),
    h('div', { class: 'card' },
      field('Passage(s)', h('div', {}, passages, chips), 'Separate several passages with semicolons.'),
      field('Word, sentence or topic (optional)', focus),
      field('Intensity', h('div', {}, level, help)),
      h('div', { class: 'grid two' },
        field('What it’s for', purpose, 'Shapes the notes: a home group gets an icebreaker, questions and leader’s notes; preaching gets an outline.'),
        field('Anything to keep in mind (optional)', keep)),
      field('Model', ai),
      go, work),
    sectionTitle('Previous passage studies'),
    studyList(past, 'Passage studies you run are saved here.'));
  showHelp();
  if (query.passages) passages.dispatchEvent(new Event('input'));
}
