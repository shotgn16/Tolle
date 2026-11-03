import { icon } from '../icons.js';
import { del, get, isNative, patch, post, put, serverUrl, setServerUrl, token } from '../api.js';
import { ensureModel, webgpuAvailable } from '../ondevice.js';
import {
  confirmDialog, errToast, fetchModels, field, fmtDate, h, loadSettings, modal, saveSettings, segmented, state, switchEl, toast, mount,
} from '../ui.js';
import { activeFeatures } from '../registry.js';

// Core tabs. Features add their own tabs (see web/features/<id>/index.js → settingsTabs).
const CORE_TABS = [
  ['ai', 'AI', aiTab], ['sources', 'Sources', sourcesTab], ['notify', 'Devices & notifications', notifyTab],
  ['study', 'Bible & study', studyTab], ['account', 'Account', accountTab], ['about', 'About & security', aboutTab],
];

// Only administrators see these.
const ADMIN_TABS = [['features', 'Features', featuresTab], ['instructions', 'AI instructions', instructionsTab]];

export async function render(view, query) {
  await loadSettings(true);
  const body = h('div');
  let tab = query.tab || 'ai';
  const tabs = h('div', { class: 'tabs' });
  const all = [...CORE_TABS];
  if (state.me?.is_admin) all.splice(all.length - 2, 0, ...ADMIN_TABS);
  for (const f of activeFeatures()) for (const t of f.settingsTabs || []) all.splice(3, 0, [t.id, t.label, t.render]);
  const drawTabs = () => tabs.replaceChildren(...all.map(([k, l]) => h('button', {
    class: k === tab ? 'on' : '', onclick: () => { tab = k; drawTabs(); drawBody(); },
  }, l)));
  const drawBody = () => {
    body.replaceChildren();
    (all.find(([k]) => k === tab) || all[0])[2](body);
  };
  mount(view, h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Settings'),
    h('p', {}, 'Everything is configured here and stored encrypted on your server. The only setting outside the app is the network port.'))), tabs, body);
  drawTabs(); drawBody();
}

const save = saveSettings;

// ---------------------------------------------------------------- features (admin)
async function featuresTab(root) {
  const list = await get('api/features');
  const off = new Set(list.filter((f) => f.enabled === false).map((f) => f.id));
  root.append(h('div', { class: 'card' },
    h('h3', {}, 'Features'),
    h('p', { class: 'muted' }, 'Choose which parts of Tolle everyone on this server sees. Switching a feature off hides it and pauses its reminders; nothing is deleted, and switching it back on brings everything back.'),
    h('div', { class: 'list', style: { marginTop: '12px' } }, list.map((f) => h('div', { class: 'list-item' },
      h('div', { class: 'grow' }, h('div', { class: 't' }, f.name), f.description ? h('small', {}, f.description) : null),
      f.essential ? h('span', { class: 'chip' }, 'Always on')
        : switchEl('', !off.has(f.id), (v) => { if (v) off.delete(f.id); else off.add(f.id); })))),
    h('div', { class: 'row', style: { marginTop: '16px' } },
      h('button', {
        class: 'primary',
        onclick: async () => {
          try { await put('api/admin/features', { disabled: [...off] }); toast('Saved. Reloading…'); setTimeout(() => location.reload(), 600); } catch (e) { errToast(e); }
        },
      }, 'Save and reload')),
    h('p', { class: 'hint', style: { marginTop: '12px' } }, 'Developers can add new features too – see docs/developer/customising.md in the project.')));
}

