const { app, BrowserWindow, Tray, Menu, nativeImage, nativeTheme, globalShortcut, screen, ipcMain, clipboard, desktopCapturer, systemPreferences, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeHex } = require('./color.cjs');
const { normalizeShortcut } = require('./shortcut.cjs');

const DEFAULT_SHORTCUT = 'CommandOrControl+Shift+P';
const DEFAULT_COLOR = '#7C5CFF';
const THEMES = ['system', 'light', 'dark'];
const MAX_SAVED = 250;
const MAX_SAVED_PATTERNS = 100;
const DEFAULT_PATTERN = { colors: ['#2E4756', '#4F9A8F', '#E2C577', '#E8A66C', '#D8765A'] };
const MAX_RECENT = 24;
// Shown in Settings → Developer. Links opened from the app are limited to these.
const DEVELOPER = { name: 'Tausif', email: 'tausif6040@gmail.com', portfolio: 'https://tausif.info' };
const ALLOWED_LINKS = new Set([`mailto:${DEVELOPER.email}`, DEVELOPER.portfolio]);
const preload = path.join(__dirname, 'preload.cjs');
let mainWindow, popupWindow, tray;
// Picker overlays (one per display) are created ahead of time and kept hidden, and the
// screen source ids are cached, so the shortcut only has to start the stream.
let pickerPool = [];       // [{ displayId, window, loaded }]
let screenSources = null;  // Map<displayId, sourceId>
let pickerSession = 0;
let pickerResult = null;   // { session, resolve, reject } for the open picker
let pickerPoolStale = false;
let zoomPermissionGranted = false;
let picking = false;
let restoreMainAfterCancel = false;
let quitting = false;
let shortcutAvailable = false;
let shortcutEditing = false;
let pickerEscapeRegistered = false;
let showOnLaunch = true;
let data;

const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
else app.on('second-instance', () => showMain());

function statePath() { return path.join(app.getPath('userData'), 'colors.json'); }
function screenAccess() {
  if (process.platform !== 'darwin' || zoomPermissionGranted) return 'granted';
  return systemPreferences.getMediaAccessStatus('screen');
}

function state() {
  return {
    ...data, platform: process.platform, picking, shortcutAvailable, shortcutEditing,
    screenPermission: screenAccess(),
    openAtLogin: loginItemEnabled(),
    version: app.getVersion(),
    developer: DEVELOPER,
    maxSaved: MAX_SAVED,
    maxRecent: MAX_RECENT,
    maxSavedPatterns: MAX_SAVED_PATTERNS,
    arch: process.arch
  };
}

// A palette (color pattern) is 2–8 colors shown as equal-width blocks.
function cleanPattern(value) {
  if (!value || !Array.isArray(value.colors)) return null;
  const colors = value.colors.map(normalizeHex).filter(Boolean).slice(0, 8);
  return colors.length >= 2 ? { colors } : null;
}

function cleanSavedPattern(value) {
  const pattern = cleanPattern(value);
  if (!pattern) return null;
  const id = typeof value.id === 'string' && /^[\w-]{1,40}$/.test(value.id) ? value.id : newId();
  return { id, colors: pattern.colors };
}

function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

// Colors saved before the app was renamed from Prism Pick live in its old data folder.
function readSavedState() {
  const legacy = ['Prism Pick', 'prism-pick'].map(name => path.join(app.getPath('appData'), name, 'colors.json'));
  for (const file of [statePath(), ...legacy]) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { /* try the next location */ }
  }
  throw new Error('No saved colors.');
}

