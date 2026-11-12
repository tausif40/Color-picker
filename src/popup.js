const $ = selector => document.querySelector(selector);
const color = window.ColorUI;
let selected = '#7C5CFF';
let toneBase = '#7C5CFF';
let palette = [];
let toastTimer;

function showToast(message) {
  const item = $('#popup-toast');
  item.textContent = message;
  item.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => item.classList.remove('visible'), 1600);
}

async function copy(value, button) {
  const result = await window.prism.copy(value);
  if (!result.ok) return;
  const icon = button?.querySelector('.copy-icon');
  if (icon) {
    icon.textContent = '✓';
    button.classList.add('copied');
    clearTimeout(button.copyTimer);
    button.copyTimer = setTimeout(() => {
      if (!button.isConnected) return;
      icon.textContent = '⧉';
      button.classList.remove('copied');
    }, 1800);
  }
}

function render(state) {
  selected = state.selected;
  toneBase = state.toneBase || selected;
  palette = state.palette;
  $('#popup-hex').textContent = selected;
  $('#popup-preview').style.background = selected;
  $('#popup-preview').style.color = color.textOn(selected);
  $('#popup-save').textContent = palette.includes(selected) ? '✓ Saved' : '＋ Save';

  const formats = $('#popup-formats');
  formats.replaceChildren();
  for (const item of color.formats(selected)) {
    const row = document.createElement('button');
    row.className = 'popup-format-row';
    row.title = `Copy ${item.label}`;
    row.innerHTML = '<span class="popup-format-name"></span><strong></strong><span class="copy-icon">⧉</span>';
    row.querySelector('.popup-format-name').textContent = item.label;
    row.querySelector('strong').textContent = item.value;
    row.addEventListener('click', () => copy(item.value, row));
    formats.append(row);
  }

  const tones = $('#popup-tones');
  tones.replaceChildren();
  for (const hex of color.tonePalette(toneBase)) {
    const button = document.createElement('button');
    button.className = `popup-tone ${hex === selected ? 'selected' : ''}`;
    button.title = `Select ${hex}`;
    button.setAttribute('aria-label', `Select shade ${hex}`);
    button.innerHTML = '<span></span><small></small>';
    button.querySelector('span').style.background = hex;
    button.querySelector('small').textContent = hex.slice(1);
    button.addEventListener('click', async () => { await window.prism.selectShade(hex); await copy(hex); });
    tones.append(button);
  }
}

$('#popup-close').addEventListener('click', () => window.prism.closePopup());
$('#popup-save').addEventListener('click', async () => { await window.prism.saveColor(selected); showToast('Color saved'); });
window.addEventListener('keydown', event => { if (event.key === 'Escape') window.prism.closePopup(); });
window.prism.onState(render);
window.prism.getState().then(render);
