// Settings → Reading: reminder, goal, time zone and time in the YouVersion app.
import { get, isNative, mode, post, serverUrl } from '../../core/api.js';
import { confirmDialog, errToast, field, h, saveSettings, state, switchEl } from '../../core/ui.js';

export function readingSettingsTab(root) {
  const s = state.settings;
  const vals = {};
  const remEnabled = switchEl('Remind me if I haven’t read by…', s['tracker.reminder_enabled'], (v) => { vals['tracker.reminder_enabled'] = v; });
  const remTime = h('input', { type: 'time', value: s['tracker.reminder_time'], style: { maxWidth: '160px' } });
  remTime.addEventListener('input', () => { vals['tracker.reminder_time'] = remTime.value; });
  const goal = h('input', { type: 'number', min: 1, value: s['tracker.daily_goal_minutes'], style: { maxWidth: '160px' } });
  goal.addEventListener('input', () => { vals['tracker.daily_goal_minutes'] = +goal.value; });
  const tz = h('input', { value: s['tracker.timezone'] });
  tz.addEventListener('input', () => { vals['tracker.timezone'] = tz.value; vals['tracker.timezone_auto'] = false; });

  root.append(
    h('div', { class: 'card' },
      h('h3', {}, 'Reading reminder'),
      remEnabled, h('div', { style: { margin: '10px 0' } }, remTime),
      h('div', { class: 'grid two' }, field('Daily reading goal (minutes)', goal), field('Time zone', tz, 'Follows your device automatically unless you change it.')),
      externalApps(vals)),
    mode.device() ? deviceBibleAppCard() : bibleAppCard(vals),
    h('button', { class: 'primary', onclick: () => saveSettings(vals) }, 'Save'));
}

// Running on its own the app has no web address for Home Assistant or Shortcuts to call.
function deviceBibleAppCard() {
  return h('div', { class: 'card' },
    h('h3', {}, 'Time in the YouVersion app'),
    h('p', {}, window.Capacitor?.Plugins?.BibleUsage
      ? 'On Android, Tolle can measure time in YouVersion using the list above. After a session it asks which chapter you read.'
      : 'Log what you read in another Bible app from the Reading tracker.'),
    h('p', { class: 'hint' }, 'Logging YouVersion through Home Assistant or iPhone Shortcuts needs a Tolle server, because they send the time to its web address.'));
}

