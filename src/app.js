const $ = selector => document.querySelector(selector);
const color = window.ColorUI;
let appState = { selected: '#7C5CFF', palette: [], recent: [], shortcut: 'CommandOrControl+Shift+P', shortcutAvailable: true };
let activeView = 'picker';
let shortcutDraftDirty = false;
let toastTimer;

document.body.classList.toggle('mac', window.colorPicker.platform === 'darwin');
$('#shortcut-input').placeholder = 'Press your shortcut';

function shortcutLabel(accelerator) {
  const mac = window.colorPicker.platform === 'darwin';
  return accelerator.replaceAll('CommandOrControl', mac ? '⌘' : 'Ctrl')
    .replaceAll('Command', mac ? '⌘' : 'Win')
    .replaceAll('Control', 'Ctrl').replaceAll('Alt', mac ? '⌥' : 'Alt')
    .replaceAll('Option', '⌥').replaceAll('Super', mac ? '⌘' : 'Win')
    .replaceAll('Shift', '⇧').replaceAll('+', ' ');
}

function shortcutInputLabel(accelerator) {
  const mac = window.colorPicker.platform === 'darwin';
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
  if (event.metaKey) parts.push(window.colorPicker.platform === 'darwin' ? 'Cmd' : 'Win');
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.altKey) parts.push(window.colorPicker.platform === 'darwin' ? 'Option' : 'Alt');
  if (event.shiftKey) parts.push('Shift');
  parts.push(key.replace(/^Arrow/, ''));
  return parts.join('+');
}

// Toast above the tab bar. With an action (e.g. Undo) it stays for `duration`
// and shows a bar counting down the time left.
function toast(message, action) {
  const item = $('#toast');
  const button = item.querySelector('.toast-action');
  const bar = item.querySelector('.toast-progress');
  const duration = action?.duration || 2200;
  item.querySelector('.toast-text').textContent = message;
  item.classList.toggle('has-action', !!action);
  button.hidden = !action;
  button.textContent = action?.label || '';
  button.onclick = action ? () => {
    clearTimeout(toastTimer);
    item.classList.remove('visible');
    action.onClick();
  } : null;
  bar.style.animation = 'none';
  void bar.offsetWidth; // restart the countdown
  bar.style.animation = action ? `toast-countdown ${duration}ms linear forwards` : 'none';
  item.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => item.classList.remove('visible'), duration);
}

// Drag to reorder the children of `container`. Items carry data-key; `onDone`
// gets the keys in their new order when the drag ends.
function makeSortable(container, itemSelector, axis, onDone) {
  let dragged = null;
  let startOrder = '';
  const keys = () => [...container.querySelectorAll(itemSelector)].map(item => item.dataset.key);
  container.addEventListener('dragstart', event => {
    const item = event.target.closest?.(itemSelector);
    if (!item || !container.contains(item)) return;
    dragged = item;
    startOrder = keys().join();
    item.classList.add('dragging');
    container.classList.add('sorting');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', item.dataset.key);
  });
  container.addEventListener('dragover', event => {
    if (!dragged) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const target = event.target.closest?.(itemSelector);
    if (!target || target === dragged || !container.contains(target)) return;
    const rect = target.getBoundingClientRect();
    const after = axis === 'x' ? event.clientX > rect.left + rect.width / 2 : event.clientY > rect.top + rect.height / 2;
    container.insertBefore(dragged, after ? target.nextSibling : target);
  });
  container.addEventListener('drop', event => { if (dragged) event.preventDefault(); });
  container.addEventListener('dragend', () => {
    if (!dragged) return;
    dragged.classList.remove('dragging');
    container.classList.remove('sorting');
    dragged = null;
    const order = keys();
    if (order.join() !== startOrder) onDone(order);
  });
}