function loadState() {
  try {
    const saved = readSavedState();
    data = {
      selected: normalizeHex(saved.selected) || DEFAULT_COLOR,
      toneBase: normalizeHex(saved.toneBase) || normalizeHex(saved.selected) || DEFAULT_COLOR,
      recent: Array.isArray(saved.recent) ? saved.recent.map(normalizeHex).filter(Boolean).slice(0, MAX_RECENT) : [],
      palette: Array.isArray(saved.palette) ? [...new Set(saved.palette.map(normalizeHex).filter(Boolean))].slice(0, MAX_SAVED) : [],
      shortcut: normalizeShortcut(saved.shortcut) || DEFAULT_SHORTCUT,
      theme: THEMES.includes(saved.theme) ? saved.theme : 'system',
      startHidden: saved.startHidden === true,
      showTrayIcon: saved.showTrayIcon !== false,
      // Earlier versions stored a gradient; reuse its colors for the palette.
      pattern: cleanPattern(saved.pattern) || cleanPattern({ colors: saved.gradient?.stops }) || DEFAULT_PATTERN,
      savedPatterns: Array.isArray(saved.savedPatterns) ? saved.savedPatterns.map(cleanSavedPattern).filter(Boolean).slice(0, MAX_SAVED_PATTERNS) : []
    };
    if (!fs.existsSync(statePath())) saveState();
  } catch {
    data = { selected: DEFAULT_COLOR, toneBase: DEFAULT_COLOR, recent: [], palette: [], shortcut: DEFAULT_SHORTCUT, theme: 'system', startHidden: false, showTrayIcon: true, pattern: DEFAULT_PATTERN, savedPatterns: [] };
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

// Open at login: macOS Login Items / Windows startup entry for this app.
function loginItemEnabled() {
  try { return app.getLoginItemSettings().openAtLogin; } catch { return false; }
}

function setPreference(key, value) {
  const enabled = !!value;
  if (key === 'openAtLogin') {
    try { app.setLoginItemSettings({ openAtLogin: enabled }); }
    catch (error) { return { ok: false, error: 'Could not change the login item.' }; }
    broadcast();
    return { ok: true, value: loginItemEnabled() };
  }
  if (key === 'startHidden') data.startHidden = enabled;
  else if (key === 'showTrayIcon') setTrayVisible(enabled);
  else return { ok: false };
  saveState(); broadcast();
  return { ok: true, value: enabled };
}

function windowBackground() { return nativeTheme.shouldUseDarkColors ? '#1B1B1E' : '#F4F4F7'; }
function popupBackground() { return nativeTheme.shouldUseDarkColors ? '#26262A' : '#FFFFFF'; }

// 'system' follows macOS/Windows appearance; 'light' and 'dark' override it for the app.
function setTheme(theme) {
  if (!THEMES.includes(theme)) return { ok: false };
  data.theme = theme;
  nativeTheme.themeSource = theme;
  saveState(); broadcast();
  return { ok: true, theme };
}

function windowOptions(extra = {}) {
  return {
    show: false,
    backgroundColor: windowBackground(),
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true },
    ...extra
  };
}

function createMain() {
  mainWindow = new BrowserWindow(windowOptions({
    // Fixed size: every section is laid out to fit without scrolling.
    width: 480, height: 662, resizable: false,
    title: 'Color Picker', icon: path.join(__dirname, '..', 'assets', 'app.png'),
    // Native macOS close and minimize buttons; the green zoom/full-screen button is disabled.
    titleBarStyle: process.platform === 'darwin' ? 'hidden' : 'default',
    trafficLightPosition: { x: 14, y: 12 },
    maximizable: false,
    fullscreenable: false,
    autoHideMenuBar: true
  }));
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.once('ready-to-show', () => { if (showOnLaunch) mainWindow.show(); showOnLaunch = true; });
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
  const width = 340, height = 340;
  const area = display.workArea;
  const x = Math.round(area.x + (area.width - width) / 2);
  const y = Math.round(area.y + (area.height - height) / 2);
  const window = new BrowserWindow(windowOptions({
    width, height, x, y, frame: false, resizable: false,
    skipTaskbar: true, alwaysOnTop: true, hasShadow: true,
    backgroundColor: popupBackground()
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
  const assets = path.join(__dirname, '..', 'assets');
  if (process.platform === 'darwin') {
    // 18pt menu-bar template; Electron loads trayTemplate@2x.png for Retina automatically.
    const image = nativeImage.createFromPath(path.join(assets, 'trayTemplate.png'));
    image.setTemplateImage(true);
    return image;
  }
  // Windows tray: 16px with a 32px representation for high-DPI screens.
  const source = nativeImage.createFromPath(path.join(assets, 'tray.png'));
  const image = nativeImage.createEmpty();
  for (const scaleFactor of [1, 2]) {
    const pixels = 16 * scaleFactor;
    image.addRepresentation({ scaleFactor, buffer: source.resize({ width: pixels, height: pixels, quality: 'best' }).toPNG() });
  }
  return image;
}

const TRAY_NAME = process.platform === 'darwin' ? 'Menu Bar Icon' : 'Tray Icon';

function setTrayVisible(visible) {
  data.showTrayIcon = !!visible;
  if (visible && !tray) {
    tray = new Tray(icon());
    tray.on('click', showMain);
  } else if (!visible && tray) {
    tray.destroy();
    tray = null;
  }
  updateTray();
}

function updateTray() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Color Picker', click: showMain },
    { label: `Pick color  ·  ${data.shortcut}`, click: startPicker },
    { type: 'separator' },
    // Brings it back: Settings → General → Show menu bar icon.
    { label: `Hide ${TRAY_NAME}`, click: () => { setTrayVisible(false); saveState(); broadcast(); } },
    { label: 'Quit Color Picker', click: () => { quitting = true; app.quit(); } }
  ]));
  tray.setToolTip(`Color Picker — ${data.shortcut}`);
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

function settlePicker(session, value) {
  if (!pickerResult || pickerResult.session !== session) return;
  const { resolve } = pickerResult;
  pickerResult = null;
  resolve(value);
}

function failPicker(session, error) {
  if (!pickerResult || pickerResult.session !== session) return;
  const { reject } = pickerResult;
  pickerResult = null;
  reject(error);
}

function cancelCustomPicker() {
  if (pickerResult) settlePicker(pickerResult.session, { ok: false, name: 'AbortError' });
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

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })
  ]).finally(() => clearTimeout(timer));
}

