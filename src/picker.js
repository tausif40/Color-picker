// The window is created ahead of time and kept hidden. Each pick starts with
// `picker:begin` (display, cursor and stream source) and ends with `picker:end`.
const video = document.querySelector('#feed');
const pointer = document.querySelector('#pointer');
const loupe = document.querySelector('#loupe');
const zoom = document.querySelector('#zoom');
const context = zoom.getContext('2d', { alpha: false });
const sample = document.createElement('canvas');
sample.width = sample.height = 1;
const sampleContext = sample.getContext('2d', { willReadFrequently: true });

const LOUPE_SIZE = 128;               // CSS size of the round loupe
const ZOOM_LEVELS = [9, 13, 17, 25];  // screen pixels across the loupe; odd so one is centred
const DEFAULT_ZOOM = 1;
const POINTER_CENTER = 12.5;          // centre of the 25px plus cursor
const LOUPE_GAP = 22;                 // space between the cursor and the loupe
const EDGE = 8;                       // keep the loupe this far from screen edges
const WHEEL_STEP = 40;

let session = 0;
let display = { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
let streamWidth = 0, streamHeight = 0;
let x = 0, y = 0;                     // hotspot in points, relative to the display
let active = false;
let zoomIndex = DEFAULT_ZOOM;
let wheelDelta = 0;
let finished = true;                  // no pick in progress
let streamReady = false;
let pendingPick = false;              // clicked before the first frame arrived
let updateQueued = false;
let stream = null;

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function videoReady() { return streamReady && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0 && video.videoHeight > 0; }
function frameSize() { return { width: video.videoWidth || streamWidth || display.width, height: video.videoHeight || streamHeight || display.height }; }
function scale() { const frame = frameSize(); return { x: frame.width / display.width, y: frame.height / display.height }; }
function windowOffset() { return { x: window.screenX - display.x, y: window.screenY - display.y }; }
function toHex(r, g, b) { return '#' + [r, g, b].map(value => value.toString(16).padStart(2, '0')).join('').toUpperCase(); }

// The screen pixel (in stream pixels) that will be picked.
function targetPixel() {
  const frame = frameSize(), factor = scale();
  return {
    x: clamp(Math.floor(x * factor.x + 1e-6), 0, frame.width - 1),
    y: clamp(Math.floor(y * factor.y + 1e-6), 0, frame.height - 1)
  };
}

function sampleHex(pixel) {
  sampleContext.drawImage(video, pixel.x, pixel.y, 1, 1, 0, 0, 1, 1);
  const [r, g, b] = sampleContext.getImageData(0, 0, 1, 1).data;
  return toHex(r, g, b);
}

function layout(pixel) {
  pointer.hidden = !active;
  loupe.hidden = !active || !videoReady();
  if (!active) return;
  const factor = scale(), offset = windowOffset();
  // Centre the plus cursor on the middle of the target pixel.
  const left = (pixel.x + .5) / factor.x - offset.x;
  const top = (pixel.y + .5) / factor.y - offset.y;
  pointer.style.transform = `translate(${left - POINTER_CENTER}px, ${top - POINTER_CENTER}px)`;
  if (loupe.hidden) return;

  // Below-right of the cursor; flip at screen edges so it never covers the target.
  let loupeX = left + LOUPE_GAP, loupeY = top + LOUPE_GAP;
  if (loupeX + LOUPE_SIZE > window.innerWidth - EDGE) loupeX = left - LOUPE_GAP - LOUPE_SIZE;
  if (loupeY + LOUPE_SIZE > window.innerHeight - EDGE) loupeY = top - LOUPE_GAP - LOUPE_SIZE;
  loupeX = clamp(loupeX, EDGE, window.innerWidth - LOUPE_SIZE - EDGE);
  loupeY = clamp(loupeY, EDGE, window.innerHeight - LOUPE_SIZE - EDGE);
  loupe.style.transform = `translate(${Math.round(loupeX)}px, ${Math.round(loupeY)}px)`;
}

function renderLoupe(pixel) {
  const size = zoom.width, ratio = size / LOUPE_SIZE;
  const grid = ZOOM_LEVELS[zoomIndex], half = (grid - 1) / 2, cell = size / grid;
  context.imageSmoothingEnabled = false;
  context.fillStyle = '#2a2d36';
  context.fillRect(0, 0, size, size);

  // Copy only the on-screen part of the area, so edges stay aligned.
  const sx = pixel.x - half, sy = pixel.y - half;
  const x0 = Math.max(0, sx), y0 = Math.max(0, sy);
  const x1 = Math.min(video.videoWidth, sx + grid), y1 = Math.min(video.videoHeight, sy + grid);
  if (x1 > x0 && y1 > y0) {
    context.drawImage(video, x0, y0, x1 - x0, y1 - y0, (x0 - sx) * cell, (y0 - sy) * cell, (x1 - x0) * cell, (y1 - y0) * cell);
  }

  if (cell >= 7 * ratio) {
    context.beginPath();
    for (let i = 1; i < grid; i++) {
      const line = Math.round(i * cell) + .5;
      context.moveTo(line, 0); context.lineTo(line, size);
      context.moveTo(0, line); context.lineTo(size, line);
    }
    context.lineWidth = 1;
    context.strokeStyle = 'rgba(128, 128, 128, .28)';
    context.stroke();
  }

  // Outline the picked pixel: a light line on a dark edge, visible on any color.
  const start = half * cell - ratio, box = cell + 2 * ratio;
  context.lineWidth = 3.5 * ratio;
  context.strokeStyle = 'rgba(10, 12, 18, .8)';
  context.strokeRect(start, start, box, box);
  context.lineWidth = 1.5 * ratio;
  context.strokeStyle = '#fff';
  context.strokeRect(start, start, box, box);
}

function update() {
  updateQueued = false;
  if (finished) return;
  const pixel = targetPixel();
  layout(pixel);
  if (active && videoReady()) renderLoupe(pixel);
}

function requestUpdate() {
  if (updateQueued) return;
  updateQueued = true;
  requestAnimationFrame(update);
}

function watchFrames(current) {
  if (typeof video.requestVideoFrameCallback === 'function') {
    const onFrame = () => {
      if (finished || session !== current) return;
      requestUpdate();
      video.requestVideoFrameCallback(onFrame);
    };
    video.requestVideoFrameCallback(onFrame);
  } else {
    const timer = setInterval(() => {
      if (finished || session !== current) clearInterval(timer);
      else requestUpdate();
    }, 50);
  }
}

function pick() {
  if (finished) return;
  // Clicked before the stream delivered its first frame: pick as soon as it does.
  if (!videoReady()) { pendingPick = true; return; }
  // Sample now rather than reusing the last drawn frame, so the click position is exact.
  const hex = sampleHex(targetPixel());
  finished = true;
  window.pickerBridge.choose(session, hex);
}

function cancel() {
  if (finished) return;
  finished = true;
  window.pickerBridge.cancel(session);
}

function moveTo(event) {
  const offset = windowOffset();
  x = clamp(event.clientX + offset.x, 0, display.width - 1);
  y = clamp(event.clientY + offset.y, 0, display.height - 1);
  active = true;
}

// Move exactly one screen pixel (ten with Shift).
function nudge(dx, dy, step) {
  const pixel = targetPixel(), factor = scale(), frame = frameSize();
  x = (clamp(pixel.x + dx * step, 0, frame.width - 1) + .5) / factor.x;
  y = (clamp(pixel.y + dy * step, 0, frame.height - 1) + .5) / factor.y;
  active = true;
  requestUpdate();
}

function zoomBy(direction) {
  const next = clamp(zoomIndex + direction, 0, ZOOM_LEVELS.length - 1);
  if (next === zoomIndex) return;
  zoomIndex = next;
  requestUpdate();
}

function stopStream() {
  stream?.getTracks().forEach(track => track.stop());
  stream = null;
  video.srcObject = null;
}

function end() {
  finished = true;
  streamReady = false;
  pendingPick = false;
  stopStream();
  pointer.hidden = loupe.hidden = true;
}

async function begin(config) {
  end();
  const current = config.session;
  session = current;
  display = config.display;
  streamWidth = config.width;
  streamHeight = config.height;
  x = clamp(config.cursorX, 0, display.width - 1);
  y = clamp(config.cursorY, 0, display.height - 1);
  active = !!config.active;
  zoomIndex = DEFAULT_ZOOM;
  wheelDelta = 0;
  finished = false;
  zoom.width = zoom.height = Math.round(LOUPE_SIZE * (window.devicePixelRatio || 1));
  update(); // the cursor appears immediately; the loupe follows once frames arrive

  try {
    const next = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { mandatory: {
        chromeMediaSource: 'desktop', chromeMediaSourceId: config.source,
        minWidth: streamWidth, maxWidth: streamWidth, minHeight: streamHeight, maxHeight: streamHeight,
        maxFrameRate: 30
      } }
    });
    if (finished || session !== current) { next.getTracks().forEach(track => track.stop()); return; }
    stream = next;
    video.srcObject = stream;
    await video.play();
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      await new Promise(resolve => video.addEventListener('loadeddata', resolve, { once: true }));
    }
    if (finished || session !== current) return;
    streamReady = true;
    window.pickerBridge.ready(current);
    watchFrames(current);
    if (pendingPick) pick();
    else requestUpdate();
  } catch (error) {
    if (finished || session !== current) return;
    finished = true;
    window.pickerBridge.failed(current, error?.message || 'Screen capture is unavailable.');
  }
}

