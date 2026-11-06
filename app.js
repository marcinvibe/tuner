import { detectPitch } from './pitch.js';

const NOTES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
// MIDI numbers, string 6 (thickest) to string 1
const TUNINGS = [
  { id: 'standard', name: 'Standard (E A D G B E)', midi: [40, 45, 50, 55, 59, 64] },
  { id: 'dropd', name: 'Drop D (D A D G B E)', midi: [38, 45, 50, 55, 59, 64] },
  { id: 'halfdown', name: 'Pół tonu niżej (E♭)', midi: [39, 44, 49, 54, 58, 63] },
  { id: 'dstd', name: 'Cały ton niżej (D)', midi: [38, 43, 48, 53, 57, 62] },
  { id: 'dropc', name: 'Drop C (C G C F A D)', midi: [36, 43, 48, 53, 57, 62] },
  { id: 'dadgad', name: 'DADGAD', midi: [38, 45, 50, 55, 57, 62] },
  { id: 'openg', name: 'Open G (D G D G B D)', midi: [38, 43, 50, 55, 59, 62] },
  { id: 'opend', name: 'Open D (D A D F♯ A D)', midi: [38, 45, 50, 54, 57, 62] },
  { id: 'opene', name: 'Open E (E B E G♯ B E)', midi: [40, 47, 52, 56, 59, 64] },
];
let STRINGS = [];
const IN_TUNE_CENTS = 5;
const MAX_CENTS = 50;

const $ = (id) => document.getElementById(id);
const app = document.querySelector('.app');
const el = {
  note: $('note'), octave: $('octave'), freq: $('freq'), cents: $('cents'),
  needle: $('needle'), hint: $('hint'), start: $('startBtn'),
  strings: $('strings'), ref: $('refBtn'), refVal: $('refVal'), ticks: $('ticks'),
  tuning: $('tuning'), auto: $('autoBtn'),
};

let a4 = Number(localStorageGet('a4')) || 440;
let target = null; // null = auto, otherwise MIDI number
let ctx, analyser, stream, buf, raf;
let smoothFreq = 0;
let lastHeard = 0;
let wasInTune = false;
let wakeLock = null;

// ---- UI setup ----
el.refVal.textContent = a4;
drawTicks();
TUNINGS.forEach((t) => el.tuning.add(new Option(t.name, t.id)));
el.tuning.value = TUNINGS.some((t) => t.id === localStorageGet('tuning')) ? localStorageGet('tuning') : 'standard';
buildStrings();

el.tuning.addEventListener('change', () => {
  localStorageSet('tuning', el.tuning.value);
  buildStrings();
});

el.strings.addEventListener('click', (e) => {
  const b = e.target.closest('.string');
  if (!b) return;
  setLock(b.classList.contains('locked') ? null : Number(b.dataset.midi));
});
el.auto.addEventListener('click', () => setLock(null));

function setLock(midi) {
  target = midi;
  el.auto.classList.toggle('active', midi == null);
  el.strings.querySelectorAll('.string').forEach((b) =>
    b.classList.toggle('locked', Number(b.dataset.midi) === midi));
  if (midi != null) markTarget(midi);
}

function buildStrings() {
  const tuning = TUNINGS.find((t) => t.id === el.tuning.value);
  STRINGS = tuning.midi.map((midi, i) => ({ num: 6 - i, midi }));
  el.strings.innerHTML = '';
  STRINGS.forEach((s, i) => {
    const b = document.createElement('button');
    b.className = 'string';
    b.dataset.midi = s.midi;
    b.style.setProperty('--thick', `${(5.5 - i * 0.8).toFixed(1)}px`);
    b.setAttribute('aria-label', `Struna ${s.num}, ${noteName(s.midi)}`);
    b.innerHTML = `<span class="num">${s.num}</span><span class="wire"></span>`
      + `<span class="name">${NOTES[s.midi % 12]}<sub>${Math.floor(s.midi / 12) - 1}</sub></span>`;
    el.strings.appendChild(b);
  });
  setLock(null);
}

function noteName(midi) { return NOTES[midi % 12] + (Math.floor(midi / 12) - 1); }

el.ref.addEventListener('click', () => {
  const v = prompt('Częstotliwość A4 (Hz)', a4);
  const n = Number(v);
  if (n >= 400 && n <= 480) {
    a4 = n;
    el.refVal.textContent = a4;
    localStorageSet('a4', a4);
  }
});

el.start.addEventListener('click', () => (ctx && ctx.state === 'running' ? stop() : start()));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && app.classList.contains('running')) requestWakeLock();
});

