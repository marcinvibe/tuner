// McLeod Pitch Method (NSDF + peak picking + parabolic interpolation).
// Returns { freq, clarity } where clarity is 0..1.
export function detectPitch(buf, sampleRate) {
  const n = buf.length;

  // Skip silence
  let rms = 0;
  for (let i = 0; i < n; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / n);
  if (rms < 0.01) return { freq: 0, clarity: 0 };

  // Limit lag search to guitar-ish range (down to ~55 Hz)
  const maxLag = Math.min(Math.floor(sampleRate / 55), n >> 1);
  const nsdf = new Float32Array(maxLag);
  for (let tau = 0; tau < maxLag; tau++) {
    let acf = 0, m = 0;
    for (let i = 0; i < n - tau; i++) {
      const a = buf[i], b = buf[i + tau];
      acf += a * b;
      m += a * a + b * b;
    }
    nsdf[tau] = m > 0 ? (2 * acf) / m : 0;
  }

  // Key maxima: highest peak between each positive-going and negative-going zero crossing
  const peaks = [];
  let pos = 0;
  while (pos < maxLag - 1 && nsdf[pos] > 0) pos++;
  while (pos < maxLag - 1 && nsdf[pos] <= 0) pos++;
  while (pos < maxLag - 1) {
    let best = pos;
    while (pos < maxLag - 1 && nsdf[pos] > 0) {
      if (nsdf[pos] > nsdf[best]) best = pos;
      pos++;
    }
    if (nsdf[best] > 0) peaks.push(best);
    while (pos < maxLag - 1 && nsdf[pos] <= 0) pos++;
  }
  if (!peaks.length) return { freq: 0, clarity: 0 };

  let highest = 0;
  for (const p of peaks) highest = Math.max(highest, nsdf[p]);
  const threshold = 0.9 * highest;
  const tau = peaks.find((p) => nsdf[p] >= threshold);

  // Parabolic interpolation for sub-sample accuracy
  let refined = tau, clarity = nsdf[tau];
  if (tau > 0 && tau < maxLag - 1) {
    const a = nsdf[tau - 1], b = nsdf[tau], c = nsdf[tau + 1];
    const denom = a - 2 * b + c;
    if (denom !== 0) {
      const shift = (a - c) / (2 * denom);
      refined = tau + shift;
      clarity = b - 0.25 * (a - c) * shift;
    }
  }
  return { freq: sampleRate / refined, clarity: Math.min(clarity, 1) };
}
