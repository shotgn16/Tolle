// Tolle setup assistant. Five steps: choose how Tolle runs → details & AI → your account → do the work → done.
// The real work is done by the bundled server program (window.tolle.* talks to the main process).
'use strict';

const $page = document.getElementById('page');
const $back = document.getElementById('back');
const $next = document.getElementById('next');

const MODES = [
  { id: 'personal', ic: '👤', title: 'Just me, on this computer',
    text: 'The simplest choice. Tolle runs while the app is open and nothing else can reach it.' },
  { id: 'shared', ic: '📱', title: 'Me, on this computer and my phone',
    text: 'Tolle keeps running quietly in the background so your phone or tablet can connect over your home network.',
    tag: 'Most popular' },
  { id: 'server', ic: '🏠', title: 'A server for my family, group or church',
    text: 'Runs as a background service from start-up, even when nobody is logged in. Each person gets their own account. Needs an administrator password.' },
  { id: 'docker', ic: '🐳', title: 'Install it in Docker',
    text: 'Runs Tolle in a Docker container, on this computer or on another machine you can reach over SSH.' },
  { id: 'homeassistant', ic: '🏡', title: 'Install it in Home Assistant',
    text: 'Adds Tolle to Home Assistant as an app (formerly called an add-on), with its own sidebar panel.' },
  { id: 'remote', ic: '🔗', title: 'Connect to Tolle that\'s already running',
    text: 'Someone has already set Tolle up (on a server, Docker or Home Assistant). Just enter its address.' },
];

const state = {
  step: 0, mode: null, port: 8099, info: null, platform: null,
  ai: 'install', vision: false, startAtLogin: true,
  ollamaUrl: 'http://192.168.1.50:11434', ollamaModel: '', cloud: 'openai', cloudKey: '',
  user: '', pass: '', pass2: '', existing: false, aiNote: '', prevMode: null,
  dockerWhere: 'local', dockerHost: '', dockerOllama: true,
  haUrl: 'http://homeassistant.local:8123', haToken: '',
  remoteUrl: '', result: null, error: null,
};

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return e;
}

function input(type, value, onInput, attrs = {}) {
  return el('input', { type, value: value ?? '', ...attrs,
    oninput: (e) => { onInput(e.target.value); document.querySelector('.card.error.inline')?.remove(); } });
}

function radio(name, value, current, label, small, onPick) {
  return el('label', { class: 'radio' },
    el('input', { type: 'radio', name, value, checked: value === current, onchange: () => onPick(value) }),
    el('span', {}, label, small ? el('small', {}, small) : null));
}

function check(checked, label, small, onToggle) {
  return el('label', { class: 'radio' },
    el('input', { type: 'checkbox', checked, onchange: (e) => onToggle(e.target.checked) }),
    el('span', {}, label, small ? el('small', {}, small) : null));
}

function field(label, control, hint) {
  return el('div', { class: 'field' }, el('label', {}, label), control, hint ? el('div', { class: 'hint' }, hint) : null);
}

function setSteps() {
  document.querySelectorAll('.steps span').forEach((s, i) => s.classList.toggle('on', i <= state.step));
}

// ---------------------------------------------------------------- step 1: choose
function stepChoose() {
  $page.replaceChildren(
    el('h1', {}, 'How would you like to use Tolle?'),
    el('p', { class: 'lead' }, 'You can change this later from the Tolle menu → Run setup again.'),
    el('div', { class: 'choices' }, MODES.map((m) => el('button', {
      type: 'button', class: `choice${state.mode === m.id ? ' on' : ''}`, 'aria-pressed': String(state.mode === m.id),
      onclick: () => { state.mode = m.id; render(); },
    }, el('span', { class: 'ic' }, m.ic), el('span', {}, el('strong', {}, m.title), el('small', {}, m.text),
      m.tag ? el('span', { class: 'tag' }, m.tag) : null)))));
  $back.hidden = true;
  $next.textContent = 'Continue';
  $next.disabled = !state.mode;
}