// ---------------------------------------------------------------- AI instructions (admin)
async function instructionsTab(root) {
  const items = await get('api/admin/instructions');
  const edits = {};
  const groups = [...new Set(items.map((i) => i.group))];
  root.append(h('div', { class: 'card' },
    h('h3', {}, 'AI instructions'),
    h('p', { class: 'muted' }, 'This is the wording Tolle gives the AI. Change it to suit your church or group – for example the tone, the tradition, or how long each depth should be. Your changes apply to everyone on this server and are kept when Tolle is updated. “Reset” brings back the original.')));
  for (const g of groups) {
    root.append(h('h2', { style: { margin: '26px 0 10px' } }, g));
    for (const it of items.filter((i) => i.group === g)) {
      const ta = h('textarea', { style: { minHeight: it.value.length > 600 ? '320px' : '150px', fontSize: '.9rem' } }, it.value);
      ta.addEventListener('input', () => { edits[it.key] = ta.value; });
      root.append(h('div', { class: 'card' },
        h('div', { class: 'row' }, h('h3', { class: 'grow', style: { margin: 0 } }, it.label),
          it.customised ? h('span', { class: 'chip ok' }, 'Customised') : null,
          h('button', { class: 'small ghost', onclick: () => { ta.value = it.default; edits[it.key] = ''; } }, icon('refresh', 14), 'Reset')),
        it.help ? h('p', { class: 'hint', style: { margin: '6px 0 10px' } }, it.help) : null, ta));
    }
  }
  root.append(h('button', {
    class: 'primary', style: { marginTop: '8px' },
    onclick: async () => {
      try { await put('api/admin/instructions', edits); toast('Saved'); root.replaceChildren(); instructionsTab(root); } catch (e) { errToast(e); }
    },
  }, 'Save instructions'));
}

