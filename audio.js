import { detectPitch } from './pitch.js';

// One AudioContext for the whole app: mic analysis + synth playback.
let ctx = null;
export function audioCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// ---------- Microphone ----------
let stream = null, analyser = null, buf = null, raf = 0;
const listeners = new Set();
let rmsSlow = 0;

export function micRunning() { return !!stream; }

export async function startMic() {
  if (stream) return;
  const c = audioCtx();
  stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  await c.resume();
  const src = c.createMediaStreamSource(stream);
  analyser = c.createAnalyser();
  analyser.fftSize = 2048;
  buf = new Float32Array(analyser.fftSize);
  src.connect(analyser);
  tick();
}

export function stopMic() {
  cancelAnimationFrame(raf);
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  analyser = null;
}

// cb({ freq, clarity, rms, onset, time })
export function onPitch(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function tick() {
  raf = requestAnimationFrame(tick);
  if (!analyser) return;
  analyser.getFloatTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  const rms = Math.sqrt(sum / buf.length);
  // Onset = sudden jump in loudness compared to the recent level
  const onset = rms > 0.02 && rms > rmsSlow * 1.8;
  rmsSlow = rmsSlow * 0.85 + rms * 0.15;
  const { freq, clarity } = rms > 0.01 ? detectPitch(buf, ctx.sampleRate) : { freq: 0, clarity: 0 };
  const ev = { freq, clarity, rms, onset, time: performance.now() };
  listeners.forEach((cb) => cb(ev));
}

// ---------- Plucked string synth (Karplus-Strong, pre-rendered per pitch) ----------
const cache = new Map();
function pluckBuffer(midi) {
  if (cache.has(midi)) return cache.get(midi);
  const c = audioCtx();
  const sr = c.sampleRate;
  const freq = 440 * 2 ** ((midi - 69) / 12);
  const len = Math.floor(sr * 1.6);
  const b = c.createBuffer(1, len, sr);
  const out = b.getChannelData(0);
  const period = Math.max(2, Math.round(sr / freq));
  const ring = new Float32Array(period);
  for (let i = 0; i < period; i++) ring[i] = Math.random() * 2 - 1;
  const decay = 0.996 - Math.min(0.01, freq / 60000);
  let idx = 0, prev = 0;
  for (let i = 0; i < len; i++) {
    const cur = ring[idx];
    const next = decay * 0.5 * (cur + prev);
    prev = cur;
    ring[idx] = next;
    out[i] = cur * 0.35;
    idx = (idx + 1) % period;
  }
  cache.set(midi, b);
  return b;
}

export function pluck(midi, dur = 1, when = 0) {
  const c = audioCtx();
  const src = c.createBufferSource();
  src.buffer = pluckBuffer(midi);
  const g = c.createGain();
  const t = c.currentTime + when;
  const end = t + Math.min(1.5, Math.max(0.15, dur));
  g.gain.setValueAtTime(1, t);
  g.gain.setTargetAtTime(0, end - 0.05, 0.04);
  src.connect(g).connect(c.destination);
  src.start(t);
  src.stop(end + 0.3);
}

export function click(accent = false) {
  const c = audioCtx();
  const o = c.createOscillator();
  const g = c.createGain();
  o.frequency.value = accent ? 1600 : 1100;
  g.gain.setValueAtTime(0.25, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.05);
  o.connect(g).connect(c.destination);
  o.start();
  o.stop(c.currentTime + 0.06);
}
