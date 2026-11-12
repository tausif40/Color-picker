const $ = selector => document.querySelector(selector);
const color = window.ColorUI;
let appState = { selected: '#7C5CFF', palette: [], recent: [], shortcut: 'CommandOrControl+Shift+P', shortcutAvailable: true };
let activeView = 'picker';
let shortcutDraftDirty = false;
let toastTimer;

document.body.classList.toggle('mac', window.prism.platform === 'darwin');
$('#shortcut-input').placeholder = 'Press your shortcut';

function shortcutLabel(accelerator) {
  const mac = window.prism.platform === 'darwin';
  return accelerator.replaceAll('CommandOrControl', mac ? '⌘' : 'Ctrl')
    .replaceAll('Command', mac ? '⌘' : 'Win')
    .replaceAll('Control', 'Ctrl').replaceAll('Alt', mac ? '⌥' : 'Alt')
    .replaceAll('Option', '⌥').replaceAll('Super', mac ? '⌘' : 'Win')
    .replaceAll('Shift', '⇧').replaceAll('+', ' ');
}

function shortcutInputLabel(accelerator) {
  const mac = window.prism.platform === 'darwin';
  return accelerator.replaceAll('CommandOrControl', mac ? 'Cmd' : 'Ctrl')
    .replaceAll('Command', 'Cmd').replaceAll('Control', 'Ctrl')
    .replaceAll('Option', mac ? 'Option' : 'Alt').replaceAll('Alt', mac ? 'Option' : 'Alt')
    .replaceAll('Super', mac ? 'Cmd' : 'Win');
}

function pressedShortcut(event) {
  if (['Meta', 'Control', 'Alt', 'Shift'].includes(event.key)) return null;
  const key = /^Key[A-Z]$/.test(event.code) ? event.code.slice(3)
    : /^Digit[0-9]$/.test(event.code) ? event.code.slice(5)
    : event.key === ' ' ? 'Space' : event.key.length === 1 ? event.key.toUpperCase() : event.key;
  if (!/^(?:[A-Z0-9]|F(?:[1-9]|1\d|2[0-4])|Space|Enter|Tab|Backspace|Escape|ArrowUp|ArrowDown|ArrowLeft|ArrowRight)$/.test(key)) return null;
  const parts = [];
  if (event.metaKey) parts.push(window.prism.platform === 'darwin' ? 'Cmd' : 'Win');
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.altKey) parts.push(window.prism.platform === 'darwin' ? 'Option' : 'Alt');
  if (event.shiftKey) parts.push('Shift');
  parts.push(key.replace(/^Arrow/, ''));
  return parts.join('+');
}

function toast(message) {
  const item = $('#toast');
  item.textContent = message;
  item.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => item.classList.remove('visible'), 2200);
}

async function copy(value, button) {
  const result = await window.prism.copy(value);
  if (!result.ok || !button) return;
  const icon = button.querySelector('.copy-icon') || button;
  icon.textContent = '✓';
  button.classList.add('copied');
  clearTimeout(button.copyTimer);
  button.copyTimer = setTimeout(() => {
    if (!button.isConnected) return;
    icon.textContent = '⧉';
    button.classList.remove('copied');
  }, 1800);
}

function setView(view) {
  activeView = view;
  document.querySelectorAll('.view').forEach(item => item.classList.toggle('active', item.id === `view-${view}`));
  document.querySelectorAll('.tab').forEach(item => item.classList.toggle('active', item.dataset.view === view));
  $('.app-content').scrollTop = 0;
}

function renderFormats() {
  const list = $('#format-list');
  list.replaceChildren();
  for (const item of color.formats(appState.selected)) {
    const row = document.createElement('button');
    row.className = 'code-card';
    row.title = `Copy ${item.label}`;
    row.innerHTML = '<span class="code-label"></span><strong></strong><span class="copy-icon">⧉</span>';
    row.querySelector('.code-label').textContent = item.label;
    row.querySelector('strong').textContent = item.value;
    row.addEventListener('click', () => copy(item.value, row));
    list.append(row);
  }
}

function renderTones() {
  const list = $('#tone-list');
  list.replaceChildren();
  for (const hex of color.tonePalette(appState.toneBase || appState.selected)) {
    const button = document.createElement('button');
    button.className = `tone ${hex === appState.selected ? 'selected' : ''}`;
    button.title = `Select ${hex}`;
    button.setAttribute('aria-label', `Select shade ${hex}`);
    button.innerHTML = '<span class="tone-color"></span><small></small>';
    button.querySelector('.tone-color').style.background = hex;
    button.querySelector('small').textContent = hex.slice(1);
    button.addEventListener('click', async () => { await window.prism.selectShade(hex); await copy(hex); });
    list.append(button);
  }
}

function renderRecent() {
  const list = $('#recent-list');
  list.replaceChildren();
  if (!appState.recent.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-note';
    empty.textContent = 'Picked colors will appear here.';
    list.append(empty);
    return;
  }
  for (const hex of appState.recent.slice(0, 8)) {
    const button = document.createElement('button');
    button.className = 'recent-color';
    button.style.background = hex;
    button.title = `Select ${hex}`;
    button.setAttribute('aria-label', `Select ${hex}`);
    button.addEventListener('click', () => window.prism.selectColor(hex));
    list.append(button);
  }
}