// ---------------------------------------------------------------- AI
function aiTab(root) {
  const s = state.settings;
  const vals = {};
  const set = (k) => (v) => { vals[k] = v; };
  const inp = (k, type = 'text', ph = '') => {
    const el = h('input', { type, value: s[k] ?? '', placeholder: ph, autocomplete: 'off' });
    el.addEventListener('input', () => { vals[k] = type === 'number' ? +el.value : el.value; });
    return el;
  };

  const provider = h('select', {}, Object.entries(state.providers).map(([k, v]) => h('option', { value: k, selected: k === s['ai.provider'] }, v)));
  const providerFields = h('div');
  const modelSel = h('select');
  const modelManual = h('input', { placeholder: 'or type a model name' });
  const modelStatus = h('div', { class: 'hint' });

  const PFIELDS = {
    ollama: () => [field('Ollama URL', inp('ollama.url', 'url', 'http://homeassistant.local:11434'),
      'Ollama must listen on the network (OLLAMA_HOST=0.0.0.0). Thinking works with models such as qwen3, deepseek-r1, gpt-oss.'),
    h('div', { class: 'grid two' },
      field('Context window (tokens)', inp('ollama.num_ctx', 'number'),
        'How much the model can hold at once. 16384 suits most studies; lower it to 8192 on an 8 GB machine, raise it for In-depth studies on bigger ones.'),
      field('Longest answer (tokens)', inp('ollama.max_output_tokens', 'number'), 'About 0.75 words per token.'))],
    openai: () => [field('OpenAI API key', inp('openai.key', 'password', 'sk-…')),
      field('API base URL', inp('openai.base_url', 'url'), 'Leave as default unless you use Azure or a proxy.')],
    gemini: () => [field('Gemini API key', inp('gemini.key', 'password'), 'Create one at aistudio.google.com.')],
    anthropic: () => [field('Anthropic API key', inp('anthropic.key', 'password', 'sk-ant-…'))],
    openai_compat: () => [field('Base URL', inp('compat.base_url', 'url', 'http://localhost:1234/v1'), 'LM Studio, LocalAI, vLLM, llama.cpp server, OpenRouter, Groq…'),
      field('API key (if needed)', inp('compat.key', 'password'))],
    ondevice: () => {
      const sel = h('select', {});
      get('api/ai/ondevice-models').then((ms) => sel.replaceChildren(...ms.map((m) => h('option', { value: m.id, selected: m.id === s['ondevice.model'] },
        `${m.id} – ${m.note}${m.thinking ? ' · thinking' : ''}`))));
      sel.addEventListener('change', () => { vals['ondevice.model'] = sel.value; });
      const st = h('div', { class: 'hint' });
      const test = h('button', {
        class: 'small',
        onclick: async () => {
          test.disabled = true;
          try { await ensureModel(sel.value || s['ondevice.model'], (m) => { st.textContent = m; }); st.textContent = 'Model ready on this device ✓'; } catch (e) { st.textContent = e.message; }
          test.disabled = false;
        },
      }, 'Download & test on this device');
      return [
        h('p', {}, webgpuAvailable() ? '✓ WebGPU is available on this device.' : '✗ WebGPU isn’t available in this browser – on-device models won’t run here.'),
        field('On-device model', sel, 'Runs entirely on the device you are using. The model downloads once and is cached. Image transcription needs a server provider.'),
        test, st];
    },
  };

  async function loadModels() {
    const p = provider.value;
    providerFields.replaceChildren(...PFIELDS[p]());
    modelBlock.hidden = p === 'ondevice';
    if (p === 'ondevice') return;
    modelStatus.textContent = 'Loading models…';
    try {
      const models = await fetchModels(p, true);
      const cur = vals['ai.model'] ?? s['ai.model'];
      modelSel.replaceChildren(h('option', { value: '' }, '— choose a model —'),
        ...models.map((m) => h('option', { value: m.id, selected: m.id === cur },
          `${m.id}${m.thinking ? '  · thinking' : ''}${m.vision ? '  · vision' : ''}`)));
      if (cur && !models.some((m) => m.id === cur)) modelManual.value = cur;
      modelStatus.textContent = `${models.length} models found.`;
    } catch (e) {
      modelSel.replaceChildren(h('option', { value: s['ai.model'] }, s['ai.model'] || '—'));
      modelStatus.textContent = `Couldn't list models: ${e.message}. Save your key/URL first, then refresh – or type the model name.`;
    }
  }
  provider.addEventListener('change', () => { vals['ai.provider'] = provider.value; loadModels(); });
  modelSel.addEventListener('change', () => { vals['ai.model'] = modelSel.value; modelManual.value = ''; });
  modelManual.addEventListener('input', () => { vals['ai.model'] = modelManual.value.trim(); });

  const modelBlock = h('div', {}, field('Default model', h('div', { class: 'row' }, h('div', { class: 'grow' }, modelSel),
      h('button', { class: 'small', onclick: async () => { await save(vals, 'Saved – refreshing models'); loadModels(); } }, icon('refresh', 15), 'Save and refresh')),
    h('div', {}, modelManual, modelStatus)));
  const think = switchEl('Thinking mode on by default', s['ai.thinking'], set('ai.thinking'));
  const vision = switchEl('Transcribe uploaded images & scanned PDFs with AI automatically', s['ai.vision_transcribe'], set('ai.vision_transcribe'));

  root.append(h('div', { class: 'card' },
    h('h3', {}, 'AI provider'),
    field('Provider', provider),
    providerFields,
    modelBlock,
    field('Thinking', think, 'Models that support it (qwen3, deepseek-r1, gpt-oss, o-series/GPT-5, Gemini 2.5+, Claude) reason before answering – slower but often deeper. You can also toggle it per request.'),
    h('div', { class: 'grid two' },
      field('Creativity (temperature)', inp('ai.temperature', 'number'), '0.2 = focused, 1.0 = creative'),
      field('Source text budget (characters)', inp('ai.context_chars', 'number'), 'How much research text is sent to the model. Lower for small local models.')),
    field('Image notes', vision, 'Needs a vision-capable model (e.g. gemma3, llava, qwen2.5-vl in Ollama; GPT-4o/5; Gemini; Claude).'),
    h('button', { class: 'primary', onclick: () => save(vals) }, 'Save AI settings')));
  loadModels();
}