// ---------------------------------------------------------------- step 2: details
const CLOUD = { openai: 'OpenAI (ChatGPT)', gemini: 'Google Gemini', anthropic: 'Anthropic Claude' };
const CLOUD_KEY_HELP = {
  openai: 'Create a key at platform.openai.com → API keys.',
  gemini: 'Create a free key at aistudio.google.com → Get API key.',
  anthropic: 'Create a key at console.anthropic.com → API keys.',
};

function aiCard({ local = true } = {}) {
  const rec = state.info?.recommend || { text_model: 'qwen3:8b', ram_gb: '?', vision_model: 'gemma3:4b' };
  const running = state.info?.ollama;
  if (!local && state.ai === 'install') state.ai = 'cloud';
  const pick = (v) => { state.ai = v; render(); };
  return el('div', { class: 'card' },
    el('h2', { class: 'mt0' }, 'AI'),
    el('p', { class: 'hint mt0' }, 'Tolle\'s studies and insights need an AI model. A local model is free and completely private; a cloud AI is faster on small computers.'),
    local ? radio('ai', 'install', state.ai, running ? `Use Ollama on this computer and download ${rec.text_model}` : `Install Ollama on this computer and download ${rec.text_model}`,
      `Free and private. Recommended for this computer's ${rec.ram_gb} GB of memory; a one-off download of a few gigabytes.`, pick) : null,
    state.ai === 'install' && local ? el('div', { class: 'indent' },
      check(state.vision, `Also download ${rec.vision_model} to read photos of handwritten notes`, 'About 3 GB more.', (v) => { state.vision = v; })) : null,
    radio('ai', 'ollama', state.ai, 'Use Ollama on another computer', 'For example a PC with a good graphics card on your network.', pick),
    state.ai === 'ollama' ? el('div', { class: 'indent' },
      field('Ollama address', input('url', state.ollamaUrl, (v) => { state.ollamaUrl = v.trim(); }), 'Ollama on that computer must accept network connections (OLLAMA_HOST=0.0.0.0).'),
      field('Model (optional)', input('text', state.ollamaModel, (v) => { state.ollamaModel = v.trim(); }, { placeholder: rec.text_model }), 'Leave empty to use the first model Ollama has.')) : null,
    radio('ai', 'cloud', state.ai, 'Use ChatGPT, Gemini or Claude', 'You need an API key from the provider. Usage is billed by them (Gemini has a free tier).', pick),
    state.ai === 'cloud' ? el('div', { class: 'indent' },
      field('Provider', el('select', { onchange: (e) => { state.cloud = e.target.value; render(); } },
        Object.entries(CLOUD).map(([k, v]) => el('option', { value: k, selected: k === state.cloud }, v)))),
      field('API key', input('password', state.cloudKey, (v) => { state.cloudKey = v.trim(); }, { autocomplete: 'off' }), CLOUD_KEY_HELP[state.cloud] + ' It\'s stored encrypted in Tolle.')) : null,
    radio('ai', 'later', state.ai, 'I\'ll choose later in Tolle\'s settings', 'You can also use an on-device model that runs inside the app.', pick));
}

function portField() {
  return field('Network port', input('number', state.port, (v) => { state.port = parseInt(v, 10) || 8099; }, { min: 1024, max: 65535, class: 'narrow' }),
    'Leave this as 8099 unless something else already uses it.');
}