function containsPoint(bounds, point) {
  return bounds.x <= point.x && point.x < bounds.x + bounds.width
    && bounds.y <= point.y && point.y < bounds.y + bounds.height;
}

function createPickerWindow(display) {
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
  window.setBounds(display.bounds);
  window.setAlwaysOnTop(true, 'screen-saver');
  window.setContentProtection(true); // keep the overlay itself out of the captured pixels
  if (process.platform === 'darwin') window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  window.on('closed', () => { pickerPool = pickerPool.filter(item => item.window !== window); });
  const loaded = window.loadFile(path.join(__dirname, 'picker.html'));
  return { displayId: display.id, window, loaded };
}

function destroyPickerPool() {
  for (const { window } of pickerPool) {
    if (!window.isDestroyed()) window.destroy();
  }
  pickerPool = [];
}

// Returns the displays, with one ready overlay window per display at the same index.
function preparePickerPool() {
  const displays = screen.getAllDisplays();
  const matches = !pickerPoolStale && pickerPool.length === displays.length
    && pickerPool.every((item, index) => item.displayId === displays[index].id && !item.window.isDestroyed());
  if (!matches) {
    destroyPickerPool();
    pickerPool = displays.map(createPickerWindow);
    pickerPoolStale = false;
  }
  return displays;
}

async function loadScreenSources() {
  const sources = await withTimeout(
    desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } }),
    15000, 'Screen capture could not start.');
  const displays = screen.getAllDisplays();
  const map = new Map();
  displays.forEach((display, index) => {
    const source = sources.find(item => item.display_id === String(display.id))
      || (sources.length === displays.length ? sources[index] : null);
    if (source) map.set(display.id, source.id);
  });
  screenSources = map;
  return map;
}

// Prepare everything the shortcut needs, so opening the picker is instant.
function warmPicker() {
  if (!app.isReady() || picking) return;
  preparePickerPool();
  if (!screenSources && screenAccess() === 'granted') loadScreenSources().catch(() => { screenSources = null; });
}

function invalidatePicker() {
  screenSources = null;
  pickerPoolStale = true;
  if (!picking) setTimeout(warmPicker, 500);
}

function closeCustomPicker() {
  unregisterPickerEscape();
  pickerResult = null;
  for (const { window } of pickerPool) {
    if (window.isDestroyed()) continue;
    window.webContents.send('picker:end');
    window.hide();
  }
}

function stopPicker() {
  closeCustomPicker();
  picking = false;
  broadcast();
  if (pickerPoolStale) setTimeout(warmPicker, 500);
}

async function runCustomPicker(retry = true) {
  const displays = preparePickerPool();
  const usedCache = !!screenSources && displays.every(display => screenSources.has(display.id));
  const sources = usedCache ? screenSources : await loadScreenSources();
  if (displays.some(display => !sources.has(display.id))) throw new Error('Could not find the screen capture source.');
  await withTimeout(Promise.all(pickerPool.map(item => item.loaded)), 15000, 'The color picker could not start. Please try again.');

  const session = ++pickerSession;
  const result = new Promise((resolve, reject) => { pickerResult = { session, resolve, reject }; });
  const cursor = screen.getCursorScreenPoint();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
  registerPickerEscape();

  // Show the overlays right away; each page starts its stream in the background.
  let activeWindow = pickerPool[0].window;
  displays.forEach((display, index) => {
    const { window } = pickerPool[index];
    const active = containsPoint(display.bounds, cursor);
    if (active) activeWindow = window;
    window.setBounds(display.bounds);
    window.webContents.send('picker:begin', {
      session,
      source: sources.get(display.id),
      display: display.bounds,
      width: Math.round(display.bounds.width * display.scaleFactor),
      height: Math.round(display.bounds.height * display.scaleFactor),
      cursorX: cursor.x - display.bounds.x,
      cursorY: cursor.y - display.bounds.y,
      active
    });
    window.showInactive();
  });
  // The shortcut usually fires while another app is in front; take keyboard focus so
  // arrow-key nudging, Enter and Escape reach the picker.
  if (process.platform === 'darwin') app.focus({ steal: true });
  activeWindow.focus();

  try {
    return await withTimeout(result, 60000, 'Color picker took too long. Please try again.');
  } catch (error) {
    closeCustomPicker();
    // A cached source can go stale (for example after a display change); refresh once.
    if (error.code === 'capture-failed' && usedCache && retry) {
      screenSources = null;
      return runCustomPicker(false);
    }
    throw error;
  }
}