// ---- Audio ----
async function start() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  } catch (err) {
    el.hint.textContent = 'Brak dostępu do mikrofonu';
    return;
  }
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  await ctx.resume();
  const src = ctx.createMediaStreamSource(stream);
  analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  buf = new Float32Array(analyser.fftSize);
  src.connect(analyser);

  app.classList.add('running');
  el.start.textContent = 'Stop';
  el.hint.textContent = 'Zagraj strunę';
  requestWakeLock();
  loop();
}

function stop() {
  cancelAnimationFrame(raf);
  stream?.getTracks().forEach((t) => t.stop());
  ctx?.close();
  ctx = null;
  wakeLock?.release().catch(() => {});
  wakeLock = null;
  app.classList.remove('running');
  app.dataset.state = 'idle';
  el.start.textContent = 'Start';
  el.hint.textContent = 'Dotknij, aby zacząć';
  setNeedle(0);
}

function loop() {
  raf = requestAnimationFrame(loop);
  analyser.getFloatTimeDomainData(buf);
  const { freq, clarity } = detectPitch(buf, ctx.sampleRate);
  const now = performance.now();

  if (freq > 60 && freq < 1400 && clarity > 0.9) {
    // Smooth, but jump immediately on large changes (new string)
    const jump = smoothFreq === 0 || Math.abs(1200 * Math.log2(freq / smoothFreq)) > 80;
    smoothFreq = jump ? freq : smoothFreq * 0.8 + freq * 0.2;
    lastHeard = now;
    render(smoothFreq);
  } else if (now - lastHeard > 1200 && lastHeard !== 0) {
    smoothFreq = 0;
    lastHeard = 0;
    app.dataset.state = 'idle';
    el.hint.textContent = 'Zagraj strunę';
    el.note.textContent = '–';
    el.octave.textContent = '';
    el.freq.textContent = '0.0';
    el.cents.textContent = '0';
    setNeedle(0);
    markTarget(null);
    wasInTune = false;
  }
}

function render(freq) {
  const midiFloat = 69 + 12 * Math.log2(freq / a4);
  let midi = target;
  if (midi == null) {
    // Auto: lock onto the nearest string of the tuning (within 3.5 semitones),
    // so e.g. retuning E -> D in Drop D still guides you. Otherwise chromatic.
    const near = STRINGS.reduce((a, s) =>
      Math.abs(midiFloat - s.midi) < Math.abs(midiFloat - a.midi) ? s : a);
    midi = Math.abs(midiFloat - near.midi) < 3.5 ? near.midi : Math.round(midiFloat);
    markTarget(midi === near.midi ? near.midi : null);
  } else {
    markTarget(target);
  }
  const cents = Math.round((midiFloat - midi) * 100);
  const clamped = Math.max(-MAX_CENTS, Math.min(MAX_CENTS, cents));

  el.note.textContent = NOTES[((midi % 12) + 12) % 12];
  el.octave.textContent = Math.floor(midi / 12) - 1;
  el.freq.textContent = freq.toFixed(1);
  el.cents.textContent = (cents > 0 ? '+' : '') + cents;
  setNeedle(clamped);

  const inTune = Math.abs(cents) <= IN_TUNE_CENTS;
  app.dataset.state = inTune ? 'ok' : cents < 0 ? 'flat' : 'sharp';
  el.hint.textContent = inTune ? 'Nastrojone' : Math.abs(cents) > MAX_CENTS
    ? (cents < 0 ? 'Za nisko, podciągnij' : 'Za wysoko, poluzuj')
    : cents < 0 ? 'Podciągnij' : 'Poluzuj';

  if (inTune && !wasInTune) navigator.vibrate?.(40);
  wasInTune = inTune;
}

function setNeedle(cents) {
  el.needle.style.transform = `rotate(${(cents / MAX_CENTS) * 70}deg)`;
}

function markTarget(midi) {
  el.strings.querySelectorAll('.string').forEach((b) =>
    b.classList.toggle('target', Number(b.dataset.midi) === midi));
}

function drawTicks() {
  const ns = 'http://www.w3.org/2000/svg';
  for (let c = -50; c <= 50; c += 5) {
    const a = ((c / MAX_CENTS) * 70 - 90) * (Math.PI / 180);
    const major = c % 25 === 0;
    const r1 = 120, r2 = major ? 104 : 112;
    const l = document.createElementNS(ns, 'line');
    l.setAttribute('x1', 150 + r1 * Math.cos(a));
    l.setAttribute('y1', 150 + r1 * Math.sin(a));
    l.setAttribute('x2', 150 + r2 * Math.cos(a));
    l.setAttribute('y2', 150 + r2 * Math.sin(a));
    if (major) l.classList.add('major');
    el.ticks.appendChild(l);
  }
}

async function requestWakeLock() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {}
}

function localStorageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch {} }

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
