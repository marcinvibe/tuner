import { startMic, stopMic, onPitch } from './audio.js';
import { TUNINGS, NOTES } from './tunings.js';

const IN_TUNE_CENTS = 4;
const MAX_CENTS = 50;
const SWEEP = 78; // degrees each side of the gauge
const CX = 170, CY = 178;

const $ = (id) => document.getElementById(id);
const app = document.getElementById('view-tune');
const el = {
  note: $('note'), octave: $('octave'), freq: $('freq'), cents: $('cents'), badge: $('badge'),
  needle: $('needle'), hint: $('hint'), start: $('startBtn'), ticks: $('ticks'),
  ref: $('refBtn'), refVal: $('refVal'), tuning: $('tuning'),
  preview: $('preview'), picker: $('picker'),
};

let STRINGS = [];
let a4 = Number(storeGet('a4')) || 440;
let target = null; // null = auto, otherwise MIDI number
let running = false, unsub = null;
let smoothFreq = 0;
let lastHeard = 0;
let wasInTune = false;
let wakeLock = null;

// ---------- Setup ----------
el.refVal.textContent = a4;
drawTicks();
TUNINGS.forEach((t) => el.tuning.add(new Option(t.name, t.id)));
el.tuning.value = TUNINGS.some((t) => t.id === storeGet('tuning')) ? storeGet('tuning') : 'standard';
buildStrings();

el.tuning.addEventListener('change', () => {
  storeSet('tuning', el.tuning.value);
  buildStrings();
});

el.ref.addEventListener('click', () => {
  const n = Number(prompt('Częstotliwość A4 (Hz)', a4));
  if (n >= 400 && n <= 480) {
    a4 = n;
    el.refVal.textContent = a4;
    storeSet('a4', a4);
  }
});

el.start.addEventListener('click', () => (running ? stop() : start()));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && running) requestWakeLock();
});

// ---------- Strings: preview + picker ----------
function buildStrings() {
  const tuning = TUNINGS.find((t) => t.id === el.tuning.value);
  STRINGS = tuning.midi.map((midi, i) => ({ num: 6 - i, midi }));
  const low = NOTES[STRINGS[0].midi % 12];
  const label = (s) => {
    const n = NOTES[s.midi % 12];
    return s.num === 1 && n === low ? n.toLowerCase() : n;
  };

  // Passive preview, thickest string on top (as seen looking down at the guitar)
  el.preview.innerHTML = STRINGS.map((s, i) =>
    `<div class="wire-row" data-midi="${s.midi}" style="--thick:${(4.5 - i * 0.65).toFixed(2)}px">
      <span class="num">${s.num}</span><span class="wire"></span>
      <span class="name">${label(s)}<sub>${octave(s.midi)}</sub></span>
    </div>`).join('');

  // Swipeable picker, low to high
  el.picker.innerHTML = `<button class="pick auto" data-midi="">Auto</button>`
    + STRINGS.map((s) => `<button class="pick" data-midi="${s.midi}" aria-label="Struna ${s.num}">
        ${label(s)}<small>${s.num}</small></button>`).join('');

  requestAnimationFrame(() => {
    el.picker.scrollLeft = 0;
    stylePicker();
    setLock(null);
  });
}

let scrollTimer;
el.picker.addEventListener('scroll', () => {
  stylePicker();
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(commitPicker, 110);
}, { passive: true });

el.picker.addEventListener('click', (e) => {
  const b = e.target.closest('.pick');
  if (b) scrollToItem(b);
});

function pickerItems() { return [...el.picker.querySelectorAll('.pick')]; }

function centeredItem() {
  const mid = el.picker.scrollLeft + el.picker.clientWidth / 2;
  return pickerItems().reduce((best, b) => {
    const d = Math.abs(b.offsetLeft + b.offsetWidth / 2 - mid);
    return d < best.d ? { b, d } : best;
  }, { b: null, d: Infinity }).b;
}

function stylePicker() {
  const mid = el.picker.scrollLeft + el.picker.clientWidth / 2;
  const current = centeredItem();
  pickerItems().forEach((b) => {
    const d = Math.abs(b.offsetLeft + b.offsetWidth / 2 - mid) / b.offsetWidth;
    b.style.opacity = Math.max(0.2, 1 - d * 0.28).toFixed(2);
    b.style.filter = d > 1.4 ? `blur(${Math.min(4, (d - 1.4) * 2.5).toFixed(1)}px)` : 'none';
    b.style.transform = `scale(${(1 - Math.min(d, 3) * 0.05).toFixed(3)})`;
    b.classList.toggle('current', b === current);
  });
}

function commitPicker() {
  const b = centeredItem();
  if (!b) return;
  const midi = b.dataset.midi ? Number(b.dataset.midi) : null;
  if (midi !== target) {
    setLock(midi);
    navigator.vibrate?.(8);
  }
}

function scrollToItem(b) {
  el.picker.scrollTo({ left: b.offsetLeft + b.offsetWidth / 2 - el.picker.clientWidth / 2, behavior: 'smooth' });
}

function setLock(midi) {
  target = midi;
  el.preview.querySelectorAll('.wire-row').forEach((r) =>
    r.classList.toggle('selected', Number(r.dataset.midi) === midi));
  markHit(midi);
}