// Reading other apps' pixels on macOS needs Screen Recording access. Without it the
// stream shows only the wallpaper, so picking would return wrong colors.
async function ensureScreenAccess() {
  if (screenAccess() === 'granted') return;
  // Adds Color Picker to the Screen Recording list and, the first time, shows the macOS prompt.
  await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } }).catch(() => {});
  if (screenAccess() === 'granted') return;
  throw Object.assign(new Error('Allow Screen Recording for Color Picker, then restart the app.'), { code: 'screen-permission' });
}

async function startPicker() {
  if (picking) return { ok: false, error: 'Picker is already open.' };
  picking = true;
  broadcast();
  restoreMainAfterCancel = !!(mainWindow && mainWindow.isVisible());
  closePopup();
  try {
    await ensureScreenAccess();
    const result = await runCustomPicker();
    stopPicker();
    if (result.ok) {
      chooseColor(result.hex, true);
      showPopup();
      return { ok: true };
    }
    if (restoreMainAfterCancel) showMain();
    else if (process.platform === 'darwin') app.hide(); // hand focus back to the previous app
    return { ok: false, cancelled: true };
  } catch (error) {
    stopPicker();
    showMain();
    const result = { ok: false, code: error?.code || 'picker-failed', error: error?.message || 'Color picking failed.' };
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('picker:error', result);
    return result;
  }
}

function chooseColor(hex, addRecent = false, keepToneBase = false) {
  const clean = normalizeHex(hex);
  if (!clean) return { ok: false, error: 'Invalid color.' };
  data.selected = clean;
  if (!keepToneBase) data.toneBase = clean;
  if (addRecent) data.recent = [clean, ...data.recent.filter(item => item !== clean)].slice(0, MAX_RECENT);
  saveState(); broadcast();
  return { ok: true, color: clean };
}

