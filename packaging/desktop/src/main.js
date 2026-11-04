// Tolle desktop app (Electron main process).
//
// The installer puts this app and the bundled Tolle server on the computer. On first launch the
// setup assistant (setup/wizard.html) asks how Tolle should run and does the work:
//
//   personal  – this computer only: the app starts the server while it's open (127.0.0.1)
//   shared    – this computer + phones: the server keeps running in the tray and starts at login
//   server    – several people: the server is installed as a system service (needs admin)
//   docker / homeassistant / remote – the server runs elsewhere; this app connects to it
//
// All setup work is done by the bundled server program's command line (`tolle-server … --json`),
// the same commands people use on headless servers. See tolle/app/server/cli.py.
const { app, BrowserWindow, Menu, Notification, Tray, dialog, ipcMain, nativeImage, net, shell } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sudo = require('@vscode/sudo-prompt');
const QRCode = require('qrcode');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const RELEASES = 'https://github.com/shotgn16/Tolle/releases';
const MANUALS = 'https://github.com/shotgn16/Tolle/tree/main/docs/manual';

// On macOS the server's data folder is ~/Library/Application Support/Tolle; keep this app's own files
// (window state, cache, logs) next to it rather than mixed in.
if (IS_MAC) app.setPath('userData', path.join(app.getPath('appData'), 'Tolle Desktop'));

let mainWin = null;
let setupWin = null;
let pairWin = null;
let tray = null;
let serverProc = null;
let quitting = false;
let pendingToken = null; // session token from the setup assistant, used once

// ---------------------------------------------------------------- settings for this app
const CONFIG_FILE = path.join(app.getPath('userData'), 'desktop.json');
function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { return {}; }
}
function saveConfig(cfg) {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}
let config = loadConfig();

// ---------------------------------------------------------------- the bundled server program
function serverCommand() {
  if (app.isPackaged) {
    return { cmd: path.join(process.resourcesPath, 'server', IS_WIN ? 'tolle-server.exe' : 'tolle-server'), pre: [] };
  }
  // Development: use a local PyInstaller build if there is one, otherwise Python from the source tree.
  const built = path.join(__dirname, '..', '..', '..', 'build', 'server', 'tolle-server', IS_WIN ? 'tolle-server.exe' : 'tolle-server');
  if (fs.existsSync(built)) return { cmd: built, pre: [] };
  return { cmd: IS_WIN ? 'python' : 'python3', pre: ['-m', 'server'], cwd: path.join(__dirname, '..', '..', '..', 'tolle', 'app') };
}

// Run a server command, reporting each JSON line to onEvent. Resolves with the "done" result.
function runCli(args, onEvent = () => {}, extraEnv = {}) {
  const { cmd, pre, cwd } = serverCommand();
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, [...pre, ...args, '--json'], { cwd, env: { ...process.env, ...extraEnv }, windowsHide: true });
    let buf = '';
    let result = null;
    let error = null;
    child.stdout.setEncoding('utf8'); // keeps characters split across chunks intact
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        try {
          const ev = JSON.parse(line);
          if (ev.event === 'done') result = ev;
          else if (ev.event === 'error') error = ev;
          else onEvent(ev);
        } catch { onEvent({ event: 'progress', message: line }); }
      }
    });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => reject({ message: `Couldn't start the Tolle server program: ${e.message}` }));
    child.on('close', (code) => {
      if (result) resolve(result);
      else reject(error || { message: `The step failed (code ${code}). ${stderr.slice(-400)}` });
    });
  });
}

// Run one or more server commands with administrator rights (one password prompt).
function runElevated(commands) {
  const { cmd, pre, cwd } = serverCommand();
  const q = (s) => (IS_WIN ? `"${String(s).replace(/"/g, '\\"')}"` : `'${String(s).replace(/'/g, "'\\''")}'`);
  const line = commands.map((args) => [cmd, ...pre, ...args, '--json'].map(q).join(' ')).join(' && ');
  const full = cwd ? (IS_WIN ? `cd /d ${q(cwd)} && ${line}` : `cd ${q(cwd)} && ${line}`) : line;
  return new Promise((resolve, reject) => {
    sudo.exec(full, { name: 'Tolle' }, (err, stdout) => {
      const events = String(stdout || '').split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      const failed = events.find((e) => e.event === 'error');
      if (failed) return reject(failed);
      if (err) return reject({ message: /did not grant|User did not grant|cancel/i.test(err.message) ? 'Administrator permission was not given.' : err.message });
      resolve(events.filter((e) => e.event === 'done'));
    });
  });
}

