import { icon } from '../icons.js';
import { api, del, get, patch, post } from '../api.js';
import {
  aiControls, confirmDialog, errToast, field, fileRow, h, kindLabel, legend, levelPicker, modal, noteCard,
  runWithProgress, segmented, studyListItem, toast, fmtDay, mount, backLink , studyList } from '../ui.js';

const ACCEPT = '.pdf,.docx,.txt,.md,.markdown,.html,.htm,.png,.jpg,.jpeg,.webp,.gif,.bmp,.tif,.tiff,image/*';

// ---------------------------------------------------------------- list
export async function renderList(view) {
  const studies = await get('api/studies?kind=notes');
  const search = h('input', { type: 'search', placeholder: 'Search your studies…' });
  const list = h('div');
  const draw = () => {
    const q = search.value.toLowerCase();
    const items = studies.filter((s) => s.title.toLowerCase().includes(q));
    list.className = items.length ? 'list' : '';
    list.replaceChildren(...(items.length ? items.map(studyListItem)
      : [h('div', { class: 'empty' }, studies.length ? 'No matches.' : 'No study notes yet. Write one or upload your existing notes.')]));
  };
  search.addEventListener('input', draw);
  mount(view, 
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Study notes'),
        h('p', {}, 'Your own notes, written here or uploaded (PDFs, Word, images, text). AI can read them, break them down and compare them with commentaries and study sites.')),
      h('div', { class: 'row' },
        h('button', { onclick: newNote }, icon('edit', 16), 'Write a note'),
        h('a', { class: 'btn primary', href: '#/notes/upload' }, icon('upload', 16), 'Upload notes'))),
    h('div', { class: 'field' }, search), list);
  draw();
}

async function newNote() {
  const title = h('input', { placeholder: 'e.g. Romans 8 – life in the Spirit' });
  const text = h('textarea', { style: { minHeight: '280px' }, placeholder: 'Write your notes… Markdown works: # headings, - lists, **bold**' });
  await modal('New study note', h('div', {}, field('Study title', title), field('Your notes', text)), [
    { label: 'Cancel' },
    {
      label: 'Save', class: 'primary',
      onclick: async () => {
        if (!title.value.trim()) { toast('Give the study a title.', 'error'); return false; }
        const r = await post('api/studies', { kind: 'notes', title: title.value, content: text.value, note_title: 'My notes' });
        location.hash = `#/study/${r.id}`;
      },
    },
  ]);
}

