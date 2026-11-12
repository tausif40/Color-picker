const { app, BrowserWindow, Tray, Menu, nativeImage, globalShortcut, screen, ipcMain, clipboard, desktopCapturer, systemPreferences, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeHex } = require('./color.cjs');
const { normalizeShortcut } = require('./shortcut.cjs');

const DEFAULT_SHORTCUT = 'CommandOrControl+Shift+P';
const DEFAULT_COLOR = '#7C5CFF';
const preload = path.join(__dirname, 'preload.cjs');
let mainWindow, popupWindow, pickerWindow, cursorWindow, cursorTimer, tray;
let pickerWindows = [];
let pickerReady = new Map();
let pickerResult;
let zoomPermissionGranted = false;
let picking = false;
let restoreMainAfterCancel = false;
let quitting = false;
let shortcutAvailable = false;
let shortcutEditing = false;
let pickerEscapeRegistered = false;
let data;

const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
else app.on('second-instance', () => showMain());

function statePath() { return path.join(app.getPath('userData'), 'colors.json'); }
function state() {
  return {
    ...data, platform: process.platform, picking, shortcutAvailable, shortcutEditing,
    screenPermission: process.platform === 'darwin'
      ? zoomPermissionGranted ? 'granted' : systemPreferences.getMediaAccessStatus('screen')
      : 'granted'
  };
}

function loadState() {
  try {
    const saved = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
    data = {
      selected: normalizeHex(saved.selected) || DEFAULT_COLOR,
      toneBase: normalizeHex(saved.toneBase) || normalizeHex(saved.selected) || DEFAULT_COLOR,
      recent: Array.isArray(saved.recent) ? saved.recent.map(normalizeHex).filter(Boolean).slice(0, 24) : [],
      palette: Array.isArray(saved.palette) ? [...new Set(saved.palette.map(normalizeHex).filter(Boolean))].slice(0, 100) : [],
      shortcut: normalizeShortcut(saved.shortcut) || DEFAULT_SHORTCUT
    };
  } catch {
    data = { selected: DEFAULT_COLOR, toneBase: DEFAULT_COLOR, recent: [], palette: [], shortcut: DEFAULT_SHORTCUT };
  }
}

