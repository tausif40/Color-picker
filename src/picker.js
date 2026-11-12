const video = document.querySelector('#feed');
const pointer = document.querySelector('#pointer');
const bubble = document.querySelector('#bubble');
const zoom = document.querySelector('#zoom');
const context = zoom.getContext('2d', { alpha: false });
const sample = document.createElement('canvas');
sample.width = sample.height = 1;
const sampleContext = sample.getContext('2d', { willReadFrequently: true });
let stream;
const query = new URLSearchParams(window.location.search);
// Display bounds in screen points. The stream covers exactly this area, even if the
// OS places the overlay window slightly inside it (for example below the menu bar).
const display = {
  x: Number(query.get('displayX')) || 0,
  y: Number(query.get('displayY')) || 0,
  width: Number(query.get('displayWidth')) || window.innerWidth,
  height: Number(query.get('displayHeight')) || window.innerHeight
};
// Hotspot position relative to the display's top-left corner.
const initialX = query.has('cursorX') ? Number(query.get('cursorX')) : display.width / 2;
const initialY = query.has('cursorY') ? Number(query.get('cursorY')) : display.height / 2;
let x = Math.max(0, Math.min(display.width - 1, initialX));
let y = Math.max(0, Math.min(display.height - 1, initialY));
let active = query.get('active') === 'true';
let hex;
let finished = false;

function windowOffset() {
  return { x: window.screenX - display.x, y: window.screenY - display.y };
}

function position() {
  pointer.hidden = bubble.hidden = !active;
  const offset = windowOffset();
  const left = x - offset.x, top = y - offset.y;
  // The arrow tip sits at (3, 2.5) in its 32x38 artwork; put it on the sampled pixel.
  pointer.style.left = `${left - 3}px`;
  pointer.style.top = `${top - 2.5}px`;
  bubble.style.left = `${left + 48 + 146 < window.innerWidth ? left + 48 : left - 166}px`;
  bubble.style.top = `${top + 16 + 172 < window.innerHeight ? top + 16 : top - 184}px`;
}

function draw() {
  if (finished) return;
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth && video.videoHeight) {
    const pixelX = Math.max(0, Math.min(video.videoWidth - 1, Math.floor(x * video.videoWidth / display.width)));
    const pixelY = Math.max(0, Math.min(video.videoHeight - 1, Math.floor(y * video.videoHeight / display.height)));
    context.imageSmoothingEnabled = false;
    context.drawImage(video, pixelX - 5, pixelY - 5, 11, 11, 0, 0, 130, 130);
    context.strokeStyle = '#fff';
    context.lineWidth = 2;
    context.strokeRect(59, 59, 12, 12);
    context.strokeStyle = '#272a35';
    context.lineWidth = 1;
    context.strokeRect(60, 60, 10, 10);
    sampleContext.drawImage(video, pixelX, pixelY, 1, 1, 0, 0, 1, 1);
    const rgb = sampleContext.getImageData(0, 0, 1, 1).data;
    hex = '#' + Array.from(rgb.slice(0, 3), value => value.toString(16).padStart(2, '0')).join('').toUpperCase();
    document.querySelector('#hex').textContent = hex;
    document.querySelector('#swatch').style.backgroundColor = hex;
  }
  scheduleDraw();
}

function scheduleDraw() {
  if (typeof video.requestVideoFrameCallback === 'function') video.requestVideoFrameCallback(draw);
  else requestAnimationFrame(draw);
}

window.addEventListener('mousemove', event => {
  const offset = windowOffset();
  x = event.clientX + offset.x;
  y = event.clientY + offset.y;
  active = true;
  position();
});
window.addEventListener('mouseleave', () => { active = false; position(); });
window.addEventListener('mousedown', event => {
  event.preventDefault();
  if (finished) return;
  if (event.button === 2) {
    finished = true;
    window.pickerBridge.cancel();
    return;
  }
  if (!hex) return;
  finished = true;
  window.pickerBridge.choose(hex);
});
window.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || finished) return;
  event.preventDefault();
  finished = true;
  window.pickerBridge.cancel();
});
window.addEventListener('contextmenu', event => event.preventDefault());
window.addEventListener('beforeunload', () => stream?.getTracks().forEach(track => track.stop()));

async function start() {
  try {
    const source = query.get('source');
    const width = Number(query.get('width'));
    const height = Number(query.get('height'));
    if (!source) throw new Error('Screen source missing.');
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { mandatory: {
        chromeMediaSource: 'desktop', chromeMediaSourceId: source,
        minWidth: width, maxWidth: width, minHeight: height, maxHeight: height,
        maxFrameRate: 20
      } }
    });
    video.srcObject = stream;
    await video.play();
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      await new Promise(resolve => video.addEventListener('loadeddata', resolve, { once: true }));
    }
    position();
    scheduleDraw();
    window.pickerBridge.ready();
  } catch (error) {
    window.pickerBridge.failed(error?.message || 'Screen capture is unavailable.');
  }
}

start();
