const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pickerBridge', {
  onBegin: callback => ipcRenderer.on('picker:begin', (_event, config) => callback(config)),
  onEnd: callback => ipcRenderer.on('picker:end', () => callback()),
  ready: session => ipcRenderer.send('picker:ready', session),
  failed: (session, message) => ipcRenderer.send('picker:failed', session, message),
  choose: (session, hex) => ipcRenderer.send('picker:choose', session, hex),
  cancel: session => ipcRenderer.send('picker:cancel', session)
});