function saveState() {
  try {
    fs.mkdirSync(path.dirname(statePath()), { recursive: true });
    const tempPath = `${statePath()}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
    fs.renameSync(tempPath, statePath());
  } catch (error) { console.error('Could not save colors:', error); }
}

function broadcast() {
  for (const win of [mainWindow, popupWindow]) {
    if (win && !win.isDestroyed()) win.webContents.send('state:changed', state());
  }
  updateTray();
}

function windowOptions(extra = {}) {
  return {
    show: false,
    backgroundColor: '#F6F7F9',
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true },
    ...extra
  };
}

function createMain() {
  mainWindow = new BrowserWindow(windowOptions({
    width: 480, height: 690, minWidth: 420, minHeight: 560,
    title: 'Prism Pick', icon: path.join(__dirname, '..', 'assets', 'app.png'),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    autoHideMenuBar: true
  }));
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('blur', () => { if (shortcutEditing) setShortcutEditing(false); });
  mainWindow.on('close', event => {
    if (!quitting) { event.preventDefault(); mainWindow.hide(); }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

function showMain() {
  if (!app.isReady()) return;
  if (!mainWindow || mainWindow.isDestroyed()) createMain();
  else { mainWindow.show(); mainWindow.focus(); }
}

function closePopup() {
  const window = popupWindow;
  popupWindow = null;
  if (window && !window.isDestroyed()) window.close();
}

function showPopup() {
  closePopup();
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const width = 340, height = 370;
  const area = display.workArea;
  const x = Math.round(area.x + (area.width - width) / 2);
  const y = Math.round(area.y + (area.height - height) / 2);
  const window = new BrowserWindow(windowOptions({
    width, height, x, y, frame: false, resizable: false,
    skipTaskbar: true, alwaysOnTop: true, hasShadow: true,
    backgroundColor: '#FFFFFF'
  }));
  popupWindow = window;
  // Keep the popup on the space that was just picked from, including full-screen apps.
  if (process.platform === 'darwin') window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  window.loadFile(path.join(__dirname, 'popup.html'));
  window.once('ready-to-show', () => { if (!window.isDestroyed()) { window.show(); window.focus(); } });
  window.on('blur', () => { if (!window.isDestroyed()) window.close(); });
  window.on('closed', () => { if (popupWindow === window) popupWindow = null; });
}

function icon() {
  // tray.png is 64px; give the tray a menu-bar sized image with a Retina representation.
  const source = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'tray.png'));
  const size = process.platform === 'darwin' ? 18 : 16;
  const image = nativeImage.createEmpty();
  for (const scaleFactor of [1, 2]) {
    const pixels = size * scaleFactor;
    image.addRepresentation({ scaleFactor, buffer: source.resize({ width: pixels, height: pixels, quality: 'best' }).toPNG() });
  }
  if (process.platform === 'darwin') image.setTemplateImage(true);
  return image;
}

function updateTray() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Prism Pick', click: showMain },
    { label: `Pick color  ·  ${data.shortcut}`, click: startPicker },
    { type: 'separator' },
    { label: 'Quit Prism Pick', click: () => { quitting = true; app.quit(); } }
  ]));
  tray.setToolTip(`Prism Pick — ${data.shortcut}`);
}

function registerShortcut(value) {
  try {
    const available = globalShortcut.register(value, startPicker);
    if (available) shortcutAvailable = true;
    return available;
  }
  catch { return false; }
}

function setShortcutEditing(editing) {
  shortcutEditing = !!editing;
  if (shortcutEditing) {
    if (globalShortcut.isRegistered(data.shortcut)) globalShortcut.unregister(data.shortcut);
    shortcutAvailable = false;
  } else if (!globalShortcut.isRegistered(data.shortcut)) {
    shortcutAvailable = registerShortcut(data.shortcut);
  } else shortcutAvailable = true;
  broadcast();
  return { ok: true };
}

function setShortcut(value) {
  const shortcut = normalizeShortcut(value);
  if (!shortcut) return { ok: false, error: 'Enter a key or combination like F8 or Cmd+Shift+P.' };
  if (shortcut === data.shortcut && globalShortcut.isRegistered(shortcut)) {
    broadcast();
    return { ok: true, shortcut };
  }
  const previous = data.shortcut;
  if (globalShortcut.isRegistered(previous)) globalShortcut.unregister(previous);
  shortcutAvailable = false;
  if (!registerShortcut(shortcut)) {
    if (!shortcutEditing) registerShortcut(previous);
    broadcast();
    return { ok: false, error: 'That shortcut is already in use. Try another.' };
  }
  data.shortcut = shortcut;
  shortcutEditing = false;
  saveState(); broadcast();
  return { ok: true, shortcut };
}

function cancelCustomPicker() {
  if (!pickerResult) return;
  const resolve = pickerResult;
  pickerResult = null;
  resolve({ ok: false, name: 'AbortError' });
}

// Escape must cancel even when another app still owns keyboard focus.
function registerPickerEscape() {
  if (pickerEscapeRegistered || globalShortcut.isRegistered('Escape')) return;
  try { pickerEscapeRegistered = globalShortcut.register('Escape', cancelCustomPicker); }
  catch { pickerEscapeRegistered = false; }
}

function unregisterPickerEscape() {
  if (!pickerEscapeRegistered) return;
  globalShortcut.unregister('Escape');
  pickerEscapeRegistered = false;
}

function closeCustomPicker() {
  unregisterPickerEscape();
  for (const window of pickerWindows) {
    if (!window.isDestroyed()) window.destroy();
  }
  pickerWindows = [];
  pickerReady.clear();
  pickerResult = null;
}

function stopPicker() {
  closeCustomPicker();
  clearInterval(cursorTimer);
  cursorTimer = null;
  if (cursorWindow && !cursorWindow.isDestroyed()) cursorWindow.destroy();
  cursorWindow = null;
  if (pickerWindow && !pickerWindow.isDestroyed()) pickerWindow.destroy();
  pickerWindow = null;
  picking = false;
  broadcast();
}

async function runCustomPicker() {
  let readyTimeout, pickTimeout;
  let readyToPick = false;
  try {
    const displays = screen.getAllDisplays();
    const sources = await Promise.race([
      desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } }),
      new Promise((_, reject) => { readyTimeout = setTimeout(() => reject(new Error('Screen capture could not start.')), 15000); })
    ]);
    clearTimeout(readyTimeout);
    // Without Screen Recording access macOS streams only the wallpaper, which would
    // give wrong colors. Use the system eyedropper until access is granted.
    if (process.platform === 'darwin' && !zoomPermissionGranted
      && systemPreferences.getMediaAccessStatus('screen') !== 'granted') {
      throw new Error('Screen Recording permission is not granted.');
    }
    const cursor = screen.getCursorScreenPoint();
    const readyPromises = displays.map((display, index) => {
      const source = sources.find(item => item.display_id === String(display.id))
        || (sources.length === displays.length ? sources[index] : null);
      if (!source) throw new Error('Could not find the screen capture source.');
      const window = new BrowserWindow({
        x: display.bounds.x, y: display.bounds.y,
        width: display.bounds.width, height: display.bounds.height,
        show: false, frame: false, transparent: true,
        resizable: false, movable: false, skipTaskbar: true,
        hasShadow: false, backgroundColor: '#00000000',
        acceptFirstMouse: true,
        webPreferences: {
          preload: path.join(__dirname, 'picker-preload.cjs'),
          contextIsolation: true, nodeIntegration: false, sandbox: true,
          backgroundThrottling: false
        }
      });
      pickerWindows.push(window);
      window.setBounds(display.bounds);
      window.setAlwaysOnTop(true, 'screen-saver');
      window.setContentProtection(true);
      if (process.platform === 'darwin') window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      const ready = new Promise((resolve, reject) => {
        pickerReady.set(window, { resolve, reject });
        window.webContents.once('did-fail-load', (_event, _code, message) => reject(new Error(message)));
        window.loadFile(path.join(__dirname, 'picker.html'), { query: {
          source: source.id,
          displayX: String(display.bounds.x),
          displayY: String(display.bounds.y),
          displayWidth: String(display.bounds.width),
          displayHeight: String(display.bounds.height),
          width: String(Math.round(display.bounds.width * display.scaleFactor)),
          height: String(Math.round(display.bounds.height * display.scaleFactor)),
          cursorX: String(cursor.x - display.bounds.x),
          cursorY: String(cursor.y - display.bounds.y),
          active: String(display.bounds.x <= cursor.x && cursor.x < display.bounds.x + display.bounds.width
            && display.bounds.y <= cursor.y && cursor.y < display.bounds.y + display.bounds.height)
        } }).catch(reject);
      });
      return ready;
    });
    await Promise.race([
      Promise.all(readyPromises),
      new Promise((_, reject) => { readyTimeout = setTimeout(() => reject(new Error('Zoom preview could not start.')), 60000); })
    ]);
    readyToPick = true;
    zoomPermissionGranted = true;
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
    await new Promise(resolve => setTimeout(resolve, 80));
    const result = new Promise(resolve => { pickerResult = resolve; });
    registerPickerEscape();
    for (const window of pickerWindows) window.showInactive();
    const point = screen.getCursorScreenPoint();
    const active = pickerWindows[displays.findIndex(display => display.bounds.x <= point.x
      && point.x < display.bounds.x + display.bounds.width
      && display.bounds.y <= point.y && point.y < display.bounds.y + display.bounds.height)] || pickerWindows[0];
    active.focus();
    return await Promise.race([
      result,
      new Promise((_, reject) => { pickTimeout = setTimeout(() => reject(new Error('Color picker took too long. Please try again.')), 60000); })
    ]);
  } catch (error) {
    closeCustomPicker();
    if (!readyToPick) throw Object.assign(new Error(error?.message || 'Zoom preview unavailable.'), { code: 'zoom-unavailable' });
    throw error;
  } finally {
    clearTimeout(readyTimeout);
    clearTimeout(pickTimeout);
  }
}

async function showPickerPointer() {
  const size = 40;
  const window = new BrowserWindow({
    show: false, width: size, height: size,
    frame: false, transparent: true, focusable: false,
    resizable: false, movable: false, skipTaskbar: true,
    hasShadow: false, backgroundColor: '#00000000',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  cursorWindow = window;
  window.setAlwaysOnTop(true, 'screen-saver');
  window.setIgnoreMouseEvents(true);
  window.setContentProtection(true);
  if (process.platform === 'darwin') window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  await window.loadFile(path.join(__dirname, 'cursor.html'));
  if (window.isDestroyed()) return;

  let previousX, previousY;
  const move = () => {
    if (window.isDestroyed()) return;
    const point = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(point);
    const area = display.bounds;
    const x = point.x + 56 + size <= area.x + area.width ? point.x + 56 : point.x - 56 - size;
    const y = point.y + 16 + size <= area.y + area.height ? point.y + 16 : point.y - 16 - size;
    if (x === previousX && y === previousY) return;
    previousX = x;
    previousY = y;
    window.setPosition(Math.round(x), Math.round(y), false);
  };
  move();
  window.showInactive();
  cursorTimer = setInterval(move, 33);
}

async function runNativePicker() {
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const size = 48;
  const x = cursor.x < display.bounds.x + display.bounds.width / 2
    ? display.bounds.x + display.bounds.width - size : display.bounds.x;
  const y = cursor.y < display.bounds.y + display.bounds.height / 2
    ? display.bounds.y + display.bounds.height - size : display.bounds.y;
  const window = new BrowserWindow(windowOptions({
      x, y, width: size, height: size,
      frame: false, transparent: true, resizable: false, movable: false,
      alwaysOnTop: true, skipTaskbar: true, hasShadow: false,
      backgroundColor: '#00000000'
  }));
  pickerWindow = window;
  await window.loadFile(path.join(__dirname, 'native-picker.html'));
  if (process.platform === 'darwin') window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  window.show();
  window.focus();
  let timer;
  try {
    const result = Promise.race([
      window.webContents.executeJavaScript(`(async () => {
      if (!('EyeDropper' in window)) return { ok: false, name: 'NotSupportedError' };
      try { return { ok: true, hex: (await new EyeDropper().open()).sRGBHex }; }
      catch (error) { return { ok: false, name: error.name }; }
      })()`, true),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Color picker took too long. Please try again.')), 60000); })
    ]);
    await showPickerPointer().catch(error => console.warn('Could not show picker pointer:', error));
    return await result;
  } finally { clearTimeout(timer); }
}

async function startPicker() {
  if (picking) return { ok: false, error: 'Picker is already open.' };
  picking = true;
  broadcast();
  restoreMainAfterCancel = !!(mainWindow && mainWindow.isVisible());
  closePopup();
  try {
    let result;
    const permission = process.platform === 'darwin' && !zoomPermissionGranted
      ? systemPreferences.getMediaAccessStatus('screen') : 'granted';
    if (permission === 'denied' || permission === 'restricted') {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
      result = await runNativePicker();
    } else {
      try { result = await runCustomPicker(); }
      catch (error) {
        if (error.code !== 'zoom-unavailable') throw error;
        console.warn('Custom zoom unavailable; using the system eyedropper:', error);
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
        result = await runNativePicker();
      }
    }
    stopPicker();
    if (result.ok) {
      chooseColor(result.hex, true);
      showPopup();
      return { ok: true };
    }
    if (result.name === 'AbortError') {
      if (restoreMainAfterCancel) showMain();
      return { ok: false, cancelled: true };
    }
    throw new Error(result.name === 'NotSupportedError' ? 'Direct color picking is unavailable on this system.' : 'Could not pick a color. Please try again.');
  } catch (error) {
    stopPicker();
    showMain();
    const result = { ok: false, code: 'picker-failed', error: error?.message || 'Color picking failed.' };
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('picker:error', result);
    return result;
  }
}

function chooseColor(hex, addRecent = false, keepToneBase = false) {
  const clean = normalizeHex(hex);
  if (!clean) return { ok: false, error: 'Invalid color.' };
  data.selected = clean;
  if (!keepToneBase) data.toneBase = clean;
  if (addRecent) data.recent = [clean, ...data.recent.filter(item => item !== clean)].slice(0, 24);
  saveState(); broadcast();
  return { ok: true, color: clean };
}

app.whenReady().then(() => {
  if (!primaryInstance) return;
  loadState();
  if (!registerShortcut(data.shortcut)) {
    const alternatives = [DEFAULT_SHORTCUT, 'CommandOrControl+Alt+P', 'CommandOrControl+Shift+8'];
    const available = alternatives.find(value => value !== data.shortcut && registerShortcut(value));
    if (available) { data.shortcut = available; saveState(); }
  }
  createMain();
  tray = new Tray(icon());
  tray.on('click', showMain);
  updateTray();

  ipcMain.on('picker:ready', event => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const pending = pickerReady.get(window);
    if (pending) { pickerReady.delete(window); pending.resolve(); }
  });
  ipcMain.on('picker:failed', (event, message) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const pending = pickerReady.get(window);
    if (pending) { pickerReady.delete(window); pending.reject(new Error(String(message || 'Zoom preview failed.'))); }
  });
  ipcMain.on('picker:choose', (event, hex) => {
    if (!pickerWindows.includes(BrowserWindow.fromWebContents(event.sender)) || !pickerResult) return;
    const clean = normalizeHex(hex);
    if (!clean) return;
    const resolve = pickerResult;
    pickerResult = null;
    resolve({ ok: true, hex: clean });
  });
  ipcMain.on('picker:cancel', event => {
    if (!pickerWindows.includes(BrowserWindow.fromWebContents(event.sender))) return;
    cancelCustomPicker();
  });

  ipcMain.handle('state:get', () => state());
  ipcMain.handle('picker:start', () => startPicker());
  ipcMain.handle('color:select', (_event, hex) => chooseColor(hex));
  ipcMain.handle('shade:select', (_event, hex) => chooseColor(hex, false, true));
  ipcMain.handle('palette:save', (_event, hex) => {
    const clean = normalizeHex(hex);
    if (!clean) return { ok: false };
    data.palette = [clean, ...data.palette.filter(item => item !== clean)].slice(0, 100);
    saveState(); broadcast(); return { ok: true };
  });
  ipcMain.handle('palette:remove', (_event, hex) => {
    const clean = normalizeHex(hex);
    data.palette = data.palette.filter(item => item !== clean);
    saveState(); broadcast(); return { ok: true };
  });
  ipcMain.handle('shortcut:set', (_event, value) => setShortcut(value));
  ipcMain.handle('shortcut:reset', () => setShortcut(DEFAULT_SHORTCUT));
  ipcMain.handle('shortcut:editing', (_event, value) => setShortcutEditing(value));
  ipcMain.handle('clipboard:write', (_event, value) => {
    if (typeof value !== 'string' || value.length > 200) return { ok: false };
    clipboard.writeText(value); return { ok: true };
  });
  ipcMain.handle('window:closePopup', () => { closePopup(); return { ok: true }; });
  ipcMain.handle('screen:settings', () => process.platform === 'darwin'
    ? shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture')
    : Promise.resolve());
});

app.on('activate', () => { if (!picking) showMain(); });
app.on('browser-window-focus', () => { if (data) broadcast(); });
app.on('before-quit', () => { quitting = true; globalShortcut.unregisterAll(); });
app.on('window-all-closed', () => {});
