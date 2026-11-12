/* Render the checked-in SVG artwork into the icon formats used by Electron. */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const assets = path.join(__dirname, '..', 'assets');
app.on('window-all-closed', () => {});

async function render(svg, size, padding = 0) {
  const window = new BrowserWindow({
    width: size, height: size, show: false, frame: false,
    transparent: true, backgroundColor: '#00000000',
    webPreferences: { backgroundThrottling: false }
  });
  try {
    const source = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
    const html = `<!doctype html><html><head><style>html,body{margin:0;width:100%;height:100%;background:transparent}img{display:block;width:100%;height:100%;box-sizing:border-box;padding:${padding}px}</style></head><body><img src="${source}"></body></html>`;
    await window.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`);
    await window.webContents.executeJavaScript('document.images[0].decode()');
    await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    return await window.webContents.capturePage();
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

  const appImages = new Map();
  for (const size of [128, 256, 512, 1024]) {
    const image = await render(appSvg, size);
    appImages.set(size, image.resize({ width: size, height: size, quality: 'best' }).toPNG());
  }
  fs.writeFileSync(path.join(assets, 'app.png'), appImages.get(512));

  const chunks = [];
  for (const [tag, size] of [['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024]]) {
    const png = appImages.get(size);
    const header = Buffer.alloc(8);
    header.write(tag, 0, 'ascii'); header.writeUInt32BE(png.length + 8, 4);
    chunks.push(header, png);
  }
  const icnsBody = Buffer.concat(chunks);
  const icnsHeader = Buffer.alloc(8);
  icnsHeader.write('icns', 0, 'ascii'); icnsHeader.writeUInt32BE(icnsBody.length + 8, 4);
  fs.writeFileSync(path.join(assets, 'app.icns'), Buffer.concat([icnsHeader, icnsBody]));

  const icoPng = appImages.get(256);
  const icoHeader = Buffer.alloc(22);
  icoHeader.writeUInt16LE(0, 0); icoHeader.writeUInt16LE(1, 2); icoHeader.writeUInt16LE(1, 4);
  icoHeader.writeUInt16LE(1, 10); icoHeader.writeUInt16LE(32, 12);
  icoHeader.writeUInt32LE(icoPng.length, 14); icoHeader.writeUInt32LE(22, 18);
  fs.writeFileSync(path.join(assets, 'app.ico'), Buffer.concat([icoHeader, icoPng]));

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
  console.log('Generated app.png, app.icns, app.ico, tray.png and trayTemplate(@2x).png from the SVG artwork.');
}

app.whenReady().then(main).then(() => app.quit()).catch(error => {
  console.error(error?.code || 'Icon generation failed:', String(error?.message || error).slice(0, 160));
  app.exit(1);
});
