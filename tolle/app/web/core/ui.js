// Small DOM toolkit and shared components.
import { get, openFile, del, post, runJob } from './api.js';
import { icon } from './icons.js';

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) {
        if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv;
      }
    }
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);

// Append children, skipping null/false (Element.append would print "null").
export function mount(el, ...kids) {
  el.append(...kids.flat(Infinity).filter((k) => k != null && k !== false));
}

export function md(text) {
  const html = window.marked.parse(text || '', { breaks: true, gfm: true });
  const clean = window.DOMPurify.sanitize(html, { ADD_ATTR: ['target'] });
  const div = document.createElement('div');
  div.innerHTML = clean;
  div.querySelectorAll('a[href]').forEach((a) => { a.target = '_blank'; a.rel = 'noopener noreferrer'; });
  return div.innerHTML;
}

export function toast(msg, type = 'info', ms = 4500) {
  const t = h('div', { class: `toast ${type}`, onclick: () => t.remove() }, msg);
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), ms);
}

export function errToast(e) { toast(e.message || String(e), 'error', 7000); }

export function modal(title, body, actions = [{ label: 'Close' }]) {
  return new Promise((resolve) => {
    const back = h('div', { class: 'modal-back' });
    const close = (v) => { back.remove(); resolve(v); };
    const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
      h('h2', {}, title), body,
      h('div', { class: 'row end', style: { marginTop: '18px' } },
        actions.map((a) => h('button', {
          class: a.class || '',
          onclick: async () => { if (a.onclick) { const r = await a.onclick(); if (r === false) return; } close(a.value); },
        }, a.label))));
    back.addEventListener('click', (e) => { if (e.target === back) close(undefined); });
    back.append(box);
    document.body.append(back);
    box.querySelector('input, textarea, select')?.focus();
  });
}

export async function confirmDialog(text, ok = 'Delete') {
  return modal('Are you sure?', h('p', {}, text), [{ label: 'Cancel', value: false }, { label: ok, class: 'primary', value: true }]);
}

