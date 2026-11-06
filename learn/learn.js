import { songFromMidi, groupNotes } from './song.js';
import { listSongs, getSong, putSong, deleteSong } from './store.js';
import { drawHighway, drawFretboard, lowerBound } from './draw.js';
import { startMic, stopMic, onPitch, pluck, audioCtx } from '../audio.js';
import { NOTES } from '../tunings.js';

const $ = (id) => document.getElementById(id);
const el = {
  lib: $('lib'), list: $('songList'), empty: $('libEmpty'), file: $('fileInput'),
  player: $('player'), back: $('backBtn'), title: $('songTitle'), trackSel: $('trackSel'), tuning: $('songTuning'),
  highway: $('highway'), fretboard: $('fretboard'), hint: $('learnHint'), score: $('learnScore'),
  seek: $('seek'), barLabel: $('barLabel'), play: $('playBtn'), restart: $('restartBtn'),
  modes: $('modes'), speed: $('speed'), speedVal: $('speedVal'), loop: $('loopBtn'), zoom: $('zoomBtn'),
};

const S = {
  rec: null, song: null, track: null, groups: [], tuningNames: [],
  t: 0, playing: false, speed: 1, mode: 'wait', pps: 260,
  nextIdx: 0, hits: [], waiting: false, flash: null,
  loopA: null, loopB: null, loopStage: 0,
  armedAt: 0, lastOnset: -1e9, raf: 0, lastFrame: 0, unsub: null, wakeLock: null,
};
const PPS = [180, 260, 360];

// ---------- Library ----------
export async function initLearn() {
  el.file.addEventListener('change', async () => {
    const f = el.file.files[0];
    el.file.value = '';
    if (f) await importFile(f.name, await f.arrayBuffer());
  });
  el.back.addEventListener('click', closePlayer);
  el.trackSel.addEventListener('change', () => selectTrack(Number(el.trackSel.value)));
  el.play.addEventListener('click', togglePlay);
  el.restart.addEventListener('click', () => seek(S.loopA ?? 0, true));
  el.seek.addEventListener('input', () => seek(Number(el.seek.value), true));
  el.speed.addEventListener('input', () => {
    S.speed = Number(el.speed.value) / 100;
    el.speedVal.textContent = el.speed.value + '%';
    saveSongPrefs();
  });
  el.modes.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) setMode(b.dataset.mode);
  });
  el.loop.addEventListener('click', toggleLoop);
  el.zoom.addEventListener('click', () => {
    S.pps = PPS[(PPS.indexOf(S.pps) + 1) % PPS.length];
    el.zoom.textContent = ['S', 'M', 'L'][PPS.indexOf(S.pps)];
  });
  setupDragSeek();
  window.addEventListener('resize', () => S.song && draw());
  await renderLibrary();
}

async function importFile(name, buf) {
  try {
    const song = songFromMidi(buf, name);
    if (!song.tracks.length) throw new Error('Brak ścieżek gitarowych w pliku');
    const id = `${Date.now()}`;
    await putSong({ id, name, title: song.title, added: Date.now(), data: buf });
    await renderLibrary();
    openSong(id);
  } catch (err) {
    alert('Nie udało się wczytać pliku: ' + err.message);
  }
}
window.__learnImport = importFile; // dev helper

async function renderLibrary() {
  const songs = (await listSongs()).sort((a, b) => b.added - a.added);
  el.empty.hidden = songs.length > 0;
  el.list.innerHTML = songs.map((s) => `
    <li data-id="${s.id}">
      <button class="song-open">
        <span class="song-icon">♪</span>
        <span class="song-name">${escapeHtml(s.title)}</span>
        <span class="chev"></span>
      </button>
      <button class="song-del" aria-label="Usuń">×</button>
    </li>`).join('');
  el.list.querySelectorAll('li').forEach((li) => {
    li.querySelector('.song-open').onclick = () => openSong(li.dataset.id);
    li.querySelector('.song-del').onclick = async () => {
      if (confirm('Usunąć utwór z telefonu?')) { await deleteSong(li.dataset.id); renderLibrary(); }
    };
  });
}

// ---------- Player ----------
async function openSong(id) {
  const rec = await getSong(id);
  S.rec = rec;
  S.song = songFromMidi(rec.data, rec.name);
  const prefs = loadSongPrefs();
  el.title.textContent = S.song.title;
  el.trackSel.innerHTML = S.song.tracks.map((t, i) => `<option value="${i}">${escapeHtml(shortTrack(t.name))}</option>`).join('');
  const ti = prefs.track ?? S.song.defaultTrack;
  el.trackSel.value = ti;
  S.speed = prefs.speed ?? 0.6;
  el.speed.value = Math.round(S.speed * 100);
  el.speedVal.textContent = el.speed.value + '%';
  el.seek.max = S.song.duration;
  el.lib.hidden = true;
  el.player.hidden = false;
  document.body.classList.add('in-player');
  setMode(prefs.mode ?? 'wait');
  selectTrack(ti);
  loop();
}

