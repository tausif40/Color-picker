const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pickerBridge', {
  ready: () => ipcRenderer.send('picker:ready'),
  failed: message => ipcRenderer.send('picker:failed', message),
  choose: hex => ipcRenderer.send('picker:choose', hex),
  cancel: () => ipcRenderer.send('picker:cancel')
});