// ---------------------------------------------------------------- upload (single or bulk)
export async function renderUpload(view, query) {
  const existing = await get('api/studies?kind=notes');
  let files = [];
  let mode = 'one';
  const title = h('input', { placeholder: 'Study title (for “one study”)' });
  const target = h('select', {},
    h('option', { value: '' }, '— Create new study/studies —'),
    existing.map((s) => h('option', { value: s.id, selected: String(s.id) === query.study }, `Add to: ${s.title}`)));
  const input = h('input', { type: 'file', multiple: true, accept: ACCEPT });
  const table = h('div');
  const status = h('div');
  const modeSeg = segmented([
    ['one', 'All in one study'],
    ['each', 'One study per file'],
    ['custom', 'Custom groups'],
  ], mode, (v) => { mode = v; draw(); });

  const groupOf = (i) => {
    if (mode === 'one') return title.value.trim() || 'Uploaded study';
    if (mode === 'each') return files[i].file.name.replace(/\.[^.]+$/, '');
    return files[i].group;
  };

  function draw() {
    title.parentElement.hidden = mode !== 'one' || !!target.value;
    modeSeg.hidden = !!target.value;
    if (!files.length) { table.replaceChildren(h('div', { class: 'empty' }, 'Choose one or more files above.')); return; }
    table.replaceChildren(h('table', { class: 'simple' },
      h('tr', {}, h('th', {}, 'File'), h('th', {}, 'Size'), h('th', {}, target.value ? 'Study' : 'Belongs to study')),
      files.map((f, i) => h('tr', {},
        h('td', {}, f.file.name),
        h('td', {}, `${(f.file.size / 1024).toFixed(0)} KB`),
        h('td', {}, target.value ? target.selectedOptions[0].textContent.replace('Add to: ', '')
          : mode === 'custom'
            ? h('input', { value: f.group, oninput: (e) => { f.group = e.target.value; } })
            : groupOf(i))))),
    mode === 'custom' && !target.value ? h('p', { class: 'muted', style: { marginTop: '8px' } },
      'Files with the same study name are grouped together – e.g. give two documents the same name to make one study from them.') : null);
  }

  input.addEventListener('change', () => {
    files = [...input.files].map((file) => ({ file, group: file.name.replace(/\.[^.]+$/, '').replace(/[_-]+(part|p|page|pg)?\s*\d+$/i, '') }));
    draw();
  });
  target.addEventListener('change', draw);
  title.addEventListener('input', draw);

  const go = h('button', {
    class: 'primary',
    onclick: async () => {
      if (!files.length) return toast('Choose files first.', 'error');
      const fd = new FormData();
      files.forEach((f, i) => { fd.append('files', f.file); fd.append('groups', groupOf(i)); });
      if (target.value) fd.append('study_id', target.value);
      go.disabled = true;
      status.replaceChildren(h('div', { class: 'progress' }, h('div', { class: 'spinner' }), 'Uploading, encrypting and reading your files…'));
      try {
        const r = await api('POST', 'api/notes/upload', fd);
        toast(`Uploaded ${files.length} file(s) into ${r.studies.length} stud${r.studies.length === 1 ? 'y' : 'ies'}.`
          + (r.jobs.length ? ' Images are being transcribed by AI in the background.' : ''));
        location.hash = r.studies.length === 1 ? `#/study/${r.studies[0]}` : '#/notes';
      } catch (e) { errToast(e); go.disabled = false; status.replaceChildren(); }
    },
  }, 'Upload');

  mount(view, 
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Upload study notes'),
      h('p', {}, 'Upload one file or many at once. Files are encrypted on the server. Text is read from PDFs and Word files; handwritten pages and images can be transcribed by a vision-capable AI model.'))),
    h('div', { class: 'card' },
      field('Files', input, 'PDF, Word (.docx), text/Markdown, HTML or images (JPG, PNG, WebP…).'),
      field('Where should they go?', target),
      field('How are the files organised?', modeSeg),
      field('Study title', title),
      table,
      h('div', { class: 'row end', style: { marginTop: '16px' } }, h('a', { class: 'btn ghost', href: '#/notes' }, 'Cancel'), go),
      status));
  draw();
}