async function healthy(url, timeoutMs = 2500) {
  try {
    const r = await net.fetch(`${url}/api/health`, { signal: AbortSignal.timeout(timeoutMs) });
    return r.ok;
  } catch { return false; }
}

async function waitHealthy(url, seconds = 40) {
  for (let i = 0; i < seconds * 2; i += 1) {
    if (await healthy(url, 1000)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function startLocalServer({ restart = false } = {}) {
  const url = `http://127.0.0.1:${config.port || 8099}`;
  if (restart && serverProc) {
    serverProc.intentional = true; serverProc.kill(); serverProc = null;
    for (let i = 0; i < 20 && (await healthy(url, 500)); i += 1) await new Promise((r) => setTimeout(r, 250));
  }
  if (await healthy(url)) return url; // already running (e.g. another window or the service)
  const { cmd, pre, cwd } = serverCommand();
  const logDir = path.join(app.getPath('userData'), 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const log = fs.openSync(path.join(logDir, 'server.log'), 'a');
  serverProc = spawn(cmd, [...pre, 'serve', '--port', String(config.port || 8099), '--mode', config.mode,
    '--host', config.mode === 'personal' ? '127.0.0.1' : '0.0.0.0'], { cwd, stdio: ['ignore', log, log], windowsHide: true });
  const child = serverProc;
  child.on('exit', (code) => {
    if (serverProc === child) serverProc = null;
    if (!quitting && !child.intentional && code) dialog.showErrorBox('Tolle stopped', `The Tolle server stopped unexpectedly (code ${code}). See the log in ${logDir}.`);
  });
  if (!(await waitHealthy(url))) throw new Error(`The Tolle server didn't start. See ${path.join(logDir, 'server.log')}.`);
  return url;
}

// ---------------------------------------------------------------- windows
function iconImage(size) {
  return nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.png')).resize({ width: size, height: size });
}

function openSetup() {
  if (setupWin) return setupWin.focus();
  setupWin = new BrowserWindow({
    width: 860, height: 700, minWidth: 720, minHeight: 600, title: 'Set up Tolle', icon: iconImage(256),
    webPreferences: { preload: path.join(__dirname, 'preload-setup.js'), contextIsolation: true, sandbox: true },
  });
  setupWin.setMenuBarVisibility(false);
  setupWin.loadFile(path.join(__dirname, '..', 'setup', 'wizard.html'));
  setupWin.on('closed', () => { setupWin = null; if (!config.setupDone && !mainWin) app.quit(); });
}

async function openMain({ show = true } = {}) {
  let url;
  try {
    if (['personal', 'shared'].includes(config.mode)) url = await startLocalServer();
    else if (config.mode === 'server') {
      url = `http://127.0.0.1:${config.port || 8099}`;
      if (!(await waitHealthy(url, 20))) throw new Error('The Tolle service on this computer isn\'t answering. Restart the computer, or run setup again.');
    } else url = config.url;
  } catch (e) {
    const r = await dialog.showMessageBox({ type: 'error', message: e.message, buttons: ['Run setup again', 'Quit'] });
    if (r.response === 0) return openSetup();
    return app.quit();
  }
  if (!mainWin) {
    mainWin = new BrowserWindow({
      width: 1280, height: 860, minWidth: 380, minHeight: 500, show: false, title: 'Tolle', icon: iconImage(256),
      webPreferences: { preload: path.join(__dirname, 'preload-main.js'), contextIsolation: true, sandbox: true },
    });
    mainWin.webContents.setWindowOpenHandler(({ url: target }) => { shell.openExternal(target); return { action: 'deny' }; });
    mainWin.on('close', (e) => {
      if (!quitting && config.mode === 'shared') { e.preventDefault(); mainWin.hide(); }
    });
    mainWin.on('closed', () => { mainWin = null; });
  }
  await mainWin.loadURL(url);
  if (pendingToken) {
    // Sign in with the account the setup assistant just created.
    const t = JSON.stringify(pendingToken);
    pendingToken = null;
    await mainWin.webContents.executeJavaScript(`try { localStorage.setItem('tolle.token', ${t}); } catch (e) {}`);
    await mainWin.loadURL(url);
  }
  if (show) mainWin.show();
  buildTray();
}

async function openPairing() {
  if (pairWin) return pairWin.focus();
  pairWin = new BrowserWindow({
    width: 520, height: 640, resizable: false, title: 'Connect a phone or tablet', icon: iconImage(256),
    webPreferences: { preload: path.join(__dirname, 'preload-setup.js'), contextIsolation: true, sandbox: true },
  });
  pairWin.setMenuBarVisibility(false);
  pairWin.loadFile(path.join(__dirname, '..', 'setup', 'pair.html'));
  pairWin.on('closed', () => { pairWin = null; });
}

// ---------------------------------------------------------------- tray, menu, login item
function setStartAtLogin(on) {
  config.startAtLogin = on;
  saveConfig(config);
  if (IS_WIN || IS_MAC) {
    app.setLoginItemSettings({ openAtLogin: on, openAsHidden: true, args: ['--hidden'] });
  } else {
    const dir = path.join(os.homedir(), '.config', 'autostart');
    const file = path.join(dir, 'tolle.desktop');
    if (on) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, `[Desktop Entry]\nType=Application\nName=Tolle\nExec="${process.env.APPIMAGE || process.execPath}" --hidden\nX-GNOME-Autostart-enabled=true\n`);
    } else fs.rmSync(file, { force: true });
  }
}

function buildTray() {
  if (config.mode !== 'shared') { if (tray) { tray.destroy(); tray = null; } return; }
  if (!tray) {
    tray = new Tray(iconImage(IS_MAC ? 18 : 24));
    tray.setToolTip('Tolle is running');
    tray.on('click', () => mainWin && mainWin.show());
  }
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Tolle', click: () => (mainWin ? mainWin.show() : openMain()) },
    { label: 'Connect a phone or tablet…', click: openPairing },
    { type: 'separator' },
    { label: 'Start Tolle when I log in', type: 'checkbox', checked: !!config.startAtLogin, click: (i) => setStartAtLogin(i.checked) },
    { type: 'separator' },
    { label: 'Quit Tolle (phones will disconnect)', click: () => { quitting = true; app.quit(); } },
  ]));
}