const NUDGES = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

window.addEventListener('mousemove', event => {
  if (finished) return;
  moveTo(event);
  requestUpdate();
});
window.addEventListener('mouseleave', () => {
  if (finished) return;
  active = false;
  requestUpdate();
});
window.addEventListener('mousedown', event => {
  event.preventDefault();
  if (finished) return;
  if (event.button === 2) { cancel(); return; }
  if (event.button !== 0) return;
  moveTo(event);
  pick();
});
window.addEventListener('keydown', event => {
  if (finished) return;
  const direction = NUDGES[event.key];
  if (event.key === 'Escape') cancel();
  else if (event.key === 'Enter' || event.key === ' ') pick();
  else if (direction) nudge(direction[0], direction[1], event.shiftKey ? 10 : 1);
  else if (event.key === '+' || event.key === '=') zoomBy(-1);
  else if (event.key === '-' || event.key === '_') zoomBy(1);
  else return;
  event.preventDefault();
});
window.addEventListener('wheel', event => {
  if (finished) return;
  wheelDelta += event.deltaY;
  if (Math.abs(wheelDelta) < WHEEL_STEP) return;
  zoomBy(Math.sign(wheelDelta)); // scroll up zooms in
  wheelDelta = 0;
}, { passive: true });
window.addEventListener('contextmenu', event => event.preventDefault());
window.addEventListener('beforeunload', stopStream);

window.pickerBridge.onBegin(config => { void begin(config); });
window.pickerBridge.onEnd(end);
