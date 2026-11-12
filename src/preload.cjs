const { contextBridge, ipcRenderer } = require('electron');

function on(channel, callback) {
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('colorPicker', {
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
  relaunch: () => ipcRenderer.invoke('app:relaunch'),
  setTheme: theme => ipcRenderer.invoke('theme:set', theme),
  setPreference: (key, value) => ipcRenderer.invoke('preference:set', key, value),
  openLink: url => ipcRenderer.invoke('link:open', url),
  setPattern: pattern => ipcRenderer.invoke('pattern:set', pattern),
  savePattern: pattern => ipcRenderer.invoke('patterns:save', pattern),
  removePattern: id => ipcRenderer.invoke('patterns:remove', id),
  restorePattern: (pattern, index) => ipcRenderer.invoke('patterns:restore', pattern, index),
  reorderPatterns: ids => ipcRenderer.invoke('patterns:reorder', ids),
  onState: callback => on('state:changed', callback),
  onPickerError: callback => on('picker:error', callback)
});
