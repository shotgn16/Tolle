// Gives the setup assistant (a local page) access to the setup steps – nothing else.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tolle', {
  info: () => ipcRenderer.invoke('setup:info'),
  api: (req) => ipcRenderer.invoke('setup:api', req),
  startLocal: (opts) => ipcRenderer.invoke('setup:startLocal', opts),
  run: (args, env) => ipcRenderer.invoke('setup:run', args, env),
  runElevated: (commands) => ipcRenderer.invoke('setup:runElevated', commands),
  current: () => ipcRenderer.invoke('setup:current'),
  platform: () => ipcRenderer.invoke('setup:platform'),
  open: (url) => ipcRenderer.invoke('setup:open', url),
  finish: (config) => ipcRenderer.invoke('setup:finish', config),
  pairInfo: () => ipcRenderer.invoke('pair:info'),
  onProgress: (fn) => {
    const handler = (_e, ev) => fn(ev);
    ipcRenderer.on('setup:progress', handler);
    return () => ipcRenderer.removeListener('setup:progress', handler);
  },
});