function markHit(midi) {
  el.preview.querySelectorAll('.wire-row').forEach((r) =>
    r.classList.toggle('hit', midi != null && lastHeard !== 0 && Number(r.dataset.midi) === midi));
}

// ---------- Audio ----------
export async function start() {
  try {
    await startMic();
  } catch {
    el.hint.textContent = 'Brak dostępu do mikrofonu';
    return;
  }
  running = true;
  unsub = onPitch(loop);
  app.classList.add('running');
  el.start.textContent = 'Stop';
  el.hint.textContent = 'Zagraj strunę';
  requestWakeLock();
}

export function stop() {
  if (!running) return;
  running = false;
  unsub?.();
  stopMic();
  wakeLock?.release().catch(() => {});
  wakeLock = null;
  app.classList.remove('running');
  el.start.textContent = 'Start';
  reset('Naciśnij Start');
}

function reset(hint) {
  smoothFreq = 0;
  lastHeard = 0;
  wasInTune = false;
  app.dataset.state = 'idle';
  el.hint.textContent = hint;
  el.note.textContent = '–';
  el.octave.textContent = '';
  el.freq.textContent = '0.0';
  el.cents.textContent = '';
  setNeedle(0);
  markHit(null);
}

function loop({ freq, clarity, time: now }) {

  if (freq > 60 && freq < 1400 && clarity > 0.9) {
    // Smooth, but jump immediately on large changes (new string)
    const jump = smoothFreq === 0 || Math.abs(1200 * Math.log2(freq / smoothFreq)) > 80;
    smoothFreq = jump ? freq : smoothFreq * 0.8 + freq * 0.2;
    lastHeard = now;
    render(smoothFreq);
  } else if (lastHeard !== 0 && now - lastHeard > 1200) {
    reset('Zagraj strunę');
  }
}

function render(freq) {
  const midiFloat = 69 + 12 * Math.log2(freq / a4);
  let midi = target;
  if (midi == null) {
    // Auto: snap to the nearest string of the tuning (within 3.5 semitones),
    // so retuning E -> D in Drop D still guides you. Otherwise chromatic.
    const near = STRINGS.reduce((a, s) =>
      Math.abs(midiFloat - s.midi) < Math.abs(midiFloat - a.midi) ? s : a);
    midi = Math.abs(midiFloat - near.midi) < 3.5 ? near.midi : Math.round(midiFloat);
  }
  markHit(STRINGS.some((s) => s.midi === midi) ? midi : null);

  const cents = Math.round((midiFloat - midi) * 100);
  el.note.textContent = NOTES[((midi % 12) + 12) % 12];
  el.octave.textContent = octave(midi);
  el.freq.textContent = freq.toFixed(1);
  el.cents.textContent = (cents > 0 ? '+' : '') + cents + ' ct';
  setNeedle(Math.max(-MAX_CENTS, Math.min(MAX_CENTS, cents)));

  const inTune = Math.abs(cents) <= IN_TUNE_CENTS;
  app.dataset.state = inTune ? 'ok' : cents < 0 ? 'flat' : 'sharp';
  el.hint.textContent = inTune ? 'Nastrojone'
    : cents < 0 ? (cents < -MAX_CENTS ? 'Dużo za nisko, podciągnij' : 'Za nisko, podciągnij')
    : (cents > MAX_CENTS ? 'Dużo za wysoko, poluzuj' : 'Za wysoko, poluzuj');

  if (inTune && !wasInTune) navigator.vibrate?.(40);
  wasInTune = inTune;
}

// ---------- Gauge ----------
function setNeedle(cents) {
  el.needle.style.transform = `rotate(${(cents / MAX_CENTS) * SWEEP}deg)`;
}

function drawTicks() {
  const ns = 'http://www.w3.org/2000/svg';
  for (let c = -50; c <= 50; c += 2) {
    const a = ((c / MAX_CENTS) * SWEEP - 90) * (Math.PI / 180);
    const major = c % 25 === 0;
    const zone = Math.abs(c) <= IN_TUNE_CENTS;
    const r1 = 150, r2 = major ? (c === 0 ? 128 : 134) : zone ? 136 : 141;
    const l = document.createElementNS(ns, 'line');
    l.setAttribute('x1', (CX + r1 * Math.cos(a)).toFixed(2));
    l.setAttribute('y1', (CY + r1 * Math.sin(a)).toFixed(2));
    l.setAttribute('x2', (CX + r2 * Math.cos(a)).toFixed(2));
    l.setAttribute('y2', (CY + r2 * Math.sin(a)).toFixed(2));
    if (major) l.classList.add('major');
    if (zone) l.classList.add('zone');
    el.ticks.appendChild(l);
  }
}

// ---------- Utils ----------
function octave(midi) { return Math.floor(midi / 12) - 1; }

async function requestWakeLock() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {}
}

function storeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function storeSet(k, v) { try { localStorage.setItem(k, v); } catch {} }


// Picker geometry is zero while the view is hidden; re-apply when shown.
export function onShow() {
  requestAnimationFrame(() => {
    const cur = pickerItems().find((b) => (b.dataset.midi ? Number(b.dataset.midi) : null) === target);
    if (cur) el.picker.scrollLeft = cur.offsetLeft + cur.offsetWidth / 2 - el.picker.clientWidth / 2;
    stylePicker();
  });
}