function closePlayer() {
  pause();
  cancelAnimationFrame(S.raf);
  el.player.hidden = true;
  el.lib.hidden = false;
  document.body.classList.remove('in-player');
}
export function leaveLearn() { pause(); }

function selectTrack(i) {
  S.track = S.song.tracks[i];
  S.groups = groupNotes(S.track.notes);
  S.tuningNames = S.track.tuning.map((m, k) => {
    const n = NOTES[m % 12];
    return k === 5 && n === NOTES[S.track.tuning[0] % 12] ? n.toLowerCase() : n;
  });
  el.tuning.textContent = S.track.tuningName;
  clearLoop();
  saveSongPrefs();
  // Start a bit before the first note
  seek(Math.max(0, (S.groups[0]?.t ?? 0) - 1.5), true);
}

function setMode(m) {
  S.mode = m;
  el.modes.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.mode === m));
  el.score.hidden = m !== 'play';
  if (S.playing) { pause(); }
  resetFrom(S.t);
  saveSongPrefs();
  updateHint();
}

async function togglePlay() {
  if (S.playing) return pause();
  audioCtx();
  if (S.mode !== 'watch') {
    try { await startMic(); } catch { el.hint.textContent = 'Brak dostępu do mikrofonu'; return; }
    S.unsub = onPitch(onMic);
  }
  if (S.t >= S.song.duration - 0.1) seek(S.loopA ?? 0, true);
  // Small pre-roll so you see what is coming
  seek(Math.max(S.loopA ?? 0, S.t - 1), true);
  S.playing = true;
  S.armedAt = performance.now();
  el.play.classList.add('playing');
  el.play.setAttribute('aria-label', 'Pauza');
  try { S.wakeLock = await navigator.wakeLock?.request('screen'); } catch {}
}

function pause() {
  if (!S.playing) return;
  S.playing = false;
  S.waiting = false;
  S.unsub?.(); S.unsub = null;
  stopMic();
  S.wakeLock?.release().catch(() => {}); S.wakeLock = null;
  el.play.classList.remove('playing');
  el.play.setAttribute('aria-label', 'Graj');
  updateHint();
}

function seek(t, resetHits) {
  S.t = Math.max(0, Math.min(t, S.song.duration));
  if (resetHits) resetFrom(S.t);
}

function resetFrom(t) {
  S.nextIdx = lowerBound(S.groups, t - 0.001);
  for (let i = S.nextIdx; i < S.hits.length; i++) S.hits[i] = undefined;
  S.waiting = false;
  S.armedAt = performance.now();
  updateScore();
  updateHint();
}

// ---------- Main loop ----------
function loop() {
  S.raf = requestAnimationFrame(loop);
  const now = performance.now();
  const dt = Math.min(0.1, (now - (S.lastFrame || now)) / 1000);
  S.lastFrame = now;
  if (S.playing) step(dt);
  draw();
}

function step(dt) {
  const adv = dt * S.speed;
  const g = S.groups[S.nextIdx];

  if (S.mode === 'wait') {
    if (g && S.t + adv >= g.t) {
      if (!S.waiting) { S.waiting = true; updateHint(); }
      S.t = g.t;
    } else {
      S.t += adv;
    }
  } else {
    S.t += adv;
    // Groups the cursor has passed
    const late = S.mode === 'play' ? 0.18 : 0;
    while (S.nextIdx < S.groups.length && S.groups[S.nextIdx].t <= S.t - late) {
      const grp = S.groups[S.nextIdx];
      if (S.mode === 'watch') grp.notes.forEach((n) => pluck(n.midi, n.dur / S.speed));
      else if (!S.hits[S.nextIdx]) S.hits[S.nextIdx] = 'miss';
      S.nextIdx++;
      S.armedAt = performance.now();
      updateScore();
      updateHint();
    }
  }

  if (S.loopB != null && S.t >= S.loopB) seek(S.loopA, true);
  if (S.t >= S.song.duration) { S.t = S.song.duration; pause(); }
}

// ---------- Listening ----------
function onMic(ev) {
  if (!S.playing || S.mode === 'watch') return;
  if (ev.onset) S.lastOnset = ev.time;
  const g = S.groups[S.nextIdx];
  if (!g) return;
  // Only judge the group that is (almost) at the line
  const ahead = g.t - S.t;
  if (S.mode === 'wait' && ahead > 0.3 * S.speed) return;
  if (S.mode === 'play' && Math.abs(ahead) > 0.25) return;
  // Needs a fresh pluck after this note became the target (so held notes don't count twice)
  if (S.lastOnset < S.armedAt - 150 || ev.time - S.lastOnset > 600) return;
  if (!(ev.freq > 60 && ev.clarity > 0.85)) return;

  const m = 69 + 12 * Math.log2(ev.freq / 440);
  const ok = g.notes.some((n) => n.harm || [0, 12, -12].some((o) => Math.abs(m - (n.midi + o)) < 0.6));
  if (!ok) { showHeard(m); return; }

  S.hits[S.nextIdx] = 'hit';
  S.flash = { at: performance.now() };
  S.nextIdx++;
  S.armedAt = performance.now();
  S.waiting = false;
  updateScore();
  updateHint();
}

