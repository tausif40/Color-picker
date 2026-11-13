/* Render the checked-in SVG artwork into the icon formats used by Electron. */
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const assets = path.join(__dirname, '..', 'assets');
app.on('window-all-closed', () => {});

// Draw the SVG onto an sRGB canvas and read back a PNG. (capturePage would
// return the display's color space, which shifts the colors on P3 screens.)
async function render(svg, size, padding = 0) {
  const window = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
  try {
    await window.loadURL('data:text/html,<!doctype html><title>icons</title>');
    const source = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
    const dataUrl = await window.webContents.executeJavaScript(`(async () => {
      const image = new Image();
      image.src = ${JSON.stringify(source)};
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = ${size};
      const context = canvas.getContext('2d', { colorSpace: 'srgb' });
      context.imageSmoothingQuality = 'high';
      context.drawImage(image, ${padding}, ${padding}, ${size - 2 * padding}, ${size - 2 * padding});
      return canvas.toDataURL('image/png');
    })()`);
    return nativeImage.createFromDataURL(dataUrl);
  } finally {
    window.destroy();
  }
}

function bounds(image) {
  const { width, height } = image.getSize();
  const bitmap = image.toBitmap();
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (bitmap[(y * width + x) * 4 + 3] < 4) continue;
    left = Math.min(left, x); top = Math.min(top, y);
    right = Math.max(right, x); bottom = Math.max(bottom, y);
  }
  return { left, top, right, bottom, width, height };
}

async function main() {
  const appSvg = fs.readFileSync(path.join(assets, 'color_picker_icon.svg'), 'utf8');
  const outlineSvg = fs.readFileSync(path.join(assets, 'dropper-outline.svg'), 'utf8');
  if (process.argv.includes('--bounds')) {
    console.log('app', bounds(await render(appSvg, 1024)));
    console.log('outline', bounds(await render(outlineSvg, 1024)));
    return;
  }

  // macOS: Apple's 1024 grid keeps the rounded square at ~824px with an empty
  // margin, so the icon sits at the same size as other apps in the Dock.
  const macImage = await render(appSvg, 1024, 100);
  const macImages = new Map();
  for (const size of [16, 32, 64, 128, 256, 512, 1024]) {
    macImages.set(size, macImage.resize({ width: size, height: size, quality: 'best' }).toPNG());
  }
  const chunks = [];
  for (const [tag, size] of [
    ['icp4', 16], ['icp5', 32], ['ic07', 128], ['ic08', 256], ['ic09', 512],
    ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512], ['ic10', 1024]
  ]) {
    const png = macImages.get(size);
    const header = Buffer.alloc(8);
    header.write(tag, 0, 'ascii'); header.writeUInt32BE(png.length + 8, 4);
    chunks.push(header, png);
  }
  const icnsBody = Buffer.concat(chunks);
  const icnsHeader = Buffer.alloc(8);
  icnsHeader.write('icns', 0, 'ascii'); icnsHeader.writeUInt32BE(icnsBody.length + 8, 4);
  fs.writeFileSync(path.join(assets, 'app.icns'), Buffer.concat([icnsHeader, icnsBody]));

  // Windows: the artwork fills the canvas; one PNG entry per size so small icons stay sharp.
  const winSizes = [16, 24, 32, 48, 64, 128, 256];
  const winImage = await render(appSvg, 1024);
  const winPngs = winSizes.map(size => winImage.resize({ width: size, height: size, quality: 'best' }).toPNG());
  const icoHeader = Buffer.alloc(6 + 16 * winSizes.length);
  icoHeader.writeUInt16LE(0, 0); icoHeader.writeUInt16LE(1, 2); icoHeader.writeUInt16LE(winSizes.length, 4);
  let offset = icoHeader.length;
  winSizes.forEach((size, index) => {
    const entry = 6 + 16 * index;
    icoHeader.writeUInt8(size >= 256 ? 0 : size, entry); icoHeader.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    icoHeader.writeUInt16LE(1, entry + 4); icoHeader.writeUInt16LE(32, entry + 6);
    icoHeader.writeUInt32LE(winPngs[index].length, entry + 8); icoHeader.writeUInt32LE(offset, entry + 12);
    offset += winPngs[index].length;
  });
  fs.writeFileSync(path.join(assets, 'app.ico'), Buffer.concat([icoHeader, ...winPngs]));

  // app.png (the window icon) is kept as checked in; write it only when it is missing.
  const appPng = path.join(assets, 'app.png');
  if (!fs.existsSync(appPng)) fs.writeFileSync(appPng, winImage.resize({ width: 512, height: 512, quality: 'best' }).toPNG());

  // Dark ink is visible in the Windows tray; macOS uses its alpha as a template.
  const traySvg = outlineSvg.replace('stroke="#FFFFFF"', 'stroke="#20252E"');
  fs.writeFileSync(path.join(assets, 'tray.png'), (await render(traySvg, 64)).resize({ width: 64, height: 64, quality: 'best' }).toPNG());

  // macOS menu bar: 18pt template image (+ @2x), with heavier strokes so the thin
  // artwork stays legible at that size and a little padding like system icons.
  const menuBarSvg = traySvg.replace(/stroke-width="([\d.]+)"/g, (_match, width) => `stroke-width="${Number(width) * 1.8}"`);
  for (const [file, size] of [['trayTemplate.png', 18], ['trayTemplate@2x.png', 36]]) {
    const image = await render(menuBarSvg, size * 4, size * 4 / 18);
    fs.writeFileSync(path.join(assets, file), image.resize({ width: size, height: size, quality: 'best' }).toPNG());
  }
  console.log('Generated app.icns, app.ico, tray.png and trayTemplate(@2x).png from the SVG artwork.');
}

app.whenReady().then(main).then(() => app.quit()).catch(error => {
  console.error(error?.code || 'Icon generation failed:', String(error?.message || error).slice(0, 160));
  app.exit(1);
});