function buildMenu() {
  const template = [
    ...(IS_MAC ? [{ role: 'appMenu' }] : []),
    {
      label: 'Tolle',
      submenu: [
        { label: 'Connect a phone or tablet…', click: openPairing },
        { label: 'Run setup again…', click: openSetup },
        { label: 'Open data folder', click: () => runCli(['info']).then((i) => shell.openPath(i.data_dir)).catch(() => {}) },
        { type: 'separator' },
        { label: 'Check for updates', click: () => checkForUpdates(true) },
        ...(IS_MAC ? [] : [{ type: 'separator' }, { role: 'quit', click: () => { quitting = true; app.quit(); } }]),
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    { label: 'Help', submenu: [{ label: 'User manuals', click: () => shell.openExternal(MANUALS) },
      { label: 'Releases and downloads', click: () => shell.openExternal(RELEASES) }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Updates come from GitHub Releases. Windows and the Linux AppImage update themselves (download in the
// background, install on restart). The Mac app isn't code-signed, and .deb installs are managed by the
// system, so those just get a notification with a link.
function canSelfUpdate() {
  return app.isPackaged && (IS_WIN || (process.platform === 'linux' && !!process.env.APPIMAGE));
}

async function checkForUpdates(manual = false) {
  if (canSelfUpdate()) {
    try {
      const { autoUpdater } = require('electron-updater');
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true;
      autoUpdater.removeAllListeners();
      autoUpdater.on('update-downloaded', async (info) => {
        const r = await dialog.showMessageBox({ type: 'info', buttons: ['Restart now', 'Later'], defaultId: 0,
          message: `Tolle ${info.version} is ready to install.`, detail: 'Restart Tolle to finish updating. Your data is kept.' });
        if (r.response === 0) { quitting = true; autoUpdater.quitAndInstall(); }
      });
      const res = await autoUpdater.checkForUpdates();
      if (manual && (!res || !res.isUpdateAvailable)) dialog.showMessageBox({ message: `You have the latest version (${app.getVersion()}).` });
      else if (manual) dialog.showMessageBox({ message: `Downloading Tolle ${res.updateInfo.version}… You'll be asked to restart when it's ready.` });
      return;
    } catch (e) {
      if (manual) dialog.showMessageBox({ message: `Couldn't check for updates: ${e.message}` });
      return;
    }
  }
  try {
    const r = await net.fetch('https://api.github.com/repos/shotgn16/Tolle/releases/latest', { headers: { Accept: 'application/vnd.github+json' } });
    const latest = (await r.json()).tag_name?.replace(/^v/, '');
    const newer = latest && latest.localeCompare(app.getVersion(), undefined, { numeric: true }) > 0;
    if (newer) {
      const n = new Notification({ title: `Tolle ${latest} is available`, body: 'Click to download the update.' });
      n.on('click', () => shell.openExternal(RELEASES));
      n.show();
      if (manual) shell.openExternal(RELEASES);
    } else if (manual) dialog.showMessageBox({ message: `You have the latest version (${app.getVersion()}).` });
  } catch { if (manual) dialog.showMessageBox({ message: 'Couldn\'t check for updates. Are you online?' }); }
}

// ---------------------------------------------------------------- messages from the setup screens
ipcMain.handle('setup:info', () => runCli(['info']));
// Talk to a Tolle server from the main process (the setup page itself can't, because of CORS).
ipcMain.handle('setup:api', async (e, { method = 'GET', url, body, token, timeout = 20000 }) => {
  try {
    const r = await net.fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Device-Id': 'desktop-setup', 'X-Device-Name': `Tolle desktop on ${os.hostname()}`,
        ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { ok: r.ok, status: r.status, data };
  } catch (err) {
    return { ok: false, status: 0, data: { detail: err.message } };
  }
});
ipcMain.handle('setup:startLocal', async (e, { mode, port }) => {
  config = { ...config, mode, port };
  return startLocalServer({ restart: true });
});
ipcMain.handle('setup:run', (e, args, env) => runCli(args, (ev) => e.sender.send('setup:progress', ev), env || {}));
ipcMain.handle('setup:runElevated', (e, commands) => runElevated(commands));
ipcMain.handle('setup:current', () => config);
ipcMain.handle('setup:platform', () => ({ platform: process.platform, user: os.userInfo().username, version: app.getVersion() }));
ipcMain.handle('setup:open', (e, url) => shell.openExternal(url));
ipcMain.handle('setup:finish', async (e, next) => {
  const wasLocal = ['personal', 'shared'].includes(config.mode);
  pendingToken = next.token || null;
  delete next.token;
  config = { ...config, ...next, setupDone: true };
  saveConfig(config);
  if (wasLocal && serverProc && !['personal', 'shared'].includes(config.mode)) { serverProc.kill(); serverProc = null; }
  setStartAtLogin(config.mode === 'shared' ? config.startAtLogin !== false : false);
  // Open the main window before closing the assistant, so there's never a moment with no windows
  // (on Windows/Linux that would quit the app).
  if (mainWin) { mainWin.destroy(); mainWin = null; }
  await openMain();
  if (setupWin) setupWin.close();
  return true;
});
ipcMain.handle('pair:info', async () => {
  const info = await runCli(['info']);
  const port = config.port || 8099;
  const urls = ['server', 'shared'].includes(config.mode)
    ? info.lan.map((ip) => `http://${ip}:${port}`)
    : config.url ? [config.url] : [];
  return Promise.all(urls.map(async (u) => ({
    url: u,
    qr: await QRCode.toDataURL(`tolle://connect?server=${encodeURIComponent(u)}`, { margin: 1, width: 280 }),
  })));
});
ipcMain.handle('main:pair', () => openPairing());

// ---------------------------------------------------------------- app lifecycle
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWin) { mainWin.show(); mainWin.focus(); } else if (setupWin) setupWin.focus();
  });
  app.whenReady().then(async () => {
    buildMenu();
    if (!config.setupDone) openSetup();
    else await openMain({ show: !process.argv.includes('--hidden') });
    setTimeout(() => checkForUpdates(false), 15000);
  });
  app.on('activate', () => { if (mainWin) mainWin.show(); else if (config.setupDone) openMain(); });
  app.on('before-quit', () => { quitting = true; });
  app.on('window-all-closed', () => {
    if (config.mode !== 'shared' || !config.setupDone) app.quit();
  });
  app.on('will-quit', () => { if (serverProc) serverProc.kill(); });
}