// ---------------------------------------------------------------- sources
function sourcesTab(root) {
  let list = JSON.parse(JSON.stringify(state.settings.sources || []));
  const wrap = h('div');
  const testRef = h('input', { value: 'John 3:16', style: { maxWidth: '200px' } });
  const draw = () => wrap.replaceChildren(...list.map((src, i) => {
    const name = h('input', { value: src.name, oninput: (e) => { src.name = e.target.value; } });
    const url = h('input', { value: src.url, oninput: (e) => { src.url = e.target.value; } });
    const kind = h('select', { onchange: (e) => { src.kind = e.target.value; } },
      ['text', 'commentary', 'overview', 'dictionary', 'other'].map((k) => h('option', { selected: k === src.kind }, k)));
    const out = h('div', { class: 'hint' });
    return h('div', { class: 'card' },
      h('div', { class: 'row' }, switchEl('', src.enabled, (v) => { src.enabled = v; }), h('div', { class: 'grow' }, name), kind),
      h('div', { style: { marginTop: '10px' } }, url),
      h('div', { class: 'row', style: { marginTop: '10px' } },
        h('button', {
          class: 'small',
          onclick: async (e) => {
            e.target.disabled = true; out.textContent = 'Testing…';
            try {
              const r = await post('api/sources/test', { source: src, ref: testRef.value });
              out.textContent = r.length ? `${r[0].ok ? '✓ Works' : '✗ Failed'} – ${r[0].url}\n${r[0].preview.slice(0, 200)}` : 'No URL produced.';
            } catch (err) { out.textContent = err.message; }
            e.target.disabled = false;
          },
        }, 'Test'),
        h('button', { class: 'small ghost danger', onclick: () => { list.splice(i, 1); draw(); } }, 'Remove')),
      out);
  }));
  draw();
  root.append(
    h('div', { class: 'card kbd-help' },
      h('h3', {}, 'Research sources'),
      h('p', {}, 'The AI reads these pages for each passage it studies and links back to them. If a site changes its address layout, fix the template here. Placeholders: ',
        ...['{book}', '{book_slug}', '{chapter}', '{verse}', '{ref}', '{ref_q}', '{translation}'].map((p) => [h('code', {}, p), ' '])),
      h('p', { class: 'muted' }, 'Pages are cached for 30 days so the sites aren’t hit repeatedly. Please respect each site’s terms – this is for personal study.'),
      field('Reference used by the Test buttons', testRef)),
    wrap,
    h('div', { class: 'row', style: { marginTop: '14px' } },
      h('button', { onclick: () => { list.push({ id: `custom_${Date.now()}`, name: 'New source', kind: 'commentary', enabled: true, url: 'https://example.com/{book_slug}/{chapter}' }); draw(); } }, icon('plus', 15), 'Add source'),
      h('button', { class: 'ghost', onclick: async () => { if (await confirmDialog('Reset all sources to the defaults?', 'Reset')) { list = JSON.parse(JSON.stringify(state.defaultSources)); draw(); } } }, 'Reset to defaults'),
      h('span', { class: 'grow' }),
      h('button', { class: 'primary', onclick: () => save({ sources: list }) }, 'Save sources')));
}

// ---------------------------------------------------------------- devices & notifications
async function phoneCard() {
  const card = h('div', { class: 'card' }, h('h3', {}, 'Connect a phone or tablet'));
  if (isNative) return null;
  if (window.tolleDesktop?.connectPhone) {
    card.append(h('p', { class: 'muted' }, 'Show a code your phone can scan to connect the Tolle app.'),
      h('button', { onclick: () => window.tolleDesktop.connectPhone() }, icon('external', 15), 'Show the code'));
    return card;
  }
  try {
    const r = await get('api/server/pairing');
    if (!r.addresses.length) {
      card.append(h('p', { class: 'muted' }, r.mode === 'personal'
        ? 'Tolle is set up for this computer only, so phones can’t connect. Run setup again and choose “this computer and my phone”.'
        : 'Use this server’s network address in the Tolle app on your phone.'));
      return card;
    }
    card.append(h('p', { class: 'muted' }, 'Install the Tolle app, then scan a code with the phone camera – or type the address into the app or any browser.'),
      h('div', { class: 'grid two' }, r.addresses.map((a) => h('div', { class: 'row', style: { gap: '14px', alignItems: 'center' } },
        h('div', { class: 'qr', html: a.svg }), h('code', {}, a.url)))));
  } catch { return null; }
  return card;
}