app.whenReady().then(() => {
  if (!primaryInstance) return;
  loadState();
  nativeTheme.themeSource = data.theme;
  nativeTheme.on('updated', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setBackgroundColor(windowBackground());
    if (popupWindow && !popupWindow.isDestroyed()) popupWindow.setBackgroundColor(popupBackground());
  });
  if (!registerShortcut(data.shortcut)) {
    const alternatives = [DEFAULT_SHORTCUT, 'CommandOrControl+Alt+P', 'CommandOrControl+Shift+8'];
    const available = alternatives.find(value => value !== data.shortcut && registerShortcut(value));
    if (available) { data.shortcut = available; saveState(); }
  }
  showOnLaunch = !data.startHidden;
  if (data.startHidden) {
    ignoreLaunchActivate = true;
    setTimeout(() => { ignoreLaunchActivate = false; }, 2500);
  }
  createMain();
  setTrayVisible(data.showTrayIcon);
  for (const change of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(change, invalidatePicker);
  setTimeout(warmPicker, 1200);

  const fromPicker = event => pickerPool.some(item => !item.window.isDestroyed() && item.window.webContents === event.sender);
  ipcMain.on('picker:ready', event => { if (fromPicker(event)) zoomPermissionGranted = true; });
  ipcMain.on('picker:failed', (event, session, message) => {
    if (!fromPicker(event)) return;
    console.warn('Picker stream failed:', message);
    screenSources = null;
    failPicker(session, Object.assign(new Error('Screen capture could not start. Please try again.'), { code: 'capture-failed' }));
  });
  ipcMain.on('picker:choose', (event, session, hex) => {
    if (!fromPicker(event)) return;
    const clean = normalizeHex(hex);
    if (clean) settlePicker(session, { ok: true, hex: clean });
  });
  ipcMain.on('picker:cancel', (event, session) => {
    if (fromPicker(event)) settlePicker(session, { ok: false, name: 'AbortError' });
  });

  ipcMain.handle('state:get', () => state());
  ipcMain.handle('picker:start', () => startPicker());
  ipcMain.handle('color:select', (_event, hex) => chooseColor(hex));
  ipcMain.handle('shade:select', (_event, hex) => chooseColor(hex, false, true));
  ipcMain.handle('palette:save', (_event, hex) => {
    const clean = normalizeHex(hex);
    if (!clean) return { ok: false };
    if (data.palette.includes(clean)) return { ok: true, already: true };
    // Never drop an older color silently; ask the user to make room instead.
    if (data.palette.length >= MAX_SAVED) return { ok: false, error: `Saved colors are full (${MAX_SAVED}). Remove one first.` };
    data.palette = [clean, ...data.palette];
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
  ipcMain.handle('theme:set', (_event, theme) => setTheme(theme));
  ipcMain.handle('preference:set', (_event, key, value) => setPreference(key, value));
  // Only the main window shows the palette, so this saves without a broadcast.
  ipcMain.handle('pattern:set', (_event, value) => {
    const pattern = cleanPattern(value);
    if (!pattern) return { ok: false };
    data.pattern = pattern;
    saveState();
    return { ok: true, pattern };
  });
  // Saved palettes, kept for later (newest first).
  ipcMain.handle('patterns:save', (_event, value) => {
    const pattern = cleanPattern(value);
    if (!pattern) return { ok: false, error: 'A palette needs 2 to 8 colors.' };
    const key = pattern.colors.join();
    if (data.savedPatterns.some(item => item.colors.join() === key)) return { ok: true, already: true };
    if (data.savedPatterns.length >= MAX_SAVED_PATTERNS) return { ok: false, error: `Saved palettes are full (${MAX_SAVED_PATTERNS}). Remove one first.` };
    data.savedPatterns = [{ id: newId(), colors: pattern.colors }, ...data.savedPatterns];
    saveState(); broadcast();
    return { ok: true };
  });
  ipcMain.handle('patterns:remove', (_event, id) => {
    data.savedPatterns = data.savedPatterns.filter(item => item.id !== id);
    saveState(); broadcast();
    return { ok: true };
  });
  // Undo for a delete: put the palette back where it was.
  ipcMain.handle('patterns:restore', (_event, value, index) => {
    const item = cleanSavedPattern(value);
    if (!item || data.savedPatterns.some(saved => saved.id === item.id)) return { ok: false };
    if (data.savedPatterns.length >= MAX_SAVED_PATTERNS) return { ok: false, error: `Saved palettes are full (${MAX_SAVED_PATTERNS}).` };
    const at = Number.isInteger(index) ? Math.max(0, Math.min(index, data.savedPatterns.length)) : 0;
    data.savedPatterns.splice(at, 0, item);
    saveState(); broadcast();
    return { ok: true };
  });
  // Drag to reorder: the renderer sends the ids in their new order.
  ipcMain.handle('patterns:reorder', (_event, ids) => {
    if (!Array.isArray(ids) || ids.length !== data.savedPatterns.length) return { ok: false };
    const byId = new Map(data.savedPatterns.map(item => [item.id, item]));
    const next = ids.map(id => byId.get(id));
    if (next.some(item => !item) || new Set(ids).size !== ids.length) return { ok: false };
    data.savedPatterns = next;
    saveState(); broadcast();
    return { ok: true };
  });
  ipcMain.handle('link:open', (_event, url) => {
    if (!ALLOWED_LINKS.has(url)) return { ok: false };
    return shell.openExternal(url).then(() => ({ ok: true }), () => ({ ok: false }));
  });
  ipcMain.handle('clipboard:write', (_event, value) => {
    if (typeof value !== 'string' || value.length > 200) return { ok: false };
    clipboard.writeText(value); return { ok: true };
  });
  ipcMain.handle('window:closePopup', () => { closePopup(); return { ok: true }; });
  ipcMain.handle('screen:settings', () => process.platform === 'darwin'
    ? shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture')
    : Promise.resolve());
  // macOS applies a new Screen Recording permission only after the app restarts.
  ipcMain.handle('app:relaunch', () => { quitting = true; app.relaunch(); app.quit(); });
});

// macOS can send 'activate' as part of launching; when starting hidden, ignore that one.
let ignoreLaunchActivate = false;
app.on('activate', () => {
  if (ignoreLaunchActivate) { ignoreLaunchActivate = false; return; }
  if (!picking) showMain();
});
app.on('browser-window-focus', () => { if (data) broadcast(); });
app.on('before-quit', () => { quitting = true; globalShortcut.unregisterAll(); });
app.on('window-all-closed', () => {});