function stepDetails() {
  const m = state.mode;
  const parts = [];
  if (m === 'personal' || m === 'shared' || m === 'server') {
    parts.push(el('h1', {}, MODES.find((x) => x.id === m).title));
    if (m === 'shared') {
      parts.push(el('p', { class: 'lead' }, 'Tolle will keep running in the background (look for its icon in the system tray or menu bar). Your phone needs to be on the same network, or reach this computer some other way.'));
    } else if (m === 'server') {
      parts.push(el('p', { class: 'lead' }, 'Tolle will be installed as a service that starts with the computer. You\'ll be asked for an administrator password. The first account you create becomes the administrator, who can add everyone else.'));
    } else {
      parts.push(el('p', { class: 'lead' }, 'Tolle will run only while this app is open, and only this computer can reach it.'));
    }
    parts.push(aiCard());
    const extra = el('div', { class: 'card' });
    if (m !== 'personal') extra.append(portField());
    if (m === 'shared') extra.append(check(state.startAtLogin, 'Start Tolle when I log in', 'So your phone can always connect.', (v) => { state.startAtLogin = v; }));
    if (extra.childElementCount) parts.push(extra);
  }
  if (m === 'docker') {
    const d = state.info?.docker || {};
    parts.push(el('h1', {}, 'Install in Docker'),
      el('p', { class: 'lead' }, 'Tolle will be set up with Docker Compose. The settings file is kept so you can manage it later.'));
    if (!d.installed) {
      parts.push(el('div', { class: 'card error' }, el('strong', {}, 'Docker isn\'t installed on this computer.'),
        el('p', {}, 'Install Docker Desktop, start it, then come back – or install on another machine over SSH below.'),
        el('button', { class: 'btn', type: 'button', onclick: () => window.tolle.open('https://www.docker.com/products/docker-desktop/') }, 'Get Docker Desktop')));
    } else if (!d.running) {
      parts.push(el('div', { class: 'card error' }, el('strong', {}, 'Docker is installed but not running.'), el('p', {}, 'Start Docker Desktop, wait until it says it\'s running, then press Continue.')));
    }
    parts.push(el('div', { class: 'card' },
      radio('where', 'local', state.dockerWhere, 'On this computer', null, (v) => { state.dockerWhere = v; render(); }),
      radio('where', 'ssh', state.dockerWhere, 'On another machine, over SSH', 'That machine needs Docker, and this computer needs an SSH key for it.', (v) => { state.dockerWhere = v; render(); }),
      state.dockerWhere === 'ssh' ? field('Docker host', input('text', state.dockerHost, (v) => { state.dockerHost = v.trim(); }, { placeholder: 'ssh://me@myserver' })) : null,
      portField(),
      check(state.dockerOllama, `Also run Ollama in Docker and download ${state.info?.recommend?.text_model || 'a model'}`, 'Private, local AI next to Tolle. Uses the CPU unless you set up GPU support in Docker.', (v) => { state.dockerOllama = v; render(); })));
    if (!state.dockerOllama) parts.push(aiCard({ local: false }));
  }
  if (m === 'homeassistant') {
    parts.push(el('h1', {}, 'Install in Home Assistant'),
      el('p', { class: 'lead' }, 'Works with Home Assistant OS and Supervised installs. Tolle is added as an app with a sidebar panel; the port lets phones and this app connect directly.'),
      el('div', { class: 'card' },
        field('Home Assistant address', input('url', state.haUrl, (v) => { state.haUrl = v.trim(); })),
        field('Long-lived access token', input('password', state.haToken, (v) => { state.haToken = v.trim(); }, { autocomplete: 'off' }),
          'In Home Assistant, signed in as an administrator: click your name (bottom left) → Security → Long-lived access tokens → Create token. The token is only used for this install and isn\'t saved.'),
        portField()),
      aiCard({ local: false }));
  }
  if (m === 'remote') {
    parts.push(el('h1', {}, 'Connect to Tolle'),
      el('p', { class: 'lead' }, 'Enter the address of the Tolle server, for example http://192.168.1.20:8099 or https://tolle.example.com.'),
      el('div', { class: 'card' }, field('Server address', input('url', state.remoteUrl, (v) => { state.remoteUrl = v.trim(); }, { placeholder: 'http://192.168.1.20:8099' }))));
  }
  $page.replaceChildren(...parts);
  $back.hidden = false;
  $next.textContent = m === 'remote' ? 'Connect' : 'Continue';
  $next.disabled = false;
}