function bibleAppCard(vals) {
  const s = state.settings;
  let picked = new Set(s['tracker.ha_app_sensors'] || []);
  const sensorWrap = h('div', { class: 'grid two' }, h('small', { class: 'muted' }, 'Looking for phones…'));
  get('api/tracker/ha-app-sensors').then((r) => {
    sensorWrap.replaceChildren(...(r.sensors.length ? r.sensors.map((x) => h('label', { class: 'switch' },
      h('input', { type: 'checkbox', checked: picked.has(x.entity_id), onchange: (e) => { e.target.checked ? picked.add(x.entity_id) : picked.delete(x.entity_id); vals['tracker.ha_app_sensors'] = [...picked]; } }),
      h('span', {}, x.name, h('div', { class: 'hint' }, x.screen_sensor ? 'Screen on/off sensor found ✓' : 'No screen on/off sensor – sessions are less accurate'))))
      : [h('small', { class: 'muted' }, state.addon
        ? 'No phones found. In the Home Assistant Companion app, turn on the “Last used app” and “Interactive” sensors.'
        : 'Connect Home Assistant in Settings → Devices & notifications, then turn on the Companion app’s “Last used app” and “Interactive” sensors.')]));
  }).catch((e) => sensorWrap.replaceChildren(h('small', { class: 'muted' }, e.message)));
  const match = h('input', { value: s['tracker.app_match'] });
  match.addEventListener('input', () => { vals['tracker.app_match'] = match.value.trim(); });
  const minSecs = h('input', { type: 'number', min: 0, value: s['tracker.min_session_seconds'], style: { maxWidth: '160px' } });
  minSecs.addEventListener('input', () => { vals['tracker.min_session_seconds'] = +minSecs.value; });
  const ask = switchEl('Ask “What did you read?” after a session', s['tracker.ask_after_session'], (v) => { vals['tracker.ask_after_session'] = v; });

  const keyBox = h('code', {}, '••••••••');
  const base = (isNative ? serverUrl() : location.origin + location.pathname.replace(/\/$/, '')).replace(/\/$/, '');
  const showKey = async (fresh) => {
    const r = fresh ? await post('api/me/api-key') : await get('api/me/api-key');
    keyBox.textContent = r.key;
  };
  return h('div', { class: 'card kbd-help' },
    h('h3', {}, 'Time in the YouVersion app'),
    h('p', {}, 'Tolle can log time spent in the YouVersion Bible app automatically, then ask which passage you read.'),
    h('h3', { style: { marginTop: '14px' } }, 'Android, through Home Assistant'),
    h('p', { class: 'muted' }, 'In the Companion app: Settings → Companion app → Manage sensors → turn on “Last used app” and “Interactive”. Then tick your phone:'),
    sensorWrap,
    h('div', { class: 'grid two', style: { marginTop: '12px' } },
      field('App identifier', match, 'YouVersion on Android is com.sirma.mobile.bible.android'),
      field('Ignore visits shorter than (seconds)', minSecs)),
    ask,
    h('h3', { style: { marginTop: '20px' } }, 'iPhone, with Shortcuts'),
    h('p', { class: 'muted' }, 'Shortcuts → Automation → + → App → Bible → “Is Opened” → Run Immediately, then add “Get Contents of URL”:'),
    h('ul', {},
      h('li', {}, 'URL: ', h('code', {}, `${base}/api/v1/bible/app`)),
      h('li', {}, 'Method: POST, Header: ', h('code', {}, 'X-Api-Key'), ' = your key below'),
      h('li', {}, 'Request body: JSON, ', h('code', {}, 'event'), ' = ', h('code', {}, 'opened')),
      h('li', {}, 'Make a second automation for “Is Closed” with ', h('code', {}, 'event'), ' = ', h('code', {}, 'closed'))),
    h('p', { class: 'muted' }, 'To log the exact passage, make a share-sheet shortcut that POSTs ', h('code', {}, 'reference'), ' = Shortcut Input to ',
      h('code', {}, `${base}/api/v1/bible/read`), ', then in YouVersion select verses → Share → your shortcut.'),
    h('div', { class: 'row' }, h('span', {}, 'Your API key: '), keyBox,
      h('button', { class: 'small', onclick: () => showKey(false).catch(errToast) }, 'Show'),
      h('button', { class: 'small ghost', onclick: async () => { if (await confirmDialog('Make a new key? Shortcuts using the old one will stop working.', 'Make new key')) showKey(true).catch(errToast); } }, 'New key')));
}

function externalApps(vals) {
  const apps = state.settings['tracker.external_apps'] || [];
  const ta = h('textarea', { style: { minHeight: '70px' } }, apps.map((a) => `${a.name} = ${a.package}`).join('\n'));
  ta.addEventListener('input', () => {
    vals['tracker.external_apps'] = ta.value.split('\n').map((l) => l.split('=').map((x) => x.trim()))
      .filter(([n, p]) => n && p).map(([name, pkg]) => ({ name, package: pkg }));
  });
  const BU = window.Capacitor?.Plugins?.BibleUsage;
  return h('div', { style: { marginTop: '8px' } },
    field('Other Bible apps to measure (Tolle Android app, optional plugin)', ta,
      'One per line: Name = Android package. Tolle measures time spent in them and asks which chapter you read. Not possible on iOS or in a browser.'),
    BU ? h('button', { class: 'small', onclick: () => BU.openSettings() }, 'Grant usage access') : null);
}
