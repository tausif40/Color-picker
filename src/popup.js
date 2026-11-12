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
  const result = await window.colorPicker.copy(value);
  if (!result.ok) return;
  const use = button?.querySelector('.copy-icon use');
  if (!use) return;
  use.setAttribute('href', '#i-check');
  button.classList.add('copied');
  clearTimeout(button.copyTimer);
  button.copyTimer = setTimeout(() => {
    if (!button.isConnected) return;
    use.setAttribute('href', '#i-copy');
    button.classList.remove('copied');
  }, 1600);
}

function render(state) {
  selected = state.selected;
  toneBase = state.toneBase || selected;
  palette = state.palette;
  $('#popup-hex').textContent = selected;
  $('#popup-preview').style.background = selected;
  $('#popup-preview').style.color = color.textOn(selected);
  const saved = palette.includes(selected);
  $('#popup-save-label').textContent = saved ? 'Saved' : 'Save';
  $('#popup-save').classList.toggle('saved', saved);

  const formats = $('#popup-formats');
  formats.replaceChildren();
  for (const item of color.formats(selected)) {
    const row = document.createElement('button');
    row.className = 'popup-format-row';
    row.title = `Copy ${item.label}`;
    row.innerHTML = '<span class="popup-format-name"></span><strong></strong><svg class="icon copy-icon" aria-hidden="true"><use href="#i-copy"/></svg>';
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
    button.addEventListener('click', () => window.colorPicker.selectShade(hex));
    tones.append(button);
  }
}

$('#popup-close').addEventListener('click', () => window.colorPicker.closePopup());
$('#popup-copy').addEventListener('click', event => copy(selected, event.currentTarget));
$('#popup-save').addEventListener('click', async () => {
  const result = await window.colorPicker.saveColor(selected);
  if (!result?.ok) showToast(result?.error || 'Could not save this color');
  else showToast(result.already ? 'Already saved' : 'Color saved');
});
window.addEventListener('keydown', event => { if (event.key === 'Escape') window.colorPicker.closePopup(); });
window.colorPicker.onState(render);
window.colorPicker.getState().then(render);