// ---------------------------------------------------------------- step 3: account
function stepAccount() {
  $page.replaceChildren(
    el('h1', {}, 'Your account'),
    el('p', { class: 'lead' }, 'Everything you store in Tolle is encrypted and protected by this account. ' +
      (state.mode === 'server' || state.mode === 'docker' || state.mode === 'homeassistant'
        ? 'This first account is the administrator; you can add everyone else in Settings → Account.'
        : 'You\'ll use it to sign in on your phone too.')),
    el('div', { class: 'card' },
      check(state.existing, 'Tolle is already set up there – sign in with an existing account instead', 'Choose this if you\'re running setup again.', (v) => { state.existing = v; render(); }),
      field('Username', input('text', state.user, (v) => { state.user = v.trim(); }, { autocomplete: 'username', autocapitalize: 'none' })),
      field('Password', input('password', state.pass, (v) => { state.pass = v; }, { autocomplete: state.existing ? 'current-password' : 'new-password' }),
        state.existing ? null : 'At least 8 characters. There\'s no password reset by email, so keep it somewhere safe.'),
      state.existing ? null : field('Confirm password', input('password', state.pass2, (v) => { state.pass2 = v; }, { autocomplete: 'new-password' }))));
  $back.hidden = false;
  $next.textContent = 'Install';
  $next.disabled = false;
}

function accountProblem() {
  if (state.user.length < 2) return 'Choose a username (at least 2 characters).';
  if (!state.existing && state.pass.length < 8) return 'The password needs at least 8 characters.';
  if (!state.existing && state.pass !== state.pass2) return 'The two passwords don\'t match.';
  if (state.existing && !state.pass) return 'Enter your password.';
  return null;
}

// ---------------------------------------------------------------- step 3: work
function stepWork() {
  const bar = el('div', { class: 'bar busy' }, el('div'));
  const status = el('p', { class: 'lead mb4' }, 'Getting started…');
  const log = el('ul', { class: 'log' });
  $page.replaceChildren(el('h1', {}, 'Setting things up'), status, bar, el('div', { class: 'card' }, log));
  $back.hidden = true;
  $next.disabled = true;
  $next.textContent = 'Please wait…';

  const addLine = (text, cls = '') => { log.append(el('li', {}, el('span', { class: cls }, cls === 'ok' ? '✓' : cls === 'err' ? '✗' : '•'), el('span', {}, text))); };
  let lastLine = null;
  const stop = window.tolle.onProgress((ev) => {
    status.textContent = ev.message;
    if (ev.percent != null) { bar.classList.remove('busy'); bar.firstChild.style.width = `${ev.percent}%`; } else bar.classList.add('busy');
    const short = ev.message.replace(/\s+\d+%$/, '');
    if (short !== lastLine && ev.percent == null) { addLine(ev.message); lastLine = short; }
  });

  const step = async (label, fn) => {
    status.textContent = label;
    bar.classList.add('busy');
    const r = await fn();
    addLine(label.replace(/…$/, ''), 'ok');
    return r;
  };

  doWork(step).then((result) => {
    stop();
    state.result = result;
    state.step = 4;
    render();
  }).catch((err) => {
    stop();
    bar.classList.remove('busy');
    addLine(err.message || String(err), 'err');
    status.textContent = 'Something went wrong.';
    $page.append(el('div', { class: 'card error' }, el('strong', {}, err.message || String(err)),
      err.hint ? el('p', {}, err.hint) : null));
    $back.hidden = false;
    $next.disabled = false;
    $next.textContent = 'Try again';
    state.error = err;
  });
}