async function notifyTab(root) {
  const pc = await phoneCard();
  if (pc) root.append(pc);
  const s = state.settings;
  const devWrap = h('div');
  const drawDevices = async () => {
    const devs = await get('api/devices');
    devWrap.replaceChildren(h('table', { class: 'simple' },
      h('tr', {}, h('th', {}, 'Device'), h('th', {}, 'Last seen'), h('th', {}, 'Notify'), h('th', {})),
      devs.map((d) => {
        const name = h('input', { value: d.name || d.platform, style: { maxWidth: '240px' } });
        name.addEventListener('change', () => patch(`api/devices/${d.id}`, { name: name.value }).then(() => toast('Renamed')));
        return h('tr', {},
          h('td', {}, name, h('div', { class: 'hint' }, `${d.platform}${d.ip ? ' · ' + d.ip : ''}${d.this_device ? ' · this device' : ''}`)),
          h('td', {}, h('small', {}, fmtDate(d.last_seen))),
          h('td', {}, switchEl('', d.notify, (v) => patch(`api/devices/${d.id}`, { notify: v }))),
          h('td', { style: { textAlign: 'right', whiteSpace: 'nowrap' } },
            h('button', { class: 'small', onclick: () => post(`api/devices/${d.id}/test`).then(() => toast('Test sent – it appears within a minute while Tolle is open on that device.')) }, 'Test'),
            h('button', {
              class: 'small ghost danger',
              onclick: async () => { if (await confirmDialog(`Forget ${d.name}? It will be signed out.`, 'Forget')) { await del(`api/devices/${d.id}`); drawDevices(); } },
            }, icon('trash', 15))));
      })));
  };

  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  const permBtn = h('button', {
    class: 'small',
    onclick: async () => {
      const LN = window.Capacitor?.Plugins?.LocalNotifications;
      if (LN) { await LN.requestPermissions(); toast('Permission requested'); return; }
      const r = await Notification.requestPermission(); toast(`Notifications: ${r}`);
    },
  }, 'Allow notifications on this device');

  // Home Assistant
  const vals = {};
  const haUrl = h('input', { value: s['notify.ha_url'], placeholder: 'http://homeassistant.local:8123' });
  const haToken = h('input', { type: 'password', value: s['notify.ha_token'], placeholder: 'Long-lived access token' });
  haUrl.addEventListener('input', () => { vals['notify.ha_url'] = haUrl.value.trim(); });
  haToken.addEventListener('input', () => { vals['notify.ha_token'] = haToken.value.trim(); });
  const svcWrap = h('div', { class: 'grid two' });
  let chosen = new Set(s['notify.ha_services'] || []);
  const loadServices = async () => {
    svcWrap.replaceChildren(h('small', {}, 'Loading…'));
    try {
      const r = await get('api/notifications/ha-services');
      if (!r.services.length) { svcWrap.replaceChildren(h('small', { class: 'muted' }, state.addon ? 'No notify services found in Home Assistant.' : 'Enter your Home Assistant URL and token, save, then refresh.')); return; }
      svcWrap.replaceChildren(...r.services.map((svc) => h('label', { class: 'switch' },
        h('input', { type: 'checkbox', checked: chosen.has(svc), onchange: (e) => { e.target.checked ? chosen.add(svc) : chosen.delete(svc); } }), svc)));
    } catch (e) { svcWrap.replaceChildren(h('small', { class: 'muted' }, e.message)); }
  };

  root.append(
    h('div', { class: 'card' },
      h('h3', {}, 'Devices'),
      h('p', {}, 'Every phone, tablet or browser that signs in is detected automatically. Choose which ones receive notifications. ',
        'Browsers show notifications while Tolle is open (or installed as an app); the mobile apps use native notifications.'),
      h('p', {}, `This device: ${perm === 'granted' ? '✓ notifications allowed' : perm === 'denied' ? '✗ notifications blocked in browser settings' : 'not yet allowed'} `, permBtn),
      window.tolleDesktop ? h('p', {}, h('button', { class: 'small primary', onclick: () => window.tolleDesktop.connectPhone() }, 'Connect a phone or tablet…')) : null,
      devWrap),
    h('div', { class: 'card' },
      h('h3', {}, 'Home Assistant notifications'),
      h('p', {}, state.addon
        ? 'Running as a Home Assistant add-on – Tolle can use your notify services (e.g. the Companion app on your phone) with no extra setup. Pick which to use:'
        : 'Optional: send notifications through Home Assistant (e.g. the Companion app). Create a long-lived access token in your HA profile.'),
      state.addon ? null : h('div', { class: 'grid two' }, field('Home Assistant URL', haUrl), field('Access token', haToken)),
      svcWrap,
      h('div', { class: 'row', style: { marginTop: '10px' } },
        h('button', { class: 'small', onclick: async () => { await save(vals, 'Saved'); loadServices(); } }, icon('refresh', 15), 'Refresh services'),
        h('button', { class: 'small', onclick: async () => { await save({ ...vals, 'notify.ha_services': [...chosen] }); const r = await post('api/notifications/test'); toast(r.ok ? 'Test sent to all selected devices and services' : r.errors.join('; '), r.ok ? 'info' : 'error'); } }, 'Send test to all'))),
    h('button', { class: 'primary', onclick: () => save({ ...vals, 'notify.ha_services': [...chosen] }) }, 'Save'));
  drawDevices();
  loadServices();
}

