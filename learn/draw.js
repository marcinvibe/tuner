// Canvas drawing for the note highway and the mini fretboard.
export const STRING_COLORS = { 6: '#ff453a', 5: '#ffd60a', 4: '#0a84ff', 3: '#ff9f0a', 2: '#30d158', 1: '#bf5af2' };
const THICK = { 6: 3.2, 5: 2.7, 4: 2.2, 3: 1.7, 2: 1.3, 1: 1 };

export function fitCanvas(cv) {
  const dpr = window.devicePixelRatio || 1;
  const r = cv.getBoundingClientRect();
  const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, W: r.width, H: r.height };
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// state: { t, pps, groups, nextIdx, hits, bars, loopA, loopB, waiting, tuningNames, flash }
export function drawHighway(cv, s) {
  const { g, W, H } = fitCanvas(cv);
  g.clearRect(0, 0, W, H);
  const top = 20, bottom = 6;
  const laneH = (H - top - bottom) / 6;
  const laneY = (string) => top + (6 - string) * laneH + laneH / 2;
  const hitX = Math.max(56, W * 0.16);
  const xOf = (time) => hitX + (time - s.t) * s.pps;
  const tMin = s.t - hitX / s.pps, tMax = s.t + (W - hitX) / s.pps;

  // Loop region
  if (s.loopA != null && s.loopB != null) {
    const a = xOf(s.loopA), b = xOf(s.loopB);
    g.fillStyle = 'rgba(10,132,255,.10)';
    g.fillRect(a, top - 4, b - a, H - top);
  }

  // Bars
  g.font = '600 10px -apple-system, system-ui, sans-serif';
  g.textAlign = 'left';
  s.bars.forEach((bt, i) => {
    if (bt < tMin - 1 || bt > tMax) return;
    const x = xOf(bt);
    g.strokeStyle = 'rgba(255,255,255,.12)';
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(x, top - 4); g.lineTo(x, H - bottom); g.stroke();
    g.fillStyle = '#636366';
    g.fillText(String(i + 1), x + 3, 11);
  });

  // Strings
  for (let st = 6; st >= 1; st--) {
    const y = laneY(st);
    g.strokeStyle = '#3a3a3c';
    g.lineWidth = THICK[st];
    g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
  }

  // Hit line
  g.strokeStyle = s.waiting ? '#f5f5f7' : 'rgba(245,245,247,.6)';
  g.lineWidth = 2;
  g.shadowColor = '#fff';
  g.shadowBlur = s.waiting ? 12 : 4;
  g.beginPath(); g.moveTo(hitX, top - 6); g.lineTo(hitX, H - bottom + 2); g.stroke();
  g.shadowBlur = 0;

  // Notes (only visible groups)
  const r = Math.min(laneH * 0.42, 13);
  let i0 = lowerBound(s.groups, tMin - 2);
  for (let i = i0; i < s.groups.length; i++) {
    const grp = s.groups[i];
    if (grp.t > tMax + 0.1) break;
    const state = s.hits[i]; // 'hit' | 'miss' | undefined
    const isNext = i === s.nextIdx;
    for (const n of grp.notes) {
      const x = xOf(n.t), y = laneY(n.string);
      const col = STRING_COLORS[n.string];
      const tailW = n.dur * s.pps;
      if (tailW > r * 1.5) {
        g.fillStyle = state === 'miss' ? 'rgba(99,99,102,.35)' : hexA(col, state === 'hit' ? 0.25 : 0.4);
        roundRect(g, x, y - 3, tailW, 6, 3); g.fill();
      }
      g.globalAlpha = state === 'hit' ? 0.35 : state === 'miss' ? 0.5 : x < hitX - 2 ? 0.5 : 1;
      const w = r * 2 + (n.fret >= 10 ? 6 : 0);
      g.fillStyle = state === 'miss' ? '#48484a' : col;
      if (isNext) { g.shadowColor = col; g.shadowBlur = 14; }
      roundRect(g, x - w / 2, y - r, w, r * 2, r * 0.55); g.fill();
      g.shadowBlur = 0;
      if (state === 'hit') {
        g.strokeStyle = '#30d158'; g.lineWidth = 2; g.stroke();
      }
      g.fillStyle = n.string === 5 || n.string === 3 ? '#000' : '#fff';
      g.font = `700 ${Math.round(r * 1.05)}px -apple-system, system-ui, sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(n.harm ? '◇' : String(n.fret), x, y + 0.5);
      g.textBaseline = 'alphabetic';
      g.globalAlpha = 1;
    }
  }

  // String names on the left edge
  g.fillStyle = 'rgba(0,0,0,.75)';
  g.fillRect(0, top - 4, 22, H - top);
  g.font = '600 11px -apple-system, system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let st = 6; st >= 1; st--) {
    g.fillStyle = STRING_COLORS[st];
    g.fillText(s.tuningNames[6 - st], 11, laneY(st));
  }
  g.textBaseline = 'alphabetic';

  // Hit flash
  if (s.flash && performance.now() - s.flash.at < 250) {
    const a = 1 - (performance.now() - s.flash.at) / 250;
    g.fillStyle = `rgba(48,209,88,${0.35 * a})`;
    g.fillRect(hitX - 24, top - 4, 48, H - top);
  }
}

// cur / nxt: arrays of notes to show on the neck
export function drawFretboard(cv, cur, nxt, tuningNames) {
  const { g, W, H } = fitCanvas(cv);
  g.clearRect(0, 0, W, H);
  const frets = [...cur, ...nxt].filter((n) => n.fret != null).map((n) => n.fret);
  const span = 12;
  const minF = frets.filter((f) => f > 0);
  // Show the nut whenever everything fits in the first 12 frets, otherwise follow the hand
  let start = 0;
  if (frets.length && Math.max(...frets) > span) {
    start = minF.length ? Math.min(...minF) - 1 : 0;
    start = Math.max(0, Math.min(start, 24 - span, Math.max(...frets) - 1));
  }

  const left = 40, right = 8, top = 8, bottom = 18;
  const fw = (W - left - right) / span;
  const sh = (H - top - bottom) / 5;
  const yOf = (st) => top + (6 - st) * sh;
  const xOfFret = (f) => (f === 0 ? left - 13 : left + (f - start - 0.5) * fw);

  // Board
  g.fillStyle = '#1c1c1e';
  g.fillRect(left, top - 6, W - left - right, H - top - bottom + 12);
  // Inlays
  g.fillStyle = '#3a3a3c';
  for (let f = start + 1; f <= start + span; f++) {
    const x = left + (f - start - 0.5) * fw, mid = top + (H - top - bottom) / 2;
    if ([3, 5, 7, 9, 15, 17, 19, 21].includes(f)) { g.beginPath(); g.arc(x, mid, 3.5, 0, 7); g.fill(); }
    if (f === 12 || f === 24) { g.beginPath(); g.arc(x, mid - sh, 3.5, 0, 7); g.arc(x, mid + sh, 3.5, 0, 7); g.fill(); }
  }
  // Frets
  for (let f = 0; f <= span; f++) {
    const x = left + f * fw;
    g.strokeStyle = f === 0 && start === 0 ? '#f5f5f7' : '#48484a';
    g.lineWidth = f === 0 && start === 0 ? 4 : 1.5;
    g.beginPath(); g.moveTo(x, top - 6); g.lineTo(x, H - bottom + 6); g.stroke();
    if (f > 0) {
      g.fillStyle = '#8e8e93';
      g.font = '500 10px -apple-system, system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText(String(start + f), left + (f - 0.5) * fw, H - 3);
    }
  }
  // Strings
  for (let st = 6; st >= 1; st--) {
    g.strokeStyle = '#8e8e93';
    g.lineWidth = THICK[st] * 0.8;
    g.beginPath(); g.moveTo(left, yOf(st)); g.lineTo(W - right, yOf(st)); g.stroke();
    g.fillStyle = '#8e8e93';
    g.font = '600 10px -apple-system, system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(tuningNames[6 - st], 9, yOf(st));
    g.textBaseline = 'alphabetic';
  }
  // Next notes (outline), then current (filled)
  const dot = (n, filled) => {
    if (n.fret == null || (n.fret > 0 && (n.fret <= start || n.fret > start + span))) return;
    const x = xOfFret(n.fret), y = yOf(n.string), r = Math.min(10, sh * 0.48);
    const col = STRING_COLORS[n.string];
    g.beginPath(); g.arc(x, y, r, 0, 7);
    if (filled) {
      g.fillStyle = col; g.shadowColor = col; g.shadowBlur = 10; g.fill(); g.shadowBlur = 0;
      g.fillStyle = n.string === 5 || n.string === 3 ? '#000' : '#fff';
      g.font = `700 ${Math.round(r * 1.1)}px -apple-system, system-ui, sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(n.fret), x, y + 0.5);
      g.textBaseline = 'alphabetic';
    } else {
      g.strokeStyle = hexA(col, 0.7); g.lineWidth = 2; g.stroke();
    }
  };
  nxt.forEach((n) => dot(n, false));
  cur.forEach((n) => dot(n, true));
}

export function lowerBound(groups, t) {
  let lo = 0, hi = groups.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (groups[m].t < t) lo = m + 1; else hi = m; }
  return lo;
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}