async function doWork(step) {
  const t = window.tolle;
  const rec = state.info?.recommend || {};
  const linux = state.platform?.platform === 'linux';
  const m = state.mode;

  if (state.prevMode === 'server' && m !== 'server') {
    await step('Removing the old background service (you\'ll be asked for an administrator password)…', () =>
      t.runElevated([['service', 'uninstall', '--scope', 'system']]));
    state.prevMode = null;
  }

  if (m === 'remote') {
    let url = state.remoteUrl.replace(/\/+$/, '');
    if (url && !/^https?:\/\//.test(url)) url = `http://${url}`;
    await step('Checking the address…', async () => {
      const r = await t.api({ url: `${url}/api/health` });
      if (!r.ok) throw new Error(`Tolle didn't answer at ${url}. Check the address and that this computer can reach it.`);
    });
    return { mode: 'remote', url };
  }
  if (m === 'homeassistant') {
    if (!state.haToken) throw new Error('Paste a long-lived access token first.');
    const r = await step('Installing the Tolle app in Home Assistant…', () =>
      t.run(['homeassistant', 'install', '--url', state.haUrl, '--port', String(state.port)], { TOLLE_HA_TOKEN: state.haToken }));
    state.haToken = '';
    const token = await accountAndAI(step, r.url, { local: false });
    return { mode: 'homeassistant', url: r.url, sidebar: r.sidebar, token };
  }
  if (m === 'docker') {
    const args = ['docker', 'install', '--port', String(state.port)];
    if (state.dockerWhere === 'ssh') {
      if (!/^ssh:\/\//.test(state.dockerHost)) throw new Error('Enter the Docker host as ssh://user@machine.');
      args.push('--docker-host', state.dockerHost);
    }
    if (state.dockerOllama) args.push('--with-ollama', '--model', rec.text_model || 'qwen3:4b');
    const r = await step('Installing Tolle in Docker…', () => t.run(args));
    const token = await accountAndAI(step, r.url, { local: false, dockerOllama: state.dockerOllama });
    return { mode: 'docker', url: r.url, token };
  }

  // personal / shared / server: Tolle runs on this computer
  const aiArgs = [];
  if (state.ai === 'install') {
    if (!state.info?.ollama) {
      if (linux) await step('Installing Ollama (you\'ll be asked for your password)…', () => t.runElevated([['ollama', 'install']]));
      else await step('Installing Ollama…', () => t.run(['ollama', 'install']));
    }
    await step(`Downloading ${rec.text_model}…`, () => t.run(['ollama', 'pull', rec.text_model]));
    if (state.vision) await step(`Downloading ${rec.vision_model}…`, () => t.run(['ollama', 'pull', rec.vision_model]));
    aiArgs.push('--ai-provider', 'ollama', '--ollama-url', 'http://127.0.0.1:11434', '--ai-model', rec.text_model, '--context', String(rec.context || 16384));
  }
  const configure = ['configure', '--mode', m, '--port', String(m === 'personal' ? 8099 : state.port), ...aiArgs];
  if (m === 'server') {
    await step('Installing the Tolle service (you\'ll be asked for an administrator password)…', () => t.runElevated([
      configure,
      ['service', 'install', '--scope', 'system', '--port', String(state.port), ...(state.platform.platform === 'win32' ? [] : ['--run-as', state.platform.user])],
    ]));
    await step('Waiting for the service to start…', async () => {
      for (let i = 0; i < 40; i += 1) {
        const r = await fetch(`http://127.0.0.1:${state.port}/api/health`).catch(() => null);
        if (r && r.ok) return;
        await new Promise((res) => setTimeout(res, 1000));
      }
      throw new Error('The service was installed but isn\'t answering yet. Restart the computer, then open Tolle again.');
    });
  } else {
    await step('Saving your choices…', () => t.run(configure));
    await step('Starting Tolle…', () => t.startLocal({ mode: m, port: m === 'personal' ? 8099 : state.port }));
  }
  const port = m === 'personal' ? 8099 : state.port;
  const token = await accountAndAI(step, `http://127.0.0.1:${port}`, { local: true });
  return { mode: m, port, token };
}

// Create the administrator account (or sign in), then save the AI choice to it.
async function accountAndAI(step, url, { local, dockerOllama = false }) {
  const t = window.tolle;
  const call = async (method, path, body, token) => {
    const r = await t.api({ method, url: `${url}/${path}`, body, token });
    if (!r.ok) {
      const d = r.data && r.data.detail ? r.data.detail : `HTTP ${r.status}`;
      throw Object.assign(new Error(typeof d === 'string' ? d : JSON.stringify(d)), { status: r.status });
    }
    return r.data;
  };
  const token = await step(state.existing ? 'Signing in…' : 'Creating your account…', async () => {
    const st = await call('GET', 'api/auth/status');
    if (st.needs_setup) return (await call('POST', 'api/auth/setup', { username: state.user, password: state.pass })).token;
    try {
      return (await call('POST', 'api/auth/login', { username: state.user, password: state.pass })).token;
    } catch (e) {
      throw new Error(state.existing ? `Couldn't sign in: ${e.message}`
        : 'Tolle already has accounts there. Go back, tick “sign in with an existing account”, and use that account.');
    }
  });

  const rec = state.info?.recommend || {};
  let values = null;
  if (dockerOllama) values = { 'ai.provider': 'ollama', 'ollama.url': 'http://ollama:11434', 'ai.model': rec.text_model || 'qwen3:4b' };
  else if (state.ai === 'install' && local) values = { 'ai.provider': 'ollama', 'ollama.url': 'http://127.0.0.1:11434', 'ai.model': rec.text_model, 'ollama.num_ctx': rec.context || 16384 };
  else if (state.ai === 'ollama') values = { 'ai.provider': 'ollama', 'ollama.url': state.ollamaUrl.replace(/\/+$/, ''), 'ai.model': state.ollamaModel };
  else if (state.ai === 'cloud' && state.cloudKey) values = { 'ai.provider': state.cloud, [`${state.cloud}.key`]: state.cloudKey };
  if (!values) return token;

  await step('Setting up the AI…', async () => {
    await call('PUT', 'api/settings', values, token);
    if (values['ai.model']) return;
    // No model chosen yet – pick a sensible one from what the provider offers.
    try {
      const { models } = await call('GET', `api/ai/models?provider=${values['ai.provider']}`, undefined, token);
      const ids = models.map((x) => x.id);
      const prefs = { openai: [/^gpt-5-mini$/, /^gpt-5$/, /^gpt-4\.1-mini$/, /^gpt-4o-mini$/, /^gpt/], gemini: [/flash$/, /flash/, /pro/],
        anthropic: [/sonnet/, /haiku/, /opus/], ollama: [/./] }[values['ai.provider']] || [/./];
      const chosen = prefs.map((re) => ids.find((id) => re.test(id))).find(Boolean) || ids[0];
      if (chosen) { await call('PUT', 'api/settings', { 'ai.model': chosen }, token); state.aiNote = `AI: ${chosen}. You can change it in Settings → AI.`; }
    } catch (e) {
      state.aiNote = `Couldn't list the AI models (${e.message}). Choose one in Settings → AI.`;
    }
  });
  state.cloudKey = '';
  return token;
}

// ---------------------------------------------------------------- step 4: done
function stepDone() {
  const r = state.result;
  const parts = [el('h1', {}, 'Tolle is ready'),
    el('p', { class: 'lead' }, r.mode === 'remote' ? 'Sign in with your account when Tolle opens.' : `You're signed in as ${state.user}.`)];
  if (r.mode === 'shared' || r.mode === 'server') {
    const lan = state.info?.lan || [];
    parts.push(el('div', { class: 'card' }, el('h2', { class: 'mt0' }, 'Connecting phones and other computers'),
      el('p', {}, 'Use this address in the Tolle phone app, or in any browser on your network:'),
      ...lan.map((ip) => el('div', { class: 'addr' }, `http://${ip}:${r.port}`)),
      el('p', { class: 'hint' }, 'Later, choose Tolle → “Connect a phone or tablet…” to show a code your phone can scan.')));
  }
  if (r.mode === 'docker' || r.mode === 'homeassistant') {
    parts.push(el('div', { class: 'card' }, el('p', { class: 'mt0' }, 'Tolle is running at:'), el('div', { class: 'addr' }, r.url),
      r.sidebar ? el('p', { class: 'hint' }, 'It\'s also in the Home Assistant sidebar.') : null,
      el('p', { class: 'hint' }, 'Phones and other computers on your network can use the same address.')));
  }
  if (state.aiNote) parts.push(el('div', { class: 'card' }, el('p', { class: 'm0' }, state.aiNote)));
  else if (state.ai === 'later' && r.mode !== 'remote' && !(r.mode === 'docker' && state.dockerOllama)) {
    parts.push(el('div', { class: 'card' }, el('p', { class: 'm0' }, 'Remember to choose an AI in Tolle → Settings → AI.')));
  }
  $page.replaceChildren(...parts);
  $back.hidden = true;
  $next.disabled = false;
  $next.textContent = 'Open Tolle';
}

// ---------------------------------------------------------------- navigation
// Steps: 0 choose · 1 details · 2 account · 3 work · 4 done ("remote" skips the account step)
const STEPS = [stepChoose, stepDetails, stepAccount, stepWork, stepDone];

function render() {
  setSteps();
  STEPS[state.step]();
}

function detailsProblem() {
  if (state.mode === 'homeassistant' && !state.haToken) return 'Paste a long-lived access token from Home Assistant.';
  if (state.mode === 'remote' && !state.remoteUrl) return 'Enter the server address.';
  if (state.mode === 'docker' && state.dockerWhere === 'ssh' && !/^ssh:\/\//.test(state.dockerHost)) return 'Enter the Docker host as ssh://user@machine.';
  if (state.ai === 'cloud' && !state.cloudKey && state.mode !== 'remote' && !(state.mode === 'docker' && state.dockerOllama)) return 'Paste an API key, or choose another AI option.';
  return null;
}

function complain(message) {
  document.querySelector('.card.error.inline')?.remove();
  $page.append(el('div', { class: 'card error inline' }, el('strong', {}, message)));
  $page.lastChild.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

$next.addEventListener('click', async () => {
  if (state.step === 0) {
    state.step = 1;
    if (state.mode === 'docker') state.info = await window.tolle.info().catch(() => state.info);
    return render();
  }
  if (state.step === 1) {
    const p = detailsProblem();
    if (p) return complain(p);
    state.step = state.mode === 'remote' ? 3 : 2;
    return render();
  }
  if (state.step === 2) {
    const p = accountProblem();
    if (p) return complain(p);
    state.step = 3; return render();
  }
  if (state.step === 3) { state.error = null; return render(); } // "Try again"
  if (state.step === 4) {
    const r = state.result;
    $next.disabled = true;
    await window.tolle.finish({ mode: r.mode, port: r.port, url: r.url, token: r.token, startAtLogin: state.startAtLogin });
  }
});
$back.addEventListener('click', () => {
  if (state.step === 3) state.step = state.mode === 'remote' ? 1 : 2;
  else state.step = Math.max(0, state.step - 1);
  render();
});

(async () => {
  render();
  state.platform = await window.tolle.platform();
  const current = await window.tolle.current();
  if (current?.mode) {
    state.mode = current.mode; state.prevMode = current.mode; state.port = current.port || 8099; state.remoteUrl = current.url || '';
    state.existing = current.setupDone === true;
    render();
  }
  try { state.info = await window.tolle.info(); } catch { /* shown later if it matters */ }
  if (state.step === 1) render();
})();
