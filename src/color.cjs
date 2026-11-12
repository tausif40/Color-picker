function normalizeHex(value) {
  if (typeof value !== 'string') return null;
  const hex = value.trim().replace(/^#/, '');
  if (/^[\da-f]{3}$/i.test(hex)) return `#${hex.split('').map(x => x + x).join('').toUpperCase()}`;
  if (/^[\da-f]{6}$/i.test(hex)) return `#${hex.toUpperCase()}`;
  if (/^[\da-f]{8}$/i.test(hex)) return `#${hex.slice(0, 6).toUpperCase()}`;
  return null;
}

function hexToRgb(hex) {
  const clean = normalizeHex(hex);
  if (!clean) return null;
  return [1, 3, 5].map(start => parseInt(clean.slice(start, start + 2), 16));
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const difference = max - min;
  let hue = 0, saturation = 0;
  const lightness = (max + min) / 2;
  if (difference) {
    saturation = difference / (1 - Math.abs(2 * lightness - 1));
    switch (max) {
      case r: hue = ((g - b) / difference) % 6; break;
      case g: hue = (b - r) / difference + 2; break;
      default: hue = (r - g) / difference + 4;
    }
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  return [Math.round(hue), Math.round(saturation * 100), Math.round(lightness * 100)];
}

function hueToRgb(p, q, t) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function hslToHex(h, s, l) {
  h = (((h % 360) + 360) % 360) / 360;
  s = Math.max(0, Math.min(1, s / 100));
  l = Math.max(0, Math.min(1, l / 100));
  let r, g, b;
  if (s === 0) r = g = b = l;
  else {
    const q = l < .5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hueToRgb(p, q, h + 1 / 3);
    g = hueToRgb(p, q, h);
    b = hueToRgb(p, q, h - 1 / 3);
  }
  return '#' + [r, g, b].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
}

function formats(hex) {
  const clean = normalizeHex(hex);
  if (!clean) return null;
  const [r, g, b] = hexToRgb(clean);
  const [h, s, l] = rgbToHsl(r, g, b);
  const k = 1 - Math.max(r, g, b) / 255;
  const c = k === 1 ? 0 : (1 - r / 255 - k) / (1 - k);
  const m = k === 1 ? 0 : (1 - g / 255 - k) / (1 - k);
  const y = k === 1 ? 0 : (1 - b / 255 - k) / (1 - k);
  return {
    hex: clean,
    hexa: `${clean}FF`,
    rgb: `rgb(${r}, ${g}, ${b})`,
    hsla: `hsla(${h}, ${s}%, ${l}%, 1)`,
    cmyk: `cmyk(${[c, m, y, k].map(v => Math.round(v * 100) + '%').join(', ')})`,
    hsl: [h, s, l],
    rgbParts: [r, g, b]
  };
}

module.exports = { normalizeHex, hexToRgb, rgbToHsl, hslToHex, formats };
