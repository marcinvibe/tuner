import { parseMidi, tickToSec } from './midi.js';
import { TUNINGS } from '../tunings.js';

const MAX_FRET = 24;

// Turn a MIDI file into the song model the player uses.
// song = { title, tracks: [{ name, idx, notes: [{t, dur, string, fret, midi, harm}] , tuning, tuningName }], bars: [sec], duration }
export function songFromMidi(arrayBuffer, fileName = 'Utwór') {
  const m = parseMidi(arrayBuffer);
  const toSec = tickToSec(m.ppq, m.tempos);

  const tracks = m.tracks
    .map((t, idx) => ({ t, idx }))
    .filter(({ t }) => t.notes.length && !t.channels.has(9))
    .map(({ t, idx }) => buildTrack(t, idx, toSec))
    .filter(Boolean);

  const lastTick = Math.max(...m.tracks.flatMap((t) => t.notes.map((n) => n.tick + n.durTicks)), 0);
  return {
    title: fileName.replace(/\.(mid|midi)$/i, '').replace(/[-_]+/g, ' ').replace(/\s\d{2} \d{2} \d{4}$/, '').trim(),
    tracks,
    defaultTrack: pickDefaultTrack(tracks),
    bars: barStarts(m, lastTick).map(toSec),
    duration: toSec(lastTick),
  };
}

function buildTrack(t, idx, toSec) {
  const chans = [...t.channels];
  // Guitar Pro / Songsterr exports put each string on its own channel: ch0 = string 1 (high e)
  const stringChannels = chans.every((c) => c <= 5) && chans.length >= 2;
  const name = t.name || `Ścieżka ${idx + 1}`;
  const isBass = /bass/i.test(name) || (t.program >= 32 && t.program <= 39);

  let notes, tuning;
  if (stringChannels && !isBass) {
    tuning = inferTuning(t.notes);
    notes = t.notes.map((n) => {
      const string = n.ch + 1;
      const open = tuning.midi[6 - string];
      let fret = n.pitch - open;
      const harm = fret > MAX_FRET;
      return { tick: n.tick, durTicks: n.durTicks, string, fret: harm ? null : Math.max(0, fret), midi: n.pitch, harm };
    });
  } else if (!isBass) {
    tuning = inferTuning(t.notes, true);
    notes = assignFrets(t.notes, tuning.midi);
  } else {
    return null; // bass and other non-guitar parts are not supported yet
  }

  const out = notes
    .map((n) => {
      const t0 = toSec(n.tick);
      return { t: t0, dur: Math.max(0.08, toSec(n.tick + n.durTicks) - t0), string: n.string, fret: n.fret, midi: n.midi, harm: n.harm };
    })
    .sort((a, b) => a.t - b.t || b.string - a.string);
  return { name, idx, notes: out, tuning: tuning.midi, tuningId: tuning.id, tuningName: tuning.name };
}

// Pick the tuning (from the known list) where no note sits below its open string.
function inferTuning(notes, byPitchOnly = false) {
  let best = null;
  for (const tu of TUNINGS) {
    let neg = 0, high = 0;
    for (const n of notes) {
      if (byPitchOnly) {
        if (n.pitch < tu.midi[0]) neg++;
        continue;
      }
      const fret = n.pitch - tu.midi[6 - (n.ch + 1)];
      if (fret < 0) neg++;
      if (fret > MAX_FRET) high++;
    }
    const score = neg * 1000 + high;
    if (!best || score < best.score) best = { ...tu, score };
  }
  return best;
}

// Fallback for plain MIDI: choose a string/fret for each note, keeping the hand close to where it was.
function assignFrets(notes, tuning) {
  let hand = 3;
  const sorted = [...notes].sort((a, b) => a.tick - b.tick);
  const used = new Map(); // tick -> Set of strings taken
  return sorted.map((n) => {
    const taken = used.get(n.tick) || new Set();
    let best = null;
    for (let s = 1; s <= 6; s++) {
      if (taken.has(s)) continue;
      const fret = n.pitch - tuning[6 - s];
      if (fret < 0 || fret > MAX_FRET) continue;
      const cost = (fret === 0 ? 0 : Math.abs(fret - hand)) + fret * 0.05;
      if (!best || cost < best.cost) best = { s, fret, cost };
    }
    if (!best) return { tick: n.tick, durTicks: n.durTicks, string: 6, fret: null, midi: n.pitch, harm: true };
    taken.add(best.s);
    used.set(n.tick, taken);
    if (best.fret > 0) hand = best.fret;
    return { tick: n.tick, durTicks: n.durTicks, string: best.s, fret: best.fret, midi: n.pitch, harm: false };
  });
}

function pickDefaultTrack(tracks) {
  const score = (t) => (/guitar|gitar/i.test(t.name) ? 1e6 : 0) + (/lead|riff|rhythm/i.test(t.name) ? 1e5 : 0) + t.notes.length;
  let best = 0;
  tracks.forEach((t, i) => { if (score(t) > score(tracks[best])) best = i; });
  return best;
}

function barStarts(m, lastTick) {
  const sigs = m.timeSigs.slice().sort((a, b) => a.tick - b.tick)
    .filter((s, i, a) => i === a.length - 1 || a[i + 1].tick !== s.tick);
  const bars = [];
  let tick = 0, si = 0;
  while (tick <= lastTick && bars.length < 5000) {
    while (si + 1 < sigs.length && sigs[si + 1].tick <= tick) si++;
    bars.push(tick);
    const s = sigs[si];
    tick += (m.ppq * 4 * s.num) / s.den;
  }
  return bars;
}

// Group notes that start together (chords / double stops).
export function groupNotes(notes) {
  const groups = [];
  for (const n of notes) {
    const g = groups[groups.length - 1];
    if (g && Math.abs(n.t - g.t) < 0.03) g.notes.push(n);
    else groups.push({ t: n.t, notes: [n] });
  }
  return groups;
}
