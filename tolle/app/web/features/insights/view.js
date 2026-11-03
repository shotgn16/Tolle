import { icon } from '../../core/icons.js';
import { get } from '../../core/api.js';
import { aiControls, errToast, field, h, levelPicker, runWithProgress, segmented, studyListItem, toast, mount, sectionTitle , studyList } from '../../core/ui.js';

const MODES = [['passage', 'Bible passage'], ['topic', 'Topic'], ['life', 'Area of life']];
const SUGGEST = {
  passage: ['Psalm 23', 'Romans 12:1-2', 'Philippians 4:4-9', 'Isaiah 40:28-31', 'Matthew 5:1-12'],
  topic: ['Grace', 'Holiness', 'The Kingdom of God', 'Prayer', 'Covenant', 'Forgiveness'],
  life: ['Work and calling', 'Anxiety and worry', 'Grief and loss', 'Marriage', 'Money and generosity', 'Parenting', 'Friendship', 'Rest and Sabbath'],
};
const PLACEHOLDER = {
  passage: 'e.g. John 21:15-19',
  topic: 'e.g. the fear of the Lord',
  life: 'e.g. making a big decision, handling conflict at work',
};

export async function render(view, query) {
  const past = await get('api/studies?kind=insight');
  let mode = query.mode || 'passage';
  const q = h('input', { value: query.q || '' });
  const sugg = h('div', { class: 'row', style: { marginTop: '8px' } });
  const drawMode = () => {
    q.placeholder = PLACEHOLDER[mode];
    sugg.replaceChildren(...SUGGEST[mode].map((s) => h('button', { class: 'chip', type: 'button', onclick: () => { q.value = s; } }, s)));
  };
  const modeSeg = segmented(MODES, mode, (v) => { mode = v; drawMode(); });
  const level = levelPicker(query.level);
  const ai = aiControls();
  const work = h('div');
  const go = h('button', {
    class: 'ai-btn',
    onclick: async () => {
      if (!q.value.trim()) return toast('Enter something to explore.', 'error');
      try {
        const job = await runWithProgress(work, 'insight', { mode, query: q.value, level: level.value, ...ai.value() }, go);
        location.hash = `#/study/${job.result.study_id}`;
      } catch (e) { errToast(e); }
    },
  }, icon('insights', 16), 'Get insight');

  mount(view, 
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Insights'),
      h('p', {}, 'Ask for insight on a passage, a biblical topic, or an area of life seen through Scripture. Choose how deep you want to go.'))),
    h('div', { class: 'card' },
      field('What would you like insight on?', modeSeg),
      field('Your question', h('div', {}, q, sugg)),
      field('Level of detail', level),
      field('Model', ai),
      go, work),
    sectionTitle('Previous insights'),
    studyList(past, 'Insights you ask for are saved here.'));
  drawMode();
}
