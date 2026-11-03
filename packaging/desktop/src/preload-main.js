// The main window shows the Tolle web app. It only gets one desktop extra: opening the
// "connect a phone" window. It has no access to files or the installer.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tolleDesktop', {
  isDesktop: true,
  connectPhone: () => ipcRenderer.invoke('main:pair'),
});