let heardTimer;
function showHeard(m) {
  const r = Math.round(m);
  el.hint.dataset.heard = `Słyszę ${NOTES[((r % 12) + 12) % 12]}${Math.floor(r / 12) - 1}`;
  clearTimeout(heardTimer);
  heardTimer = setTimeout(() => { delete el.hint.dataset.heard; updateHint(); }, 900);
  updateHint();
}

// ---------- UI bits ----------
function draw() {
  drawHighway(el.highway, {
    t: S.t, pps: S.pps, groups: S.groups, nextIdx: S.nextIdx, hits: S.hits, bars: S.song.bars,
    loopA: S.loopA, loopB: S.loopB, waiting: S.waiting, tuningNames: S.tuningNames, flash: S.flash,
  });
  const cur = S.groups[S.nextIdx]?.notes ?? [];
  const nxt = S.groups[S.nextIdx + 1]?.notes ?? [];
  drawFretboard(el.fretboard, cur, nxt, S.tuningNames);
  el.seek.value = S.t;
  el.barLabel.textContent = `Takt ${barAt(S.t) + 1}/${S.song.bars.length}`;
}

function updateHint() {
  const g = S.groups[S.nextIdx];
  let txt;
  if (!g) txt = 'Koniec';
  else if (!S.playing) txt = S.mode === 'watch' ? 'Naciśnij ▶, żeby posłuchać' : 'Naciśnij ▶ i graj';
  else if (S.mode === 'watch') txt = 'Słuchaj i patrz';
  else {
    const parts = g.notes.slice().sort((a, b) => b.string - a.string)
      .map((n) => `struna ${n.string}, próg ${n.harm ? 'flażolet' : n.fret}`);
    txt = (S.waiting ? 'Zagraj: ' : 'Teraz: ') + parts.join(' + ');
  }
  el.hint.textContent = el.hint.dataset.heard && S.playing ? `${txt} · ${el.hint.dataset.heard}` : txt;
}

function updateScore() {
  let hit = 0, total = 0;
  S.hits.forEach((h) => { if (h) { total++; if (h === 'hit') hit++; } });
  el.score.textContent = total ? `${hit}/${total} · ${Math.round((hit / total) * 100)}%` : '';
}

function toggleLoop() {
  const bar = barAt(S.t);
  const bars = S.song.bars;
  if (S.loopStage === 0) {
    S.loopA = bars[bar]; S.loopB = null; S.loopStage = 1;
    el.loop.textContent = `Pętla: ${bar + 1}…`;
    el.loop.classList.add('active');
  } else if (S.loopStage === 1) {
    const a = bars.indexOf(S.loopA);
    const endBar = Math.max(bar, a);
    S.loopB = bars[endBar + 1] ?? S.song.duration;
    S.loopStage = 2;
    el.loop.textContent = `Pętla: ${a + 1}–${endBar + 1}`;
    seek(S.loopA, true);
  } else {
    clearLoop();
  }
}

function clearLoop() {
  S.loopA = S.loopB = null; S.loopStage = 0;
  el.loop.textContent = 'Pętla';
  el.loop.classList.remove('active');
}

function barAt(t) {
  const b = S.song.bars;
  let lo = 0, hi = b.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (b[m] <= t + 1e-6) lo = m; else hi = m - 1; }
  return lo;
}

function setupDragSeek() {
  let startX = null, startT = 0;
  el.highway.addEventListener('pointerdown', (e) => {
    startX = e.clientX; startT = S.t;
    el.highway.setPointerCapture(e.pointerId);
    if (S.playing) pause();
  });
  el.highway.addEventListener('pointermove', (e) => {
    if (startX == null) return;
    seek(startT - (e.clientX - startX) / S.pps, true);
  });
  const end = () => { startX = null; };
  el.highway.addEventListener('pointerup', end);
  el.highway.addEventListener('pointercancel', end);
}

function shortTrack(name) {
  const parts = name.split('|').map((s) => s.trim());
  return parts.length > 1 ? `${parts[parts.length - 1]} (${parts[0]})` : name;
}

function prefsKey() { return 'song:' + S.rec.id; }
function loadSongPrefs() { try { return JSON.parse(localStorage.getItem(prefsKey())) || {}; } catch { return {}; } }
function saveSongPrefs() {
  if (!S.rec) return;
  try { localStorage.setItem(prefsKey(), JSON.stringify({ track: Number(el.trackSel.value), speed: S.speed, mode: S.mode })); } catch {}
}

function escapeHtml(s) { return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