function renderPalette() {
  $('#palette-count').textContent = appState.palette.length;
  const grid = $('#palette-grid');
  grid.replaceChildren();
  if (!appState.palette.length) {
    const empty = document.createElement('div');
    empty.className = 'palette-empty';
    empty.innerHTML = '<span>◉</span><strong>No saved colors yet</strong><p>Pick a color and press ＋ to keep it here.</p>';
    grid.append(empty);
    return;
  }
  for (const hex of appState.palette) {
    const card = document.createElement('article');
    card.className = 'palette-card';
    card.innerHTML = '<button class="palette-swatch" title="Select color"></button><div class="palette-details"><strong></strong><div><button class="palette-copy" title="Copy HEX" aria-label="Copy HEX">⧉</button><button class="palette-remove" title="Remove color" aria-label="Remove color">×</button></div></div>';
    card.querySelector('.palette-swatch').style.background = hex;
    card.querySelector('strong').textContent = hex;
    card.querySelector('.palette-swatch').addEventListener('click', () => { window.prism.selectColor(hex); setView('picker'); });
    card.querySelector('.palette-copy').addEventListener('click', event => copy(hex, event.currentTarget));
    card.querySelector('.palette-remove').addEventListener('click', () => window.prism.removeColor(hex));
    grid.append(card);
  }
}

function render() {
  const hex = appState.selected;
  const card = $('#selected-card');
  card.style.background = hex;
  card.style.color = color.textOn(hex);
  $('#selected-hex').textContent = hex;
  $('#native-color').value = hex.toLowerCase();
  if (document.activeElement !== $('#hex-input')) $('#hex-input').value = hex.slice(1);
  $('#pick-shortcut').textContent = shortcutLabel(appState.shortcut);
  $('#shortcut-display').textContent = shortcutLabel(appState.shortcut);
  if (!shortcutDraftDirty && document.activeElement !== $('#shortcut-input')) $('#shortcut-input').value = shortcutInputLabel(appState.shortcut);
  const status = $('.app-status');
  status.lastChild.textContent = appState.picking ? ' Opening picker' : appState.shortcutEditing ? ' Editing shortcut' : appState.shortcutAvailable ? ' Ready' : ' Shortcut off';
  status.classList.toggle('warning', !appState.shortcutEditing && !appState.shortcutAvailable);
  $('#zoom-permission').hidden = appState.screenPermission !== 'denied' && appState.screenPermission !== 'restricted';
  renderFormats();
  renderTones();
  renderRecent();
  renderPalette();
}

async function applyHex() {
  const value = color.normalize($('#hex-input').value);
  if (!value) { $('#hex-error').textContent = 'Enter a 3 or 6 digit HEX color.'; return; }
  $('#hex-error').textContent = '';
  await window.prism.selectColor(value);
  $('#hex-input').blur();
}

document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
$('#start-picker').addEventListener('click', () => window.prism.startPicker());
$('#open-screen-settings').addEventListener('click', () => window.prism.openScreenSettings());
$('#save-current').addEventListener('click', async () => { await window.prism.saveColor(appState.selected); toast('Color saved'); });
$('#palette-add').addEventListener('click', async () => { await window.prism.saveColor(appState.selected); toast('Color saved'); });
$('#native-color').addEventListener('input', event => window.prism.selectColor(event.target.value));
$('#apply-hex').addEventListener('click', applyHex);
$('#hex-input').addEventListener('keydown', event => { if (event.key === 'Enter') applyHex(); });
$('#shortcut-form').addEventListener('submit', async event => {
  event.preventDefault();
  const result = await window.prism.setShortcut($('#shortcut-input').value);
  $('#shortcut-feedback').textContent = result.ok ? 'Shortcut saved.' : result.error;
  if (result.ok) {
    shortcutDraftDirty = false;
    $('#shortcut-input').value = shortcutInputLabel(result.shortcut);
    $('#shortcut-input').blur();
    toast('Shortcut saved');
  }
});
$('#shortcut-input').addEventListener('keydown', event => {
  const shortcut = pressedShortcut(event);
  event.preventDefault();
  if (!shortcut) return;
  event.target.value = shortcut;
  shortcutDraftDirty = true;
  $('#shortcut-feedback').textContent = '';
});
$('#shortcut-input').addEventListener('beforeinput', event => event.preventDefault());
$('#shortcut-input').addEventListener('focus', () => window.prism.setShortcutEditing(true));
$('#shortcut-input').addEventListener('blur', () => window.prism.setShortcutEditing(false));
$('#reset-shortcut').addEventListener('click', async () => {
  const result = await window.prism.resetShortcut();
  $('#shortcut-feedback').textContent = result.ok ? 'Default shortcut restored.' : result.error;
  if (result.ok) {
    shortcutDraftDirty = false;
    $('#shortcut-input').value = shortcutInputLabel(result.shortcut);
    $('#shortcut-input').blur();
    toast('Default shortcut restored');
  }
});
window.prism.onState(next => { appState = next; render(); });
window.prism.onPickerError(result => {
  toast(result.error);
});
window.prism.getState().then(next => { appState = next; render(); });
