(function () {
  function normalize(value) {
    if (typeof value !== 'string') return null;
    const raw = value.trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(raw)) return '#' + raw.split('').map(c => c + c).join('').toUpperCase();
    if (/^[0-9a-f]{6}$/i.test(raw)) return '#' + raw.toUpperCase();
    if (/^[0-9a-f]{8}$/i.test(raw)) return '#' + raw.slice(0, 6).toUpperCase();
    return null;
  }
  function rgb(hex) { const v = normalize(hex); return [1, 3, 5].map(i => parseInt(v.slice(i, i + 2), 16)); }
  function hsl(hex) {
    let [r, g, b] = rgb(hex).map(v => v / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2;
    let h = 0, s = 0;
    if (d) {
      s = d / (1 - Math.abs(2 * l - 1));
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h = (h * 60 + 360) % 360;
    }
    return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
  }
  function hslHex(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360; s /= 100; l /= 100;
    s = Math.max(0, Math.min(1, s)); l = Math.max(0, Math.min(1, l));
    const a = s * Math.min(l, 1 - l);
    const f = n => { const k = (n + h * 12) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
    return '#' + [f(0), f(8), f(4)].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
  }
  function formats(hex) {
    hex = normalize(hex);
    const [r, g, b] = rgb(hex), [h, s, l] = hsl(hex);
    const k = 1 - Math.max(r, g, b) / 255;
    const cmy = k === 1 ? [0, 0, 0] : [r, g, b].map(v => (1 - v / 255 - k) / (1 - k));
    return [
      { label: 'HEX', value: hex, accent: 'purple' },
      { label: 'HEXA', value: hex + 'FF', accent: 'purple' },
      { label: 'RGB', value: `rgb(${r}, ${g}, ${b})`, accent: 'pink' },
      { label: 'HSLA', value: `hsla(${h}, ${s}%, ${l}%, 1)`, accent: 'blue' },
      { label: 'CMYK', value: `cmyk(${[...cmy, k].map(v => Math.round(v * 100) + '%').join(', ')})`, accent: 'amber' }
    ];
  }
  function textOn(hex) {
    const [r, g, b] = rgb(hex).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
    return .2126 * r + .7152 * g + .0722 * b > .35 ? '#15171D' : '#FFFFFF';
  }
  function suggestions(hex) {
    const [h, s, l] = hsl(hex);
    return [hslHex(h, Math.max(s - 13, 12), Math.min(l + 35, 93)), hslHex(h, Math.max(s - 7, 16), Math.min(l + 18, 85)), normalize(hex), hslHex(h, s, Math.max(l - 17, 10)), hslHex(h, Math.min(s + 6, 100), Math.max(l - 34, 7))];
  }
  function tonePalette(hex) {
    const [h, s, l] = hsl(hex);
    return [-3, -2, -1, 0, 1, 2, 3].map(step => {
      if (step === 0) return normalize(hex);
      const lightness = step < 0 ? l + (100 - l) * (-step / 4) : l * (1 - step / 4);
      return hslHex(h, s, lightness);
    });
  }
  window.ColorUI = { normalize, rgb, hsl, hslHex, formats, textOn, suggestions, tonePalette };
})();