function icon(name, className = '') {
  return `<svg class="icon ${className}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
}

// Copy, then briefly swap the button's copy icon for a green check.
async function copy(value, button) {
  const result = await window.colorPicker.copy(value);
  if (!result.ok || !button) return;
  const use = button.querySelector('.copy-icon use');
  use?.setAttribute('href', '#i-check');
  button.classList.add('copied');
  clearTimeout(button.copyTimer);
  button.copyTimer = setTimeout(() => {
    if (!button.isConnected) return;
    use?.setAttribute('href', '#i-copy');
    button.classList.remove('copied');
  }, 1600);
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
    row.className = 'code-row';
    row.title = `Copy ${item.label}`;
    row.innerHTML = `<span class="code-label"></span><span class="code-value"></span>${icon('copy', 'copy-icon')}`;
    row.querySelector('.code-label').textContent = item.label;
    row.querySelector('.code-value').textContent = item.value;
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
    button.addEventListener('click', () => window.colorPicker.selectShade(hex));
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
  for (const hex of appState.recent.slice(0, 12)) {
    const button = document.createElement('button');
    button.className = 'recent-color';
    button.style.background = hex;
    button.title = `Select ${hex}`;
    button.setAttribute('aria-label', `Select ${hex}`);
    button.addEventListener('click', () => window.colorPicker.selectColor(hex));
    list.append(button);
  }
}

function renderPalette() {
  $('#palette-total').textContent = appState.palette.length;
  const saved = appState.palette.includes(appState.selected);
  $('#palette-add-swatch').style.background = appState.selected;
  $('#palette-add-label').textContent = saved ? 'Saved' : `Save ${appState.selected}`;
  $('#palette-add').disabled = saved;
  const grid = $('#palette-grid');
  grid.replaceChildren();
  if (!appState.palette.length) {
    const empty = document.createElement('div');
    empty.className = 'palette-empty';
    empty.innerHTML = `<span class="empty-icon">${icon('palette')}</span><strong>No saved colors yet</strong><p>Pick a color, then use the bookmark button to keep it here.</p>`;
    grid.append(empty);
    return;
  }
  for (const hex of appState.palette) {
    const card = document.createElement('article');
    card.className = 'palette-card';
    card.style.setProperty('--tile', hex);
    card.style.color = color.textOn(hex);
    card.dataset.tone = color.textOn(hex) === '#FFFFFF' ? 'dark' : 'light';
    card.innerHTML = `<button class="palette-swatch" title="Use this color"></button><div class="palette-actions"><button class="palette-copy" title="Copy HEX" aria-label="Copy HEX">${icon('copy', 'copy-icon')}</button><button class="palette-remove" title="Remove color" aria-label="Remove color">${icon('trash')}</button></div><span class="palette-chip"></span>`;
    card.querySelector('.palette-chip').textContent = hex;
    card.querySelector('.palette-swatch').setAttribute('aria-label', `Use ${hex}`);
    card.querySelector('.palette-swatch').addEventListener('click', () => { window.colorPicker.selectColor(hex); setView('picker'); });
    card.querySelector('.palette-copy').addEventListener('click', event => copy(hex, event.currentTarget));
    card.querySelector('.palette-remove').addEventListener('click', () => window.colorPicker.removeColor(hex));
    grid.append(card);
  }
}

function render() {
  if (!pattern && appState.pattern) { pattern = { colors: [...appState.pattern.colors] }; renderPattern(); }
  renderSavedPatterns();
  const hex = appState.selected;
  const card = $('#selected-card');
  const [r, g, b] = color.rgb(hex);
  const saved = appState.palette.includes(hex);
  card.style.background = hex;
  card.style.color = color.textOn(hex);
  $('#selected-hex').textContent = hex;
  $('#selected-rgb').textContent = `rgb(${r}, ${g}, ${b})`;
  $('#save-current').classList.toggle('saved', saved);
  $('#save-current').title = saved ? 'Saved' : 'Save color';
  $('#save-current').setAttribute('aria-label', saved ? 'Saved' : 'Save color');
  $('#native-color').value = hex.toLowerCase();
  if (document.activeElement !== $('#hex-input')) $('#hex-input').value = hex.slice(1);
  $('#pick-shortcut').replaceChildren(...shortcutLabel(appState.shortcut).split(' ').filter(Boolean).map(key => {
    const cap = document.createElement('kbd');
    cap.textContent = key;
    return cap;
  }));
  $('#shortcut-display').textContent = shortcutLabel(appState.shortcut);
  if (!shortcutDraftDirty && document.activeElement !== $('#shortcut-input')) $('#shortcut-input').value = shortcutInputLabel(appState.shortcut);
  renderTheme();
  renderPreferences();
  $('#zoom-permission').hidden = appState.screenPermission === 'granted';
  renderFormats();
  renderTones();
  renderRecent();
  renderPalette();
}

function renderPreferences() {
  document.querySelectorAll('[data-pref]').forEach(button => {
    button.setAttribute('aria-checked', String(!!appState[button.dataset.pref]));
  });
  if (window.colorPicker.platform !== 'darwin') $('#tray-pref-label').textContent = 'Show tray icon';
  const dev = appState.developer;
  if (dev) {
    $('#dev-name').textContent = dev.name;
    $('#dev-email-text').textContent = dev.email;
    $('#dev-portfolio-text').textContent = dev.portfolio.replace(/^https?:\/\//, '');
  }
  renderAbout();
}

function renderAbout() {
  const mac = window.colorPicker.platform === 'darwin';
  const arch = appState.arch === 'arm64' ? (mac ? 'Apple Silicon' : 'ARM64') : (mac ? 'Intel' : 'x64');
  if (appState.version) $('#about-version').textContent = appState.version;
  $('#about-platform').textContent = `${mac ? 'macOS' : 'Windows'} · ${arch}`;
  $('#about-shortcut').textContent = shortcutLabel(appState.shortcut);
  $('#about-saved').textContent = `${appState.palette.length} of ${appState.maxSaved || 250}`;
  $('#about-recent').textContent = `Last ${appState.maxRecent || 24} picks`;
}

// ---------- Palette (color pattern) ----------
// 2–8 flat colors in equal-width blocks; click a block to pick its color.
const MIN_COLORS = 2;
const MAX_COLORS = 8;
let pattern = null;
let patternFormat = 'hex';
let patternSaveTimer;

function patternText(format = patternFormat) {
  const colors = pattern.colors;
  if (format === 'css') return `:root {\n${colors.map((hex, i) => `  --color-${i + 1}: ${hex};`).join('\n')}\n}`;
  if (format === 'json') return JSON.stringify(colors);
  return colors.join(', ');
}

function savePattern() {
  clearTimeout(patternSaveTimer);
  patternSaveTimer = setTimeout(() => window.colorPicker.setPattern(pattern), 250);
}

function renderPatternText() {
  $('#pattern-text').textContent = patternText();
}

function patternBlock(hex, index) {
  const block = document.createElement('div');
  block.className = 'pattern-block';
  block.draggable = true;
  block.dataset.key = String(index);
  block.innerHTML = `<button type="button" class="block-pick"></button>`
    + `<div class="block-actions"><label class="block-action" title="Change color">${icon('edit')}<input type="color" aria-label="Change color ${index + 1}"></label>`
    + (pattern.colors.length > MIN_COLORS ? `<button type="button" class="block-action block-remove" title="Remove color" aria-label="Remove color ${index + 1}">${icon('x')}</button>` : '')
    + `</div><span class="block-hex"></span>`;
  const input = block.querySelector('input');
  const show = value => {
    block.style.background = value;
    block.style.color = color.textOn(value);
    block.querySelector('.block-hex').textContent = value;
    block.querySelector('.block-pick').title = `Copy ${value}`;
    block.querySelector('.block-pick').setAttribute('aria-label', `Copy ${value}`);
    input.value = value.toLowerCase();
  };
  show(hex);
  // Clicking a color copies its HEX straight to the clipboard.
  block.querySelector('.block-pick').addEventListener('click', async () => {
    const value = pattern.colors[index];
    const result = await window.colorPicker.copy(value);
    if (result?.ok) toast(`${value} copied`);
  });
  // Update in place while the color panel is open, so the panel stays attached.
  input.addEventListener('input', () => {
    const value = color.normalize(input.value);
    if (!value) return;
    pattern.colors[index] = value;
    show(value);
    renderPatternText();
    savePattern();
  });
  block.querySelector('.block-remove')?.addEventListener('click', () => {
    pattern.colors.splice(index, 1);
    renderPattern();
    savePattern();
  });
  return block;
}

function renderPattern() {
  if (!pattern) return;
  const count = pattern.colors.length;
  $('#pattern-count').textContent = `${count}/${MAX_COLORS}`;
  $('#pattern-preview').replaceChildren(...pattern.colors.map(patternBlock));
  renderPatternText();
  $('#pattern-add').disabled = count >= MAX_COLORS;
  $('#pattern-add').title = count >= MAX_COLORS ? `Up to ${MAX_COLORS} colors` : 'Add a new color related to the last one';
}

// A new color related to the last one: the next step around the color wheel,
// same saturation, lightness nudged toward the middle so the palette stays balanced.
function relatedColor(hex) {
  const [h, sat, l] = color.hsl(hex);
  const clampValue = (value, min, max) => Math.max(min, Math.min(max, value));
  const step = l > 62 ? -10 : l < 38 ? 12 : (pattern.colors.length % 2 ? -7 : 7);
  const make = (offset, extra = 0) => sat < 8
    ? color.hslHex(h, sat, clampValue(l + step + extra, 12, 90))   // grays: change lightness only
    : color.hslHex(h + offset, clampValue(sat, 20, 85), clampValue(l + step + extra, 18, 86));
  let next = make(24);
  for (let tries = 1; pattern.colors.includes(next) && tries < 8; tries++) next = make(24 + tries * 12, tries * 3);
  return next;
}

function renderSavedPatterns() {
  const list = $('#saved-patterns');
  const items = appState.savedPatterns || [];
  $('#patterns-total').textContent = items.length;
  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-note';
    empty.textContent = 'Save a palette to keep it here for later.';
    list.replaceChildren(empty);
    return;
  }
  list.replaceChildren(...items.map(item => {
    const row = document.createElement('div');
    row.className = 'saved-pattern';
    row.draggable = true;
    row.dataset.key = item.id;
    row.innerHTML = `<span class="drag-grip" title="Drag to reorder" aria-hidden="true">${icon('grip')}</span><button type="button" class="saved-strip" title="Open this palette"></button><div class="saved-pattern-actions"><button type="button" class="icon-button" title="Copy colors" aria-label="Copy colors">${icon('copy', 'copy-icon')}</button><button type="button" class="icon-button danger" title="Delete palette" aria-label="Delete palette">${icon('trash')}</button></div>`;
    const strip = row.querySelector('.saved-strip');
    strip.setAttribute('aria-label', `Open palette ${item.colors.join(', ')}`);
    for (const hex of item.colors) {
      const band = document.createElement('span');
      band.style.background = hex;
      strip.append(band);
    }
    strip.addEventListener('click', () => {
      pattern = { colors: [...item.colors] };
      renderPattern();
      savePattern();
      toast('Palette opened');
    });
    const [copyButton, deleteButton] = row.querySelectorAll('.icon-button');
    copyButton.addEventListener('click', event => copy(item.colors.join(', '), event.currentTarget).then(() => toast('Palette copied')));
    // Delete, with 5 seconds to undo.
    deleteButton.addEventListener('click', async () => {
      const index = (appState.savedPatterns || []).findIndex(saved => saved.id === item.id);
      await window.colorPicker.removePattern(item.id);
      toast('Palette deleted', {
        label: 'Undo',
        duration: 5000,
        onClick: async () => {
          const result = await window.colorPicker.restorePattern(item, index);
          toast(result?.ok ? 'Palette restored' : (result?.error || 'Could not restore the palette'));
        }
      });
    });
    return row;
  }));
}

// Save, then report the outcome (already saved, list full, or saved).
async function saveCurrent() {
  const result = await window.colorPicker.saveColor(appState.selected);
  if (!result?.ok) toast(result?.error || 'Could not save this color');
  else toast(result.already ? 'Already saved' : 'Color saved');
}

function renderTheme() {
  const theme = appState.theme || 'system';
  document.querySelectorAll('[data-theme]').forEach(button => {
    const active = button.dataset.theme === theme;
    button.classList.toggle('active', active);
    button.setAttribute('aria-checked', String(active));
  });
}

async function applyHex() {
  const value = color.normalize($('#hex-input').value);
  // Flag the field and explain in a toast, so the fixed layout never shifts.
  $('.hex-box').classList.toggle('invalid', !value);
  if (!value) { toast('Enter a 3 or 6 digit HEX color'); return; }
  await window.colorPicker.selectColor(value);
  $('#hex-input').blur();
}

document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
$('#start-picker').addEventListener('click', () => window.colorPicker.startPicker());
$('#open-screen-settings').addEventListener('click', () => window.colorPicker.openScreenSettings());
$('#relaunch-app').addEventListener('click', () => window.colorPicker.relaunch());
$('#save-current').addEventListener('click', saveCurrent);
$('#copy-current').addEventListener('click', event => copy(appState.selected, event.currentTarget));
document.querySelectorAll('[data-theme]').forEach(button => button.addEventListener('click', async () => {
  const result = await window.colorPicker.setTheme(button.dataset.theme);
  if (result?.ok) { appState.theme = result.theme; renderTheme(); }
}));
$('#palette-add').addEventListener('click', saveCurrent);
document.querySelectorAll('[data-pref]').forEach(button => button.addEventListener('click', async () => {
  const key = button.dataset.pref;
  const result = await window.colorPicker.setPreference(key, !appState[key]);
  if (!result?.ok) { toast(result?.error || 'Could not change this setting'); return; }
  appState[key] = result.value;
  renderPreferences();
}));
$('#dev-email').addEventListener('click', () => window.colorPicker.openLink(`mailto:${appState.developer.email}`));
$('#dev-portfolio').addEventListener('click', () => window.colorPicker.openLink(appState.developer.portfolio));
$('#support-link').addEventListener('click', () => window.colorPicker.openLink(appState.developer.support));
$('#native-color').addEventListener('input', event => window.colorPicker.selectColor(event.target.value));
$('#apply-hex').addEventListener('click', applyHex);
$('#hex-input').addEventListener('keydown', event => { if (event.key === 'Enter') applyHex(); });
$('#hex-input').addEventListener('input', () => $('.hex-box').classList.remove('invalid'));
$('#shortcut-form').addEventListener('submit', async event => {
  event.preventDefault();
  const result = await window.colorPicker.setShortcut($('#shortcut-input').value);
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
$('#shortcut-input').addEventListener('focus', () => window.colorPicker.setShortcutEditing(true));
$('#shortcut-input').addEventListener('blur', () => window.colorPicker.setShortcutEditing(false));
$('#reset-shortcut').addEventListener('click', async () => {
  const result = await window.colorPicker.resetShortcut();
  $('#shortcut-feedback').textContent = result.ok ? 'Default shortcut restored.' : result.error;
  if (result.ok) {
    shortcutDraftDirty = false;
    $('#shortcut-input').value = shortcutInputLabel(result.shortcut);
    $('#shortcut-input').blur();
    toast('Default shortcut restored');
  }
});
// Palette events
makeSortable($('#pattern-preview'), '.pattern-block', 'x', order => {
  pattern.colors = order.map(key => pattern.colors[Number(key)]);
  renderPattern();
  savePattern();
});
makeSortable($('#saved-patterns'), '.saved-pattern', 'y', order => window.colorPicker.reorderPatterns(order));
const copyPattern = event => copy(patternText(), event.currentTarget).then(() => toast('Palette copied'));
$('#pattern-copy').addEventListener('click', copyPattern);
$('#pattern-code').addEventListener('click', copyPattern);
$('#pattern-add').addEventListener('click', () => {
  if (pattern.colors.length >= MAX_COLORS) return;
  pattern.colors.push(relatedColor(pattern.colors[pattern.colors.length - 1]));
  renderPattern();
  savePattern();
});
$('#pattern-save').addEventListener('click', async () => {
  const result = await window.colorPicker.savePattern(pattern);
  if (!result?.ok) toast(result?.error || 'Could not save this palette');
  else toast(result.already ? 'This palette is already saved' : 'Palette saved');
});
$('#pattern-reverse').addEventListener('click', () => { pattern.colors.reverse(); renderPattern(); savePattern(); });
$('#pattern-shuffle').addEventListener('click', () => {
  const colors = pattern.colors;
  for (let i = colors.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [colors[i], colors[j]] = [colors[j], colors[i]];
  }
  renderPattern();
  savePattern();
});
document.querySelectorAll('[data-format]').forEach(button => button.addEventListener('click', () => {
  patternFormat = button.dataset.format;
  document.querySelectorAll('[data-format]').forEach(item => {
    item.classList.toggle('active', item === button);
    item.setAttribute('aria-checked', String(item === button));
  });
  renderPatternText();
}));

// Settings sections
document.querySelectorAll('[data-pane]').forEach(button => button.addEventListener('click', () => {
  const pane = button.dataset.pane;
  document.querySelectorAll('[data-pane]').forEach(item => {
    item.classList.toggle('active', item === button);
    item.setAttribute('aria-selected', String(item === button));
  });
  document.querySelectorAll('.settings-pane').forEach(item => item.classList.toggle('active', item.id === `pane-${pane}`));
  $('#settings-subtitle').textContent = pane === 'about' ? 'About the app and its developer.' : 'Shortcut, startup and appearance.';
}));

window.colorPicker.onState(next => { appState = next; render(); });
window.colorPicker.onPickerError(result => {
  toast(result.error);
});
window.colorPicker.getState().then(next => { appState = next; render(); });