export function fmtDate(ts) {
  return new Date(ts * 1000).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
export function fmtDay(ts) {
  return new Date(ts * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function field(label, input, hint) {
  return h('div', { class: 'field' }, h('label', {}, label), input, hint ? h('div', { class: 'hint' }, hint) : null);
}

export function switchEl(label, checked, onchange) {
  const input = h('input', { type: 'checkbox', checked: !!checked, onchange: (e) => onchange && onchange(e.target.checked) });
  const wrap = h('label', { class: 'switch' }, input, label);
  wrap.input = input;
  return wrap;
}

export function segmented(options, value, onchange) {
  const wrap = h('div', { class: 'seg', role: 'radiogroup' });
  wrap.value = value;
  const render = () => {
    wrap.replaceChildren(...options.map(([v, label]) => h('button', {
      type: 'button', class: v === wrap.value ? 'on' : '', role: 'radio', 'aria-checked': String(v === wrap.value),
      onclick: () => { wrap.value = v; render(); onchange && onchange(v); },
    }, label)));
  };
  render();
  return wrap;
}

// ---------- app state shared by views ----------
export const state = { settings: null, levels: null, providers: null, me: null };

export async function saveSettings(values, msg = 'Saved') {
  try {
    const r = await (await import('./api.js')).put('api/settings', values);
    state.settings = r.values;
    window.dispatchEvent(new Event('tolle:settings'));
    toast(msg);
  } catch (e) { errToast(e); }
}

export async function loadSettings(force = false) {
  if (!state.settings || force) {
    const s = await get('api/settings');
    state.settings = s.values; state.levels = s.levels; state.providers = s.providers;
    state.addon = s.addon; state.ocr = s.ocr; state.defaultSources = s.default_sources;
  }
  return state.settings;
}

export function levelPicker(value) {
  const opts = Object.entries(state.levels || { intro: 'Introduction', study: 'Study', preach: 'Preach / Teach', deep: 'In-depth' });
  return segmented(opts, value || state.settings?.['study.default_level'] || 'study');
}

// ---------- AI model picker (per-run override) ----------
const modelCache = {};
export async function fetchModels(provider, force = false) {
  if (!modelCache[provider] || force) {
    modelCache[provider] = (await get(`api/ai/models?provider=${encodeURIComponent(provider)}`)).models;
  }
  return modelCache[provider];
}

export function aiControls() {
  const s = state.settings;
  let provider = s['ai.provider'];
  const defaultModel = () => (provider === 'ondevice' ? s['ondevice.model'] : s['ai.model']);
  const provSel = h('select', { 'aria-label': 'AI provider' },
    Object.entries(state.providers).map(([k, v]) => h('option', { value: k, selected: k === provider }, v.split(' (')[0])));
  const modelSel = h('select', { 'aria-label': 'Model' });
  const think = switchEl('Thinking', s['ai.thinking']);
  const status = h('small', { class: 'muted' });
  async function loadModels() {
    const dm = provider === s['ai.provider'] ? defaultModel() : '';
    modelSel.replaceChildren(h('option', { value: dm }, dm || 'Loading models…'));
    try {
      const models = await fetchModels(provider);
      const ids = models.map((m) => m.id);
      if (dm && !ids.includes(dm)) ids.unshift(dm);
      modelSel.replaceChildren(...ids.map((id) => {
        const m = models.find((x) => x.id === id) || {};
        return h('option', { value: id, selected: id === dm }, id + (m.thinking ? '  · thinking' : ''));
      }));
      status.textContent = '';
    } catch (e) {
      status.textContent = e.message.slice(0, 120);
    }
  }
  provSel.addEventListener('change', () => { provider = provSel.value; loadModels(); });
  loadModels();
  const el = h('div', { class: 'ai-controls' }, h('span', { class: 'chip ai' }, icon('insights', 14), 'AI'), provSel, modelSel, think, status);
  el.value = () => ({ provider, model: modelSel.value || undefined, thinking: think.input.checked });
  return el;
}

export function progressBox() {
  const text = h('span', {}, 'Starting…');
  const el = h('div', { class: 'progress' }, h('div', { class: 'spinner' }), text);
  el.set = (m) => { text.textContent = m; };
  return el;
}

// Run an AI job with a progress box placed inside `container`.
export async function runWithProgress(container, kind, params, button) {
  const box = progressBox();
  container.append(box);
  if (button) button.disabled = true;
  try {
    return await runJob(kind, params, (m) => box.set(m));
  } finally {
    box.remove();
    if (button) button.disabled = false;
  }
}

// ---------- notes (user vs AI) ----------
const TYPE_LABEL = {
  note: 'Your note', upload: 'Upload', analysis: 'Analysis', research: 'Research', insight: 'Insight',
  plan: 'Study plan', transcription: 'Transcription',
};

export function noteCard(entry, { onChange } = {}) {
  const isAI = entry.author === 'ai';
  const m = entry.meta || {};
  const body = h('div', { class: 'prose', html: md(entry.content) });
  const actions = h('div', { class: 'note-actions' });
  const copy = h('button', {
    class: 'small ghost', title: 'Copy text',
    onclick: async () => { await navigator.clipboard.writeText(entry.content); toast('Copied'); },
  }, icon('copy', 15), 'Copy');
  actions.append(copy);
  if (!isAI) {
    actions.append(h('button', { class: 'small ghost', onclick: () => editNote(entry, onChange) }, icon('edit', 15), 'Edit'));
  } else {
    actions.append(h('button', {
      class: 'small ghost', title: 'Make an editable copy in your own words',
      onclick: async () => {
        await post(`api/studies/${entry.study_id}/entries`, { title: `My notes on: ${entry.title}`, content: entry.content });
        toast('Copied into a new note of your own – edit it freely.');
        onChange && onChange();
      },
    }, icon('notes', 15), 'Copy to my notes'));
  }
  actions.append(h('button', {
    class: 'small ghost danger',
    onclick: async () => { if (await confirmDialog('Delete this note?')) { await del(`api/entries/${entry.id}`); onChange && onChange(); } },
  }, icon('trash', 15), 'Delete'));

  const extras = [];
  if (isAI && m.sources && m.sources.length) {
    extras.push(h('details', { class: 'extra' }, h('summary', {}, `Sources checked (${m.sources.filter((s) => s.ok).length}/${m.sources.length} available)`),
      h('ul', {}, m.sources.map((s) => h('li', {}, s.ok ? '✓ ' : '✗ ', h('a', { href: s.url, target: '_blank', rel: 'noopener' }, `${s.name} – ${s.ref}`),
        s.ok ? '' : ' (unavailable)')))));
  }
  if (isAI && m.thinking) {
    extras.push(h('details', { class: 'extra' }, h('summary', {}, 'Model reasoning'), h('pre', {}, m.thinking)));
  }
  return h('article', { class: `note ${isAI ? 'ai' : 'user'}` },
    h('div', { class: 'note-head' },
      isAI ? h('span', { class: 'badge-ai' }, icon('insights', 13), 'AI') : h('span', { class: 'badge-you' }, icon('user', 13), 'You'),
      h('span', { class: 'title' }, entry.title || TYPE_LABEL[entry.type] || 'Note'),
      isAI && m.model ? h('span', { class: 'chip ai' }, m.model) : null,
      h('small', {}, fmtDate(entry.created_at))),
    body, ...extras, actions);
}

async function editNote(entry, onChange) {
  const title = h('input', { value: entry.title });
  const text = h('textarea', { style: { minHeight: '300px' } }, entry.content);
  await modal('Edit note', h('div', {}, field('Title', title), field('Note (Markdown supported)', text)), [
    { label: 'Cancel' },
    {
      label: 'Save', class: 'primary',
      onclick: async () => {
        const { patch } = await import('./api.js');
        await patch(`api/entries/${entry.id}`, { title: title.value, content: text.value });
        onChange && onChange();
      },
    },
  ]);
}

export function legend() {
  return h('div', { class: 'legend' },
    h('span', {}, h('span', { class: 'badge-you' }, icon('user', 13), 'You'), 'your own notes'),
    h('span', {}, h('span', { class: 'badge-ai' }, icon('insights', 13), 'AI'), 'written by AI, always purple'));
}

export function fileRow(f, onChange) {
  return h('div', { class: 'list-item' },
    h('span', { class: 'kind-ic' }, icon('file', 17)),
    h('div', { class: 'grow' },
      h('div', { class: 't' }, f.filename),
      h('small', {}, `${(f.size / 1024).toFixed(0)} KB, added ${fmtDay(f.created_at)}`),
      f.preview ? h('div', { class: 'muted', style: { fontSize: '.85rem', marginTop: '4px', whiteSpace: 'pre-wrap' } },
        f.preview.slice(0, 220) + (f.preview.length > 220 ? '…' : '')) : h('div', { class: 'muted', style: { fontSize: '.85rem' } }, 'No text extracted yet')),
    h('div', { class: 'row' },
      h('button', { class: 'small', onclick: () => openFile(f.id, f.filename).catch(errToast) }, 'Open'),
      /\.(png|jpe?g|webp|gif|bmp|tiff?|pdf)$/i.test(f.filename)
        ? h('button', { class: 'small ai-btn', onclick: (e) => transcribe(f, e.currentTarget, onChange) }, icon('insights', 15), 'Transcribe with AI') : null,
      h('button', {
        class: 'small ghost danger',
        onclick: async () => { if (await confirmDialog(`Delete ${f.filename}?`)) { await del(`api/files/${f.id}`); onChange(); } },
      }, icon('trash', 15))));
}

async function transcribe(f, btn, onChange) {
  btn.disabled = true; btn.textContent = 'Reading…';
  try {
    await runJob('transcribe', { file_id: f.id }, (m) => { btn.textContent = m.slice(0, 40); });
    toast('Transcription added as a purple AI note.');
    onChange();
  } catch (e) { errToast(e); btn.disabled = false; btn.textContent = 'Transcribe with AI'; }
}

export function kindLabel(kind) {
  return { notes: 'Study notes', passage: 'Passage study', insight: 'Insight', plan: 'Study plan' }[kind] || kind;
}

const KIND_ICON = { notes: 'notes', passage: 'research', insight: 'insights', plan: 'builder' };

export function studyList(items, emptyText) {
  return items.length ? h('div', { class: 'list' }, items.map(studyListItem)) : h('div', { class: 'empty' }, emptyText);
}

export function studyListItem(s) {
  return h('a', { class: 'list-item', href: `#/study/${s.id}` },
    h('span', { class: 'kind-ic' }, icon(KIND_ICON[s.kind] || 'notes', 17)),
    h('div', { class: 'grow' },
      h('div', { class: 't' }, s.title),
      h('small', {}, `${kindLabel(s.kind)}, updated ${fmtDay(s.updated_at)}`)),
    s.ai_entries ? h('span', { class: 'chip ai' }, `${s.ai_entries} AI`) : null,
    s.entries - (s.ai_entries || 0) > 0 ? h('span', { class: 'chip ok' }, `${s.entries - s.ai_entries} yours`) : null,
    s.files ? h('span', { class: 'chip' }, icon('file', 13), s.files) : null);
}

export function backLink(href, label) {
  return h('a', { class: 'back', href }, icon('chevronLeft', 16), label);
}

export function sectionTitle(text, extra) {
  return h('div', { class: 'section-title' }, h('h2', {}, text), extra || null);
}
