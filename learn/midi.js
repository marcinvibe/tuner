// Minimal Standard MIDI File parser.
// Returns { ppq, tempos: [{tick, usPerQ}], timeSigs: [{tick, num, den}], tracks: [{name, notes, channels:Set, program}] }
// Each note: { tick, durTicks, pitch, vel, ch }
export function parseMidi(arrayBuffer) {
  const d = new DataView(arrayBuffer);
  let p = 0;
  const str = (n) => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(d.getUint8(p + i)); p += n; return s; };
  const u32 = () => { const v = d.getUint32(p); p += 4; return v; };
  const u16 = () => { const v = d.getUint16(p); p += 2; return v; };
  const u8 = () => d.getUint8(p++);
  const vlq = () => { let v = 0, b; do { b = u8(); v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; };

  if (str(4) !== 'MThd') throw new Error('To nie jest plik MIDI');
  const hlen = u32();
  const format = u16(), ntracks = u16(), division = u16();
  p = 8 + hlen;
  if (division & 0x8000) throw new Error('SMPTE timing nie jest obsługiwany');

  const tempos = [], timeSigs = [], tracks = [];
  for (let t = 0; t < ntracks && p < d.byteLength; t++) {
    const id = str(4), len = u32(), end = p + len;
    if (id !== 'MTrk') { p = end; continue; }
    const track = { name: '', notes: [], channels: new Set(), program: null };
    const open = new Map(); // key ch*128+pitch -> stack of notes
    let tick = 0, status = 0;
    while (p < end) {
      tick += vlq();
      let b = d.getUint8(p);
      if (b & 0x80) { status = b; p++; } else if (!status) { p++; continue; }
      const type = status & 0xf0, ch = status & 0x0f;
      if (status === 0xff) {
        const mt = u8(), ml = vlq(), mstart = p;
        if (mt === 0x03) track.name = new TextDecoder().decode(new Uint8Array(arrayBuffer, p, ml)).trim();
        else if (mt === 0x51) tempos.push({ tick, usPerQ: (d.getUint8(p) << 16) | (d.getUint8(p + 1) << 8) | d.getUint8(p + 2) });
        else if (mt === 0x58) timeSigs.push({ tick, num: d.getUint8(p), den: 2 ** d.getUint8(p + 1) });
        p = mstart + ml;
        status = 0;
      } else if (status === 0xf0 || status === 0xf7) {
        p += vlq();
        status = 0;
      } else if (type === 0x90 || type === 0x80) {
        const pitch = u8(), vel = u8();
        const key = ch * 128 + pitch;
        if (type === 0x90 && vel > 0) {
          const n = { tick, durTicks: 0, pitch, vel, ch };
          track.notes.push(n);
          track.channels.add(ch);
          if (!open.has(key)) open.set(key, []);
          open.get(key).push(n);
        } else {
          const n = open.get(key)?.shift();
          if (n) n.durTicks = tick - n.tick;
        }
      } else if (type === 0xc0) {
        const prog = u8();
        if (track.program == null) track.program = prog;
      } else if (type === 0xd0) {
        p += 1;
      } else {
        p += 2; // 0xA0, 0xB0, 0xE0
      }
    }
    p = end;
    tracks.push(track);
  }
  tempos.sort((a, b) => a.tick - b.tick);
  if (!tempos.length || tempos[0].tick > 0) tempos.unshift({ tick: 0, usPerQ: 500000 });
  if (!timeSigs.length) timeSigs.push({ tick: 0, num: 4, den: 4 });
  return { format, ppq: division, tempos, timeSigs, tracks };
}

// Build a tick -> seconds converter from the tempo map.
export function tickToSec(ppq, tempos) {
  const seg = [];
  let sec = 0;
  for (let i = 0; i < tempos.length; i++) {
    const t = tempos[i];
    if (i > 0) sec += ((t.tick - tempos[i - 1].tick) * tempos[i - 1].usPerQ) / ppq / 1e6;
    seg.push({ tick: t.tick, sec, usPerQ: t.usPerQ });
  }
  return (tick) => {
    let s = seg[0];
    for (let i = 1; i < seg.length && seg[i].tick <= tick; i++) s = seg[i];
    return s.sec + ((tick - s.tick) * s.usPerQ) / ppq / 1e6;
  };
}