// ---------------------------------------------------------------- bible & study
function studyTab(root) {
  const s = state.settings;
  const vals = {};
  const tr = h('select', { onchange: (e) => { vals['bible.translation'] = e.target.value; } },
    [['web', 'World English Bible'], ['webbe', 'WEB British Edition'], ['kjv', 'King James Version'], ['asv', 'ASV'], ['bbe', 'Bible in Basic English'],
      ['ylt', "Young's Literal"], ['darby', 'Darby'], ['dra', 'Douay-Rheims'], ['oeb-us', 'Open English Bible (US)'], ['oeb-cw', 'Open English Bible (UK)']]
      .map(([k, v]) => h('option', { value: k, selected: k === s['bible.translation'] }, v)));
  const persp = h('input', { value: s['study.perspective'], placeholder: 'e.g. Evangelical Anglican, Baptist, Reformed, Catholic, Pentecostal' });
  persp.addEventListener('input', () => { vals['study.perspective'] = persp.value; });
  const level = segmented(Object.entries(state.levels), s['study.default_level'], (v) => { vals['study.default_level'] = v; });
  const theme = segmented([['auto', 'Match device'], ['light', 'Light'], ['dark', 'Dark']], s['ui.theme'], (v) => { vals['ui.theme'] = v; });
  root.append(h('div', { class: 'card' },
    field('Bible translation (for reading and for the AI)', tr, 'Public-domain translations from bible-api.com.'),
    field('Your tradition (optional)', persp, 'Helps the AI use familiar language. It will still show other faithful views.'),
    field('Default study depth', level),
    field('Theme', theme),
    h('button', { class: 'primary', onclick: () => save(vals) }, 'Save')));
}

