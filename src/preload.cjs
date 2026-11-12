const { contextBridge, ipcRenderer } = require('electron');

function on(channel, callback) {
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('prism', {
  platform: process.platform,
  getState: () => ipcRenderer.invoke('state:get'),
  startPicker: () => ipcRenderer.invoke('picker:start'),
  selectColor: hex => ipcRenderer.invoke('color:select', hex),
  selectShade: hex => ipcRenderer.invoke('shade:select', hex),
  saveColor: hex => ipcRenderer.invoke('palette:save', hex),
  removeColor: hex => ipcRenderer.invoke('palette:remove', hex),
  setShortcut: value => ipcRenderer.invoke('shortcut:set', value),
  resetShortcut: () => ipcRenderer.invoke('shortcut:reset'),
  setShortcutEditing: value => ipcRenderer.invoke('shortcut:editing', value),
  copy: value => ipcRenderer.invoke('clipboard:write', value),
  closePopup: () => ipcRenderer.invoke('window:closePopup'),
  openScreenSettings: () => ipcRenderer.invoke('screen:settings'),
  onState: callback => on('state:changed', callback),
  onPickerError: callback => on('picker:error', callback)
});
