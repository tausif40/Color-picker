const KEYS = /^(?:[A-Z0-9]|F(?:[1-9]|1\d|2[0-4])|Space|Enter|Tab|Backspace|Escape|Up|Down|Left|Right)$/;

function normalizeShortcut(value, platform = process.platform) {
  if (typeof value !== 'string' || value.length > 80) return null;
  const parts = value.trim().split(/\s*\+\s*/);
  if (!parts.length || parts.some(part => !part)) return null;

  const keyNames = { SPACE: 'Space', SPACEBAR: 'Space', RETURN: 'Enter', ENTER: 'Enter', ESC: 'Escape', ESCAPE: 'Escape', BACKSPACE: 'Backspace', TAB: 'Tab', ARROWUP: 'Up', ARROWDOWN: 'Down', ARROWLEFT: 'Left', ARROWRIGHT: 'Right', UP: 'Up', DOWN: 'Down', LEFT: 'Left', RIGHT: 'Right' };
  const modifierNames = {
    CMD: 'CommandOrControl', COMMAND: 'CommandOrControl', COMMANDORCONTROL: 'CommandOrControl', CMDORCTRL: 'CommandOrControl',
    CTRL: platform === 'darwin' ? 'Control' : 'CommandOrControl', CONTROL: platform === 'darwin' ? 'Control' : 'CommandOrControl',
    ALT: 'Alt', OPTION: 'Alt', OPT: 'Alt', SHIFT: 'Shift', WIN: 'Super', WINDOWS: 'Super', SUPER: 'Super', META: 'Super'
  };
  const modifiers = [];
  for (const part of parts.slice(0, -1)) {
    const modifier = modifierNames[part.toUpperCase()];
    if (!modifier || modifiers.includes(modifier)) return null;
    modifiers.push(modifier);
  }
  const rawKey = parts.at(-1).toUpperCase();
  const key = keyNames[rawKey] || rawKey;
  if (!KEYS.test(key)) return null;
  return [...modifiers, key].join('+');
}

module.exports = { normalizeShortcut };