// ---------------------------------------------------------------- study detail (all kinds)
export async function renderStudy(view, id) {
  const s = await get(`api/studies/${id}`);
  const reload = () => { view.replaceChildren(); renderStudy(view, id); };
  const work = h('div');
  const titleEl = h('h1', { contenteditable: 'true', spellcheck: 'false', title: 'Click to rename' }, s.title);
  titleEl.addEventListener('blur', async () => {
    const t = titleEl.textContent.trim();
    if (t && t !== s.title) { await patch(`api/studies/${id}`, { title: t }); toast('Renamed'); }
  });
  titleEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); titleEl.blur(); } });

  const back = { notes: '#/notes', passage: '#/research', insight: '#/insights', plan: '#/builder' }[s.kind] || '#/notes';
  const navKey = { notes: 'notes', passage: 'research', insight: 'insights', plan: 'builder' }[s.kind] || 'notes';
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === navKey));
  const meta = s.meta || {};
  const metaChips = [
    meta.level ? h('span', { class: 'chip' }, meta.level) : null,
    meta.focus ? h('span', { class: 'chip' }, `Focus: ${meta.focus}`) : null,
    meta.audience ? h('span', { class: 'chip' }, meta.audience) : null,
  ];

  // Analyze panel
  const level = levelPicker(meta.level);
  const ai = aiControls();
  const analyzeBtn = h('button', {
    class: 'ai-btn',
    onclick: async () => {
      try {
        await runWithProgress(work, 'notes_analyze', { study_id: id, level: level.value, ...ai.value() }, analyzeBtn);
        toast('Analysis added.');
        reload();
      } catch (e) { errToast(e); }
    },
  }, icon('insights', 16), 'Analyse and compare with sources');
  const analyzePanel = h('div', { class: 'ai-panel' },
    h('h3', {}, icon('insights', 17), 'AI analysis'),
    h('p', { class: 'muted' }, 'The AI reads everything you have written or uploaded in this study, finds the passages, researches them on StudyLight, BibleStudyTools, BibleProject, Enduring Word and the Bible text, then compares your notes with what it finds.'),
    field('Depth', level), field('Model', ai), analyzeBtn);

  // Follow-up research into this study
  const fuPass = h('input', { placeholder: 'Passages, e.g. Romans 8:1-17' });
  const fuFocus = h('input', { placeholder: 'Word, sentence or topic (optional)' });
  const fuBtn = h('button', {
    class: 'ai-btn',
    onclick: async () => {
      try {
        await runWithProgress(work, 'passage_study', { study_id: id, passages: fuPass.value, focus: fuFocus.value, level: level.value, ...ai.value() }, fuBtn);
        reload();
      } catch (e) { errToast(e); }
    },
  }, icon('insights', 16), 'Research into this study');

  mount(view, 
    backLink(back, kindLabel(s.kind)),
    h('div', { class: 'page-head', style: { marginTop: '8px' } },
      h('div', {}, titleEl, h('div', { class: 'row' }, h('span', { class: 'chip' }, kindLabel(s.kind)), ...metaChips,
        h('small', {}, `Created ${fmtDay(s.created_at)}`))),
      h('div', { class: 'row' },
        h('button', { onclick: () => addNote(id, reload) }, icon('plus', 16), 'Add my note'),
        h('a', { class: 'btn', href: `#/notes/upload?study=${id}` }, icon('upload', 16), 'Add files'),
        h('button', {
          class: 'ghost danger',
          onclick: async () => { if (await confirmDialog('Delete this whole study, its notes and files?')) { await del(`api/studies/${id}`); location.hash = back; } },
        }, 'Delete'))),
    legend(), h('div', { style: { height: '14px' } }),
    s.entries.length ? h('div', {}, s.entries.map((e) => noteCard(e, { onChange: reload })))
      : h('div', { class: 'empty' }, 'No notes yet. Add your own note or upload files.'),
    s.files.length ? h('div', { style: { marginTop: '22px' } }, h('h2', {}, 'Files'), s.files.map((f) => fileRow(f, reload))) : null,
    work,
    h('div', { style: { marginTop: '26px' }, class: 'grid two' },
      analyzePanel,
      h('div', { class: 'ai-panel' }, h('h3', {}, icon('research', 17), 'Research more into this study'),
        h('p', { class: 'muted' }, 'Add a passage study (using the depth and model on the left) as another purple note here.'),
        field('Passages', fuPass), field('Focus', fuFocus), fuBtn)),
  );
}

async function addNote(studyId, done) {
  const title = h('input', { placeholder: 'Note title' });
  const text = h('textarea', { style: { minHeight: '280px' } });
  await modal('Add your note', h('div', {}, field('Title', title), field('Note (Markdown supported)', text)), [
    { label: 'Cancel' },
    {
      label: 'Save', class: 'primary',
      onclick: async () => {
        if (!text.value.trim()) { toast('Write something first.', 'error'); return false; }
        await post(`api/studies/${studyId}/entries`, { title: title.value || 'My note', content: text.value });
        done();
      },
    },
  ]);
}