// ---------------------------------------------------------------- account
async function accountTab(root) {
  const old = h('input', { type: 'password', autocomplete: 'current-password' });
  const nw = h('input', { type: 'password', autocomplete: 'new-password' });
  root.append(h('div', { class: 'card' },
    h('h3', {}, `Signed in as ${state.me.username}${state.me.is_admin ? ' (admin)' : ''}`),
    h('div', { class: 'grid two' }, field('Current password', old), field('New password', nw, 'At least 8 characters.')),
    h('div', { class: 'row' },
      h('button', { class: 'primary', onclick: async () => { try { await post('api/me/password', { old: old.value, new: nw.value }); toast('Password changed'); old.value = nw.value = ''; } catch (e) { errToast(e); } } }, 'Change password'),
      h('button', { onclick: async () => { await post('api/auth/logout').catch(() => {}); token.set(null); location.hash = '#/'; location.reload(); } }, 'Sign out'))));
  if (isNative) {
    root.append(h('div', { class: 'card' }, h('h3', {}, 'Server'), h('p', {}, serverUrl()),
      h('button', { onclick: () => { setServerUrl(null); token.set(null); location.reload(); } }, 'Change server')));
  }
  if (state.me.is_admin) {
    const wrap = h('div');
    const draw = async () => {
      const users = await get('api/users');
      wrap.replaceChildren(h('table', { class: 'simple' }, users.map((u) => h('tr', {},
        h('td', {}, u.username, u.is_admin ? h('span', { class: 'chip', style: { marginLeft: '8px' } }, 'admin') : null),
        h('td', { style: { textAlign: 'right' } }, u.id === state.me.id ? h('small', {}, 'you') : h('button', {
          class: 'small ghost danger',
          onclick: async () => { if (await confirmDialog(`Delete ${u.username} and ALL their data?`)) { await del(`api/users/${u.id}`); draw(); } },
        }, 'Delete'))))));
    };
    root.append(h('div', { class: 'card' }, h('h3', {}, 'Users'),
      h('p', { class: 'muted' }, 'Each user has their own private, encrypted notes, settings and reading history.'), wrap,
      h('button', { style: { marginTop: '12px' }, onclick: addUser(draw) }, icon('plus', 15), 'Add user')));
    draw();
  }
}

function addUser(done) {
  return async () => {
    const u = h('input'); const p = h('input', { type: 'password' });
    const admin = switchEl('Administrator', false);
    await modal('Add user', h('div', {}, field('Username', u), field('Password', p), admin), [
      { label: 'Cancel' },
      { label: 'Create', class: 'primary', onclick: async () => { try { await post('api/users', { username: u.value, password: p.value, is_admin: admin.input.checked }); done(); } catch (e) { errToast(e); return false; } } },
    ]);
  };
}

// ---------------------------------------------------------------- about
async function aboutTab(root) {
  const st = await get('api/auth/status');
  root.append(h('div', { class: 'card' },
    h('h3', {}, `Tolle ${st.version}`),
    h('p', {}, st.addon ? 'Running as a Home Assistant add-on.' : isNative ? `Mobile app connected to ${serverUrl()}.` : 'Running as a standalone server (Docker).'),
    h('h3', { style: { marginTop: '16px' } }, 'How your data is protected'),
    h('ul', {},
      h('li', {}, 'All notes, uploads, AI output, reflections, reading history, settings and API keys are encrypted at rest (AES with HMAC, Fernet).'),
      h('li', {}, 'Passwords are hashed with scrypt; only a hash of each sign-in token is stored.'),
      h('li', {}, 'Use HTTPS (Home Assistant Ingress, a reverse proxy, or the built-in TLS option) so data is also encrypted in transit.'),
      h('li', {}, 'Back up the data folder including secret.key – without that key the data cannot be read.')),
    h('p', { class: 'muted' }, `OCR: ${state.ocr.tesseract ? 'available' : 'not installed'} · PDF page rendering: ${state.ocr.pdf_render ? 'available' : 'not installed'}`)));
}
