// The listening engine. Reads three analysers each frame and works out what is playing: tempo,
// where bars start, which of 16 steps the kick, clap, closed and open hats and a lead/vocal line
// hit, the bass note and chord of each bar, the key, and a few "knob" values.

export const NOTES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
export const VOICES = ['bd', 'sd', 'hhc', 'hho', 'vox'];
// Everything with a 16-step pattern: the voices, and the bass line's rhythm (which steps a bass
// note starts on; the notes themselves are per bar, in slots).
const PARTS = [...VOICES, 'bass'];
export const ROLL_COLS = 48;
export const nowSec = () => performance.now() / 1000;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// ---------------------------------------------------------------- chords and keys

// Real notes ring with overtones (octaves and fifths), so the templates include them. Weights
// fall off as 1/n, like a sawtooth (most synths and brass are close to this). The 5th overtone (a
// major third up) is left out: it put a minor chord's third right on the chord's fifth, so a
// strong fifth tipped faint-third major chords to minor (measured on test songs: 37 of 60 bars
// right with it, 52 without).
const OVERTONES = [[0, 1], [0, 1 / 2], [7, 1 / 3], [0, 1 / 4], [7, 1 / 6]];
const unit = (v) => { const len = Math.hypot(...v); return v.map((x) => x / len); };
const NOTE_TPL = Array.from({ length: 12 }, (_, pc) => {
  const tpl = new Array(12).fill(0);
  for (const [iv, a] of OVERTONES) tpl[(pc + iv) % 12] += a;
  return unit(tpl);
});
// tpl: what the chord sounds like, overtones and all (to find it in a spectrum); tones: just its
// three notes (what it says about the key: an E minor chord's B rings an F# overtone, but there's
// no F# in the song)
const CHORDS = [];
for (let r = 0; r < 12; r++) {
  for (const [q, third] of [['', 4], ['m', 3]]) {
    const tpl = new Array(12).fill(0), tones = new Array(12).fill(0);
    for (const [note, w] of [[r, 1], [r + third, 0.9], [r + 7, 0.9]]) {
      for (let i = 0; i < 12; i++) tpl[i] += w * NOTE_TPL[note % 12][i];
      tones[note % 12] += w;
    }
    CHORDS.push({ root: r, q, name: NOTES[r] + q, third, tpl: unit(tpl), tones: unit(tones) });
  }
}

// Matches a bar's 12-note profile against every major and minor chord.
function bestChord(raw, bassPc) {
  const c0 = Array.from(raw);
  // A loud bass note's 5th overtone sounds a major third above it and would turn minor chords
  // major. Take out roughly what it adds (about a tenth of the bass note's own strength).
  if (bassPc >= 0) c0[(bassPc + 4) % 12] = Math.max(0, c0[(bassPc + 4) % 12] - 0.12 * c0[bassPc]);
  // Drums and noise lift all 12 notes evenly; take that floor out too.
  const floor = Math.min(...c0);
  const c = unit(c0.map((x) => x - floor));
  if (c.some(Number.isNaN)) return null;
  let best = null;
  for (const ch of CHORDS) {
    let score = 0;
    for (let i = 0; i < 12; i++) score += c[i] * ch.tpl[i];
    if (ch.root === bassPc) score += 0.02;
    if (!best || score > best.score) best = { ...ch, score };
  }
  return best.score > 0.7 ? best : null;
}

const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
// How well the notes fit each of the 24 keys, as { root, mode, score }.
function keyFits(c) {
  const corr = (x, y) => {
    const mx = x.reduce((a, b) => a + b) / 12, my = y.reduce((a, b) => a + b) / 12;
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < 12; i++) { num += (x[i] - mx) * (y[i] - my); dx += (x[i] - mx) ** 2; dy += (y[i] - my) ** 2; }
    return dx && dy ? num / Math.sqrt(dx * dy) : 0;
  };
  const fits = [];
  for (let r = 0; r < 12; r++) {
    const rotated = Array.from({ length: 12 }, (_, i) => c[(r + i) % 12]);
    for (const [mode, profile] of [['major', KK_MAJOR], ['minor', KK_MINOR]]) fits.push({ root: r, mode, score: corr(rotated, profile) });
  }
  return fits;
}
function bestKey(fits) {
  let best = null;
  for (const f of fits) if (!best || f.score > best.score) best = f;
  return best && best.score > 0.3 ? best : null;
}

// ---------------------------------------------------------------- onset detection

function pitchMap(lo, hi, hzPerBin) {
  const idx = [], pc = [], w = [], midi = [];
  for (let k = Math.ceil(lo / hzPerBin); k <= Math.floor(hi / hzPerBin); k++) {
    const m = 69 + 12 * Math.log2((k * hzPerBin) / 440);
    const r = Math.round(m);
    const weight = Math.cos(Math.PI * (m - r)) ** 2; // 1 on the note, 0 halfway to the next
    if (weight < 0.05) continue;
    idx.push(k); pc.push(((r % 12) + 12) % 12); w.push(weight); midi.push(r);
  }
  return { idx: Int32Array.from(idx), pc: Uint8Array.from(pc), w: Float32Array.from(w), midi: Int16Array.from(midi) };
}

function makeDetector(k, refractory, minRel, robust = false) {
  return { hist: [], sorted: new Float32Array(48), prevX: 0, prevThr: Infinity, last: -10, peak: 0, max: 1e-6, hits: 0, k, refractory, minRel, robust };
}

// Adaptive-threshold onset detector on a band's spectral flux. Returns hit strength (0 = no hit).
// A robust detector sets its threshold from the typical level between hits (median and spread
// of the middle half), so a run of loud hits (bass notes, say) can't lift it over quieter ones.
function detectOnset(d, x, t, allow) {
  const h = d.hist;
  const n = Math.max(1, h.length);
  let thr;
  if (d.robust && h.length >= 12) {
    const s = d.sorted.subarray(0, h.length);
    s.set(h);
    s.sort();
    const q1 = s[Math.floor(n / 4)], q2 = s[Math.floor(n / 2)], q3 = s[Math.floor((3 * n) / 4)];
    thr = q2 + d.k * ((q3 - q1) / 1.35);
  } else {
    let mean = 0, sq = 0;
    for (const y of h) { mean += y; sq += y * y; }
    mean /= n;
    thr = mean + d.k * Math.sqrt(Math.max(0, sq / n - mean * mean));
  }
  d.max = Math.max(x, d.max * 0.9995);
  d.peak *= 0.9997; // slowly forget, so a quieter section can still register
  thr += 0.06 * d.max;
  let strength = 0;
  const rising = allow && h.length >= 12 && x > thr && d.prevX <= d.prevThr && t - d.last > d.refractory;
  // A hit must reach a share of the voice's typical hit; keeps bass notes from posing as kicks.
  if (rising && !(d.hits >= 4 && x < d.minRel * d.peak)) {
    d.last = t;
    d.hits++;
    d.peak = d.peak ? d.peak * 0.9 + x * 0.1 : x;
    strength = clamp(x / d.peak, 0.2, 1.6);
  }
  d.prevX = x;
  d.prevThr = thr;
  h.push(x);
  if (h.length > 48) h.shift();
  return strength;
}

// ---------------------------------------------------------------- kick or bass?

// A low-pass filter (RBJ biquad) for the bottom end, below fc.
function lowPass(sr, fc = 200, q = Math.SQRT1_2) {
  const w = (2 * Math.PI * fc) / sr, a = Math.sin(w) / (2 * q), c = Math.cos(w), a0 = 1 + a;
  return { b0: (1 - c) / 2 / a0, b1: (1 - c) / a0, b2: (1 - c) / 2 / a0, a1: (-2 * c) / a0, a2: (1 - a) / a0 };
}

// The low end of buf (the long analyser's samples, newest last) between `from` and `to` seconds
// ago: through the low-pass filter c twice (4 poles: a riddim growl's harmonics, loud right up the
// mids, came through 2 enough to hide the sub's pitch under them, and every sub note was taken for
// a kick), thinned by dec, ready for lowPitch.
function lowSlice(buf, sr, c, dec, from, to) {
  const N = buf.length, start = Math.max(0, Math.round(N - from * sr)), end = Math.min(N, Math.round(N - to * sr)), out = [];
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0, u1 = 0, u2 = 0, z1 = 0, z2 = 0;
  for (let i = Math.max(0, start - Math.round(0.02 * sr)); i < end; i++) { // start early so the filter settles
    const y = c.b0 * buf[i] + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1; x1 = buf[i]; y2 = y1; y1 = y;
    const z = c.b0 * y + c.b1 * u1 + c.b2 * u2 - c.a1 * z1 - c.a2 * z2;
    u2 = u1; u1 = y; z2 = z1; z1 = z;
    if (i >= start && (i - start) % dec === 0) out.push(z);
  }
  return out;
}

// How a sound in the low end struck, `ago` seconds back in buf: its first 15 ms's level against the
// 40 ms before it (jump), and the pitch over its first 35 ms (f0, 0 if none)
function lowStrike(buf, sr, c, dec, ago) {
  const rms = (x) => { let e = 0; for (const v of x) e += v * v; return Math.sqrt(e / Math.max(1, x.length)); };
  const fs = sr / dec, first = lowSlice(buf, sr, c, dec, ago, Math.max(0, ago - 0.035));
  const before = rms(lowSlice(buf, sr, c, dec, ago + 0.045, ago + 0.005));
  return { jump: rms(first.slice(0, Math.round(0.015 * fs))) / Math.max(1e-9, before), f0: lowPitch(first, fs).f };
}

// Pitch (28-300 Hz; 0 if there's no clear one) and loudness of x, sampled at fs. (Down to 28: a
// riddim sub sits as low as C#1, 34.6 Hz, and below 35 there was no pitch to find, so a held sub
// note counted as a kick.)
function lowPitch(x, fs) {
  const n = x.length;
  let e = 0;
  for (const v of x) e += v * v;
  const rms = Math.sqrt(e / n), lo = Math.floor(fs / 300), hi = Math.min(Math.floor(fs / 28), n - 8);
  if (e <= 1e-12 || hi <= lo + 2) return { f: 0, rms, r: 0 };
  const r = new Float32Array(hi + 2);
  let max = 0;
  for (let L = lo; L <= hi; L++) {
    let s = 0, a = 0, b = 0;
    for (let i = 0; i + L < n; i++) { s += x[i] * x[i + L]; a += x[i] * x[i]; b += x[i + L] * x[i + L]; }
    r[L] = s / Math.sqrt(a * b || 1e-30);
    max = Math.max(max, r[L]);
  }
  // the first strong peak, so a multiple of the period isn't mistaken for it
  for (let L = lo + 1; L < hi; L++) {
    if (r[L] < 0.9 * max || r[L] < r[L - 1] || r[L] < r[L + 1]) continue;
    const p = r[L - 1], q = r[L + 1], den = p - 2 * r[L] + q;
    return { f: fs / (L + (den < 0 ? (0.5 * (p - q)) / den : 0)), rms, r: r[L] };
  }
  return { f: 0, rms, r: 0 };
}

// The bass's note now, for the bass line note by note (bassTrack): YIN (de Cheveigné and Kawahara)
// on the low end x, thinned to fs, its first w samples against the rest: the pitch (28-300 Hz; 0 if
// there's no clear one) and the loudness. lowPitch reads a hit once, at its start; this runs every
// frame on whatever the low end is doing, and YIN's running normalization keeps a held note from
// reading an octave off as it fades. d: a scratch array (256 long).
function bassYin(x, w, fs, d) {
  const tmin = Math.floor(fs / 300), tmax = Math.min(Math.floor(fs / 28), x.length - w - 1);
  let e = 0;
  for (let j = 0; j < w; j++) e += x[j] * x[j];
  const rms = Math.sqrt(e / w);
  if (e <= 1e-12 || tmax <= tmin + 2) return { f: 0, rms };
  let run = 0;
  d[0] = 1;
  for (let tau = 1; tau <= tmax; tau++) {
    let s = 0;
    for (let j = 0; j < w; j++) { const v = x[j] - x[j + tau]; s += v * v; }
    run += s;
    d[tau] = run > 0 ? (s * tau) / run : 1;
    // the first dip under 0.15, at its bottom
    const k = tau - 1;
    if (k > tmin && d[k] < 0.15 && d[k] <= d[tau]) {
      const p = d[k - 1], q = d[tau], den = p - 2 * d[k] + q;
      return { f: fs / (k + (den > 0 ? (0.5 * (p - q)) / den : 0)), rms };
    }
  }
  return { f: 0, rms };
}

// The bass tracker's state (bassTrack): its loudness yardstick (the loudest reading of late, fading),
// the recording's tuning (a running circular mean of how far its notes sit off the semitones), the
// note being held and when its readings were, and each bar's beats: how many readings each had, and
// how many of them each held note.
const newBassTrack = () => ({ ref: 0, c: 0, s: 0, run: { m: -1, n: 0, at: [] }, bars: new Map(), d: new Float32Array(256) });

function makeVoice(id) {
  // [turn a step on above this share of the busiest step, turn it off below this, bars to hold]
  const [onAt, offAt, holdBars] = { bd: [0.5, 0.3, 1], sd: [0.5, 0.3, 1], hhc: [0.35, 0.2, 2], hho: [0.4, 0.25, 2], vox: [0.4, 0.25, 1], bass: [0.45, 0.25, 2] }[id];
  return {
    id, onAt, offAt, holdBars,
    grid: new Float32Array(16), on: new Array(16).fill(false), shown: null, sig: null, sigN: 0,
    hitBar: new Int32Array(16).fill(-999), tok: new Array(16).fill(null),
    // (the hats' fallback: each step's hits over the last several bars, the last 4 bars' counts, and
    // whether what's shown is that steady subdivision rather than the steps learned)
    long: new Float32Array(16), counts: [], approx: false,
    lastHit: { t: -10, step: -1 }, last: -10, prev: -10, busyN: 0, calmN: 0, tooBusy: false, here: false,
  };
}

// Listening for a song's first chord (see listenOpening). armed: the music about to start is a
// song from its start. half, prev: the note analysis summed over this half second and the one
// before. key: the key the chord is home in, once found.
const openingHalf = () => ({ c: new Float32Array(12), b: new Float32Array(12), n: 0 });
function newOpening(armed) {
  return { armed, from: null, halfAt: 0, half: openingHalf(), prev: null, chord: null, key: null };
}

// ---------------------------------------------------------------- the engine

export function createEngine({ fast, mid, slow, sampleRate: sr }) {
  const hzFast = sr / fast.fftSize, hzMid = sr / mid.fftSize, hzSlow = sr / slow.fftSize;
  const fastBand = (lo, hi) => [Math.max(1, Math.round(lo / hzFast)), Math.min(fast.frequencyBinCount - 1, Math.round(hi / hzFast))];
  const midBand = (lo, hi) => [Math.round(lo / hzMid), Math.round(hi / hzMid)];
  const chromaLo = Math.ceil(100 / hzSlow), chromaHi = Math.floor(4000 / hzSlow);

  const eng = {
    sr, hzFast, hzSlow,
    lag: slow.fftSize / 2 / sr, // the note analysis hears each moment about half a window late
    // all: every instrument's onsets together, for a tempo when the drums don't give one
    band: { bd: fastBand(40, 130), sd: fastBand(1100, 5200), hh: fastBand(7000, 15000), all: fastBand(100, 11000), body: fastBand(800, 3000), thump: fastBand(150, 400), click: fastBand(2000, 6000), ring: fastBand(2000, 14000) },
    leadBand: midBand(300, 2000),
    fastDb: new Float32Array(fast.frequencyBinCount),
    midDb: new Float32Array(mid.frequencyBinCount),
    slowDb: new Float32Array(slow.frequencyBinCount),
    time: new Float32Array(fast.fftSize),
    slowTime: new Float32Array(slow.fftSize),
    lp: lowPass(sr),
    dec: Math.max(1, Math.round(sr / 6000)), // the low end, thinned to ~6 kHz for its pitch
    // A sound taken for a kick that's a bass note changing (see lowDecide): it jumped less than
    // this (its first 15 ms against the 40 ms before), was softer than this onset strength, and
    // starts under this pitch. Fit on the onset logs of 22 songs (bass notes off the beat start at
    // 45-60 Hz and barely jump; kicks jump 2-12x, or read at the pitch's floor, ~30 Hz; Calling
    // For You's kicks read 78-89 Hz). Three live runs of each: the kick line showed 67% of the
    // time against 59% (Starships 6 -> 78%, Show Me Love 36 -> 73%). null turns it off.
    // placeHeld: a kick under a note that keeps ringing (the low end stays loud, so it takes the
    // held path below) still belongs on the kick line when it lands on a beat, once two beats of
    // the bar are already kicks. A four-on-the-floor kick under a held bass barely punches, and
    // the beat it missed stays missing; a song with one kick on the bar (dubstep) isn't filled in.
    // Off with the rest of kickFix.
    kickFix: { demoteJump: 1.9, demoteS: 1.1, demoteF: 75, placeHeld: true },
    // The first lock against the 4:3 misreading: a syncopated riff's dotted 8ths read as the beat of
    // a tempo a third faster (Gypsy Woman's intro at 160 for its 120, Sunset Lover at 121 for its 91,
    // Starships at 165 for its 125, Starboy at 124 for its 93), and the lock held it for 15 s to the
    // whole song. At the first lock the bars are asked where they repeat (repeats): at 3:4 of the
    // tempo by `margin` more, that's the tempo (only that way: the misreading always runs fast, and
    // the bars of a slow song's intro, Sunset Lover's, can repeat at 4:3 by chance); about as well at
    // 3:4 or 4:3 (within `tie`), it waits, up to `wait` seconds, for the song to say.
    // Once locked, a sure reading at 4:3 or 3:4 whose grid the hits fit `fit43` times as well (in 6
    // of the drums' last 12 readings) changes it, as 3:2 does at 1.5. null turns it all off.
    tempoFix: { margin: 0.1, tie: 0.02, wait: 6, fit43: 1.25 },
    lg: new Float32Array(fast.frequencyBinCount),
    prevLg: new Float32Array(fast.frequencyBinCount),
    prevDb: new Float32Array(fast.frequencyBinCount),
    prevMidMag: new Float32Array(mid.frequencyBinCount),
    frameChroma: new Float32Array(12),
    frameBass: new Float32Array(12),
    prefix: new Float64Array(chromaHi - chromaLo + 18),
    bassMap: pitchMap(35, 220, hzSlow),
    on: { drop() {}, kick() {}, newSong() {} },
    // What's known about the song from outside: whether there is one (a title from Windows, a
    // file, the demo) and whether Windows says it's playing. Set by the app.
    song: () => ({ known: false, playing: false }),
    events: [],
    tick: 0,

    // top: what comes next is a song from its start (a file, the demo, a new song from Windows),
    // so its first chord is worth listening for (see listenOpening)
    reset({ top = false } = {}) {
      this.det = {
        bd: makeDetector(1.5, 0.12, 0.3, true), // bass notes get sorted out afterwards (lowDecide)
        sd: makeDetector(1.9, 0.09, 0.35, true),
        hh: makeDetector(1.6, 0.045, 0, true),
        lead: makeDetector(2.5, 0.1, 0.3, true),
      };
      this.v = Object.fromEntries(PARTS.map((id) => [id, makeVoice(id)]));
      this.onsets = [];
      this.taps = [];
      this.firstTap = null;
      this.tape?.reset(this.tempo?.down); // (the bar's start in the song that's ending)
      // the whole spectrum's onset strength, frame by frame, for the last 11 seconds (fluxTempo)
      this.fluxT = [];
      this.fluxV = [];
      this.fluxFresh = true;
      // renumber: how far the step numbers have moved in all (see relabel); the blocks follow it.
      // clearAt: when the drums last gave a clear tempo reading; fbpm, frun: the whole sound's
      // tempo and how many good readings running have agreed on it; fseen: its readings of the
      // last few seconds ({ t, bpm, ok }) (fluxUpdate). drumRun: the drums' readings lately, running
      // at one tempo ({ t, bpm, conf, fit }), clear or not; agreeN, agreeBpm: how many times running
      // the two readings have agreed, and on what (fluxUpdate). better: the drums' last 12 readings
      // since the lock, the tempo of each that a 3:2 tempo fits better, else 0 (tempoUpdate)
      this.tempo = { bpm: 0, shown: 0, P: 0, t0: 0, n0: 0, locked: false, cand: 0, candN: 0, down: 0, downCand: 0, downN: 0, half: null, halfCand: 0, halfN: 0, halfOff: 0, halfSeen: false, halved: false, ringTop: -Infinity, renumber: 0, slotCand: 0, slotN: 0, unclearN: 0, clearAt: -10, fbpm: 0, frun: 0, fseen: [], byFlux: false, drumRun: [], agreeN: 0, agreeBpm: 0, better: [] };
      this.repAt = -1;
      this.repCache = new Map();
      this.kickB = new Float32Array(4);
      this.snareB = new Float32Array(4);
      this.changeB = new Float32Array(4);
      // the snare's ring on each beat of 4 and how well it holds (snareRing): the medians of the
      // last 8 readings of each (ringH, holdH), how many beats each has been measured on, from the
      // 2-14 kHz loudness of the last 1.2 seconds, frame by frame; ringBeat: the beat waiting to be
      // measured
      this.ringB = new Float32Array(4);
      this.holdB = new Float32Array(4);
      this.ringH = [[], [], [], []];
      this.holdH = [[], [], [], []];
      this.ringN = new Uint16Array(4);
      this.ringT = [];
      this.ringV = [];
      this.ringBeat = null;
      this.halveFor = null; // (half-time just found at a fast tempo: see halve)
      this.beatChroma = new Float32Array(12);
      this.prevBeatChroma = null;
      this.beatBass = new Float32Array(12);
      this.prevBeatBass = null;
      this.bassF0 = 0;
      this.barChroma = new Float32Array(12);
      this.barBass = new Float32Array(12);
      this.bassMidi = new Float32Array(128);
      this.barFrames = this.bassFrames = 0;
      this.bassSeen = this.chordSeen = -10;
      this.longChroma = new Float32Array(12);
      this.stepChroma = new Float32Array(12);
      this.stepN = 0;
      this.lastCol = 0;
      this.rollCols = [];
      this.slots = [null, null, null, null];
      this.lastChord = null;
      this.key = null;
      this.keyCand = null;
      this.keyCandN = 0;
      this.keyBars = 0; // bars with a chord since the reset
      this.keyShown = 0; // and since the key shown last changed
      this.opening = newOpening(top);
      this.resetAt = nowSec();
      this.level = 0;
      this.lastSound = nowSec();
      this.lastSilentAt = -1;
      this.silent = false;
      this.lastKick = -10;
      this.lowPending = this.bassCheck = null;
      this.lastBassHit = null;
      this.bt = newBassTrack();
      this.bassBeats = [null, null, null, null]; // each slot's bass note by the beat (harmonyBar)
      this.lowE = 0;
      this.lastDrop = -99;
      this.nextTempo = 0;
      this.hhE = 0;
      this.hhPending = null;
      this.hhDurs = [];
      this.hhHit = { t: -10, step: -1 };
      this.knobAcc = { bass: 0, chords: 0, hh: 0, n: 0 };
      this.knobs = { bassLpf: 600, chordLpf: 2400, hhGain: 0.5, hhMax: 1e-9 };
      // the bass's sound (bassBright, wobbleCheck): its brightness a moment at a time for the last
      // 6 seconds (and its low end's and mids' levels), its deep sub and all of it over the bar;
      // what it sounds like (wobble: 0, or how
      // many filter sweeps a beat: 2 the 8ths, 3 triplets, 4 the 16ths; sub: deep sub's share of
      // it), and the bars running that have agreed on a change of wobble
      this.wobT = [];
      this.wobV = [];
      this.wobL = [];
      this.wobM = [];
      this.subAcc = { sub: 0, all: 0 };
      this.bassSound = { wobble: 0, sub: 0 };
      this.wobRun = { rate: 0, n: 0 };
      // sidechain pumping (pumpCheck): the 800-3000 Hz band's level for the last 2 seconds, kicks
      // waiting to be measured, how far it dipped under each (dB), whether it pumps and how deep
      this.bodyT = [];
      this.bodyV = [];
      this.pumpKicks = [];
      this.pumpDips = [];
      this.pump = 0;
      this.ducking = false;
      this.duckDepth = 0.5;
      this.rollDirty = true;
      this.resetClocks();
      this.prevLg.fill(0);
      this.prevMidMag.fill(0);
    },

    resetClocks() {
      this.bar = this.step = this.beat = null;
      this.hBar = this.hStep = this.hBeat = null;
    },

    frame(t, audioT) {
      fast.getFloatFrequencyData(this.fastDb);
      fast.getFloatTimeDomainData(this.time);
      let ss = 0;
      for (const s of this.time) ss += s * s;
      const rms = Math.sqrt(ss / this.time.length);
      this.level = Math.max(rms, this.level * 0.9);
      if (rms > 0.004) this.lastSound = t;
      const wasSilent = this.silent;
      this.silent = t - this.lastSound > 1.2;
      // A long gap usually means a new song: start learning from scratch. (Unless Windows says the
      // same song is still playing: then it's a quiet part, and the beat carries on after it.)
      if (this.silent && t - this.lastSound > (this.song().playing ? 20 : 4) && this.tempo.locked) {
        this.note('silence reset');
        this.reset();
        this.lastSound = t - 4.1;
        this.silent = true;
        this.on.newSong();
        return;
      }
      if (this.silent) { this.lastSilentAt = t; return; }
      if (wasSilent) {
        this.prevLg.fill(0);
        this.prevDb.set(this.fastDb);
        this.prevMidMag.fill(0);
        // music starting after a silence: likely a song from its start (unless its first chord
        // was already heard)
        if (!this.opening.chord) this.opening = newOpening(true);
      }

      const lg = this.lg, prev = this.prevLg, db = this.fastDb;
      // how much the thump (150-400 Hz) and the click (2-6 kHz) rose since the frame before, in dB
      // over their bins: a kick's attack lifts one or both (lowDecide: a kick on a bass note). Of the
      // test songs' kicks on a held note, 38 of 40 rose over 10 dB in the thump or 6 in the click
      // (an 808 has hardly any click); of a riddim sub's 147 pulses under its growl, 21. Both at
      // once (8 and 3) kept only 30 of the kicks, and pop's and intro's kick lines lost a step.
      const riseDb = ([a, b]) => { let r = 0; for (let k = a; k <= b; k++) r += Math.max(-160, db[k]) - Math.max(-160, this.prevDb[k]); return r / (b - a + 1); };
      const thump = riseDb(this.band.thump), click = riseDb(this.band.click);
      this.prevDb.set(db);
      for (let k = 0; k < lg.length; k++) lg[k] = db[k] > -160 ? Math.log1p(1000 * 10 ** (db[k] / 20)) : 0;
      const flux = ([a, b]) => {
        let s = 0;
        for (let k = a; k <= b; k++) { const d = lg[k] - prev[k]; if (d > 0) s += d; }
        return s;
      };
      const fBd = flux(this.band.bd), fSd = flux(this.band.sd), fHh = flux(this.band.hh);
      // A clap or snare lifts nearly every bin of its band at once (a chord or a voice lifts a
      // few), and lifts its band more than the hi-hat band (an open hat is the reverse). "Lifts"
      // is relative to the average rise, so it works at any volume.
      const sdBins = this.band.sd[1] - this.band.sd[0] + 1, hhBins = this.band.hh[1] - this.band.hh[0] + 1;
      let cover = 0;
      const rise = Math.max(0.02, (0.3 * fSd) / sdBins);
      for (let k = this.band.sd[0]; k <= this.band.sd[1]; k++) if (lg[k] - prev[k] > rise) cover++;
      this.sdCover = cover / sdBins;
      this.sdVsHh = fSd / sdBins / ((fHh + 1e-6) / hhBins);
      // A kick puts new energy into the bottom end. (As one dies away its pitch slides down through
      // the lowest bins, which can lift one bin alone; the total keeps falling, so that isn't a hit.)
      let lowE = 0;
      for (let k = 0; k <= this.band.bd[1] + 1; k++) lowE += 10 ** (db[k] / 10);
      const louder = lowE > 1.3 * (this.lowE || 0);
      this.lowE = lowE;
      let hhE = 0;
      for (let k = this.band.hh[0]; k <= this.band.hh[1]; k++) hhE += 10 ** (db[k] / 10);
      this.hhE = hhE;
      let ringE = 0;
      for (let k = this.band.ring[0]; k <= this.band.ring[1]; k++) ringE += 10 ** (db[k] / 10);
      this.ringT.push(t);
      this.ringV.push(10 * Math.log10(ringE + 1e-12));
      // (every one gone that's older than the window, not one a frame: after a pause in the music the
      // ones from before it stayed on, seconds of them)
      while (this.ringT[0] < t - 1.2) { this.ringT.shift(); this.ringV.shift(); }
      let bodyE = 0;
      for (let k = this.band.body[0]; k <= this.band.body[1]; k++) bodyE += 10 ** (db[k] / 10);
      this.bodyT.push(t);
      this.bodyV.push(10 * Math.log10(bodyE + 1e-12));
      while (this.bodyT[0] < t - 2) { this.bodyT.shift(); this.bodyV.shift(); }
      this.pumpCheck(t);
      // (not the first frame after a reset or a silence: everything rises from nothing there).
      // Timed by the audio clock where there is one (audioT): the sound arrives in uneven slices
      // of 8 to 21 ms between these 15 ms ticks, and timing each onset by the tick blurred the beat
      // by several ms, enough to take a third off a soft song's pulse.
      if (this.fluxFresh || wasSilent) this.fluxFresh = false;
      else if (audioT === undefined || audioT !== this.lastAudioT) {
        let at = t;
        if (audioT !== undefined) {
          const off = t - audioT;
          this.audioOff = this.audioOff === undefined || Math.abs(off - this.audioOff) > 0.2 ? off : this.audioOff + 0.02 * (off - this.audioOff);
          at = audioT + this.audioOff;
        }
        this.fluxT.push(at);
        this.fluxV.push(flux(this.band.all));
        while (this.fluxT[0] < t - 11) { this.fluxT.shift(); this.fluxV.shift(); }
      }
      this.lastAudioT = audioT;
      prev.set(lg);

      const D = this.det;
      const sBd = detectOnset(D.bd, fBd, t, louder);
      // Something new in the kick band: a kick, or a bass note? That's decided once 90 ms of it
      // has been heard (or sooner if the next one comes first); the visuals pulse right away.
      if (this.lowPending && (sBd || t - this.lowPending.t >= 0.09)) this.lowDecide(t);
      if (this.bassCheck && t - this.bassCheck.t >= 0.19) this.bassUnderKick(t);
      if (sBd) {
        this.on.kick(sBd);
        this.lowPending = { t, s: sBd, punch: thump > 10 || click > 6 };
      }
      // And a clap or snare is a burst of noise, so it lifts the top end with it: a guitar chop, a
      // keyboard stab or a sung note rises in this band alone (sdVsHh 10 and up), and lifts fewer of
      // its bins at once (measured on songs: claps 0.8 to 0.9 of them, those 0.65 to 0.75).
      const sSd = detectOnset(D.sd, fSd, t, this.sdCover > 0.72 && this.sdVsHh > 0.9 && this.sdVsHh < 10);
      // (in half-time the clap is the snare on beat 3: one heard anywhere else, the kick's click
      // on 1 or the bass's growl through a drop, only the timing hears)
      if (sSd && this.tempo.locked && this.tempo.half !== null && this.halfRole(t) !== 'snare') this.onsets.push({ t, id: 'sd', s: sSd });
      else if (sSd) this.onset('sd', t, sSd);
      const sHh = detectOnset(D.hh, fHh, t, true);
      if (sHh) this.hhOnset(t, sHh);
      this.hhTrack(t);
      this.bassTrack(t);
      // Drum hits need every tick (~66 a second). The long note analysis (a 16384-point FFT)
      // only needs about 22 a second and the melody one about 33, which saves most of the work.
      this.tick = (this.tick + 1) % 6;
      if (this.tick % 3 === 0) this.pitch(t); // before lead(): it finds the bass note lead() ignores
      if (this.tick % 2 === 0) this.lead(t);
      this.clock(t);
      // the hits of the last 20 seconds are all that's looked at; trimmed here, for every kind (hats
      // and bass notes come in by other ways than onset(), and a long stretch of only those grew
      // the list without end)
      while (this.onsets.length && this.onsets[0].t < t - 20) this.onsets.shift();
      if (t >= this.nextTempo) {
        this.nextTempo = t + 0.5;
        this.estimateTempo(t);
        this.fluxUpdate(t);
      }
    },

    // Where time t falls: bar number and step (0-15), or null if the beat isn't known yet.
    placeAt(t) {
      const T = this.tempo;
      if (!T.locked) return null;
      const beatF = T.n0 + (t - T.t0) / T.P;
      const pos = ((beatF - T.down) / 4) * 16, q = Math.round(pos);
      const bar = Math.floor(q / 16);
      return { bar, step: q - bar * 16, off: pos - q, beatF };
    },

    // Records a hit for a voice in the 16-step grid of the bar it falls in.
    place(id, t, s, tok = null) {
      const v = this.v[id];
      v.prev = v.last;
      v.last = t;
      const p = this.placeAt(t);
      if (!p || Math.abs(p.off) > 0.38) { v.lastHit = { t, step: -1 }; return; }
      // A clear hit counts in full however loud it was, so a part's quieter hits still make the
      // pattern; weak strays count for less.
      v.grid[p.step] += Math.min(1, 2 * s);
      v.hitBar[p.step] = p.bar;
      if (tok !== null) v.tok[p.step] = tok;
      v.lastHit = { t, step: p.step };
      if (window.NC_DEBUG) this.trace('hit', { id, s: +s.toFixed(2), bar: p.bar, step: p.step, tok });
    },

    // The sound in the kick band that started at p.t: a kick or a bass note. From the waveform
    // since then: a kick's pitch falls fast and it dies away; a bass note holds its pitch and
    // rings on. A sound whose pitch can't be read but whose low end holds up (the second half
    // nearly as loud as the first, or louder) isn't a kick dying away either: a bass note (a riddim
    // sub under its growl reads as one overtone, then another), or, with a kick's thump or click
    // at its start, a kick on a note: both. (Measured: the test songs' kicks die to 0.58 of their
    // start, their bass notes hold at 1.11; a riddim sub under a growl, 0.9 and up.) Anything else
    // unclear counts as a kick.
    lowDecide(t) {
      const p = this.lowPending, span = Math.min(0.09, t - p.t);
      this.lowPending = null;
      this.lowRead = null; // (what it read, for tools/checks.js)
      // How it struck: the low end's jump at its start (its first 15 ms against the 40 ms before it)
      // and the pitch it starts at (its first 35 ms). A kick is a burst; a bass note changing under
      // a held line barely jumps, and starts on its note.
      slow.getFloatTimeDomainData(this.slowTime);
      const strike = this.lowStrike = lowStrike(this.slowTime, sr, this.lp, this.dec, t - p.t + 0.014);
      const fix = this.kickFix;
      if (span >= 0.04) {
        const ago = t - p.t + 0.014; // where the hit is in the analyser's samples (it's heard ~14 ms late)
        const out = lowSlice(this.slowTime, sr, this.lp, this.dec, ago, ago - span);
        const half = out.length >> 1, fs = sr / this.dec;
        const a = lowPitch(out.slice(0, half), fs), b = lowPitch(out.slice(half), fs);
        this.lowRead = { a, b };
        const steady = a.f > 0 && b.f > 0 && a.r > 0.7 && b.r > 0.7 && Math.abs(b.f / a.f - 1) < 0.08;
        if (steady && b.rms > 0.6 * a.rms) {
          this.bassHit(p.t, p.s, b.f);
          return;
        }
        if (b.rms >= 0.9 * a.rms) {
          // (no pitch rather than an overtone; and not the bass's own onset for the tempo: see below)
          this.bassHit(p.t, p.s, b.r >= 0.7 ? b.f : a.r >= 0.7 ? a.f : 0, false);
          // A kick on a note: a kick too (its note is placed already: none to look for under it).
          // A note alone still counts for the timing (the tempo, the beat's place, the period) as
          // the kick it was taken for until now: those read low-end hits there, and without them a
          // dubstep remix at 140 went to 105 in its breakdown in 2 takes of 3. It isn't a kick in the
          // kick's pattern, the bar lines or a drop. In half-time, a held sound on the kick's beat
          // is the kick on its sub, punch or not (dubstep's kick sweeps down into the sub and holds
          // with it), and one on the snare's beat isn't a kick, punch or not (the punch is the
          // snare's body, with the bass coming back in under it).
          const role = this.halfRole(p.t);
          // On a beat, a held low end is the kick under the note (see kickFix.placeHeld), not only
          // when it also punches. Off the beat it stays a note: the kick line isn't filled with the
          // bass's own rhythm.
          const at = this.placeAt(p.t);
          const quartersOn = [0, 4, 8, 12].filter((s) => this.v.bd.on[s]).length;
          const onBeat = !!(fix && fix.placeHeld && at && Math.abs(at.off) <= 0.38 && at.step % 4 === 0 && (this.v.bd.on[at.step] || quartersOn >= 2));
          if (role === 'kick' || (role !== 'snare' && (p.punch || onBeat))) this.onset('bd', p.t, p.s);
          else this.onsets.push({ t: p.t, id: 'bd', s: p.s });
          return;
        }
      }
      // (in half-time, the snare's beat has no kick: that's its body; and a soft sound that barely
      // jumped and starts low, off the kick's own steps, is a bass note changing, not a kick: a note,
      // and the kick it was taken for still counts for the timing, as a held note does. On a step the
      // kick's line already has, it's the kick, however soft: a house kick under a held bass barely
      // jumps either, Calling For You's on its third beat)
      const at = this.placeAt(p.t), onLine = !!at && Math.abs(at.off) <= 0.38 && this.v.bd.on[at.step];
      if (this.halfRole(p.t) === 'snare') this.onsets.push({ t: p.t, id: 'bd', s: p.s });
      else if (fix && !onLine && strike.jump < fix.demoteJump && p.s < fix.demoteS && strike.f0 > 0 && strike.f0 < fix.demoteF) {
        this.bassHit(p.t, p.s, strike.f0, false);
        this.onsets.push({ t: p.t, id: 'bd', s: p.s });
        return;
      } else this.onset('bd', p.t, p.s);
      // what the low end was doing just before this kick (130-30 ms before), for bassUnderKick
      const ago = t - p.t + 0.014;
      slow.getFloatTimeDomainData(this.slowTime);
      this.bassCheck = { t: p.t, s: p.s, before: lowPitch(lowSlice(this.slowTime, sr, this.lp, this.dec, ago + 0.13, ago + 0.03), sr / this.dec) };
    },

    // A bass note can start right under a kick, and its attack is lost in the kick's. So, a little
    // after each kick: is a note sounding now (90-170 ms after the kick, once the kick's thump has
    // gone), at a different pitch from just before the kick? Then one started with the kick. If a
    // note was sounding before, the new one has to be about as loud: a kick's low tail can ring
    // at a steady pitch for a moment, but by then it's much quieter than the bass. (The same note
    // again under a kick can't be told from the kick; that's missed.)
    bassUnderKick(t) {
      const p = this.bassCheck;
      this.bassCheck = null;
      slow.getFloatTimeDomainData(this.slowTime);
      const ago = t - p.t + 0.014, before = p.before;
      const after = lowPitch(lowSlice(this.slowTime, sr, this.lp, this.dec, ago - 0.09, ago - 0.17), sr / this.dec);
      if (!(after.f > 0 && after.r > 0.85)) return; // nothing holding a pitch: it was just the kick
      if (before.f > 0 && before.r > 0.85) {
        if (Math.abs(Math.log2(after.f / before.f)) < 0.04) return; // the same note ringing on
        if (after.rms < 0.6 * before.rms) return; // a kick's tail, quieter than the bass it followed
      }
      this.bassHit(p.t, p.s * 0.8, after.f, false);
    },

    // The bass line note by note, for the code's bassline (harmonyBar sums it up a bar at a time):
    // every frame, the low end's pitch over the last 88 ms (bassYin, its first 50 ms against the
    // rest). A note counts once it has held 4 readings running (60 ms: a kick's thump, a pluck's
    // attack and a slide between notes don't), each reading in the beat it fell in. Notes are named
    // in the recording's own tuning: one whose instruments sit 40 cents sharp read half its notes a
    // semitone up (Ramalama). Against the bass lines tracked from the files (18 test songs, a minute
    // each from 0:40: YIN every 10 ms, held notes, the tuning found), on the 16ths with a bass note:
    // the bar's one note as the note analysis heard it was right 52% of the time; this tracker's
    // notes by the beat (harmonyBar), 83% (16 of the 18 songs better); the best any one note a bar
    // could do is 72%.
    bassTrack(t) {
      const B = this.bt, T = this.tempo;
      slow.getFloatTimeDomainData(this.slowTime);
      const fs = sr / this.dec, w = Math.round(0.05 * fs);
      const x = lowSlice(this.slowTime, sr, this.lp, this.dec, 0.088, 0);
      const { f, rms } = bassYin(x, w, fs, B.d);
      B.ref = Math.max(rms, B.ref * 0.998);
      let m = -1;
      if (f > 0 && rms >= 0.12 * B.ref) {
        const mf = 69 + 12 * Math.log2(f / 440), off = mf - Math.round(mf);
        B.c = B.c * 0.995 + Math.cos(2 * Math.PI * off);
        B.s = B.s * 0.995 + Math.sin(2 * Math.PI * off);
        m = Math.round(mf - Math.atan2(B.s, B.c) / (2 * Math.PI));
      }
      if (!T.locked) { B.run.m = -2; return; }
      // (the reading is of its first 50 ms, which are centred ~63 ms back; on the hits' clock, which
      // hears everything ~14 ms late, that's here)
      const at = t - (x.length - w / 2) / fs + 0.014, bt = this.beatOf(at);
      const bar = B.bars.get(bt.bar) || { n: new Uint16Array(4), notes: [new Map(), new Map(), new Map(), new Map()] };
      B.bars.set(bt.bar, bar);
      bar.n[bt.beat]++;
      const run = B.run;
      if (m !== run.m) { run.m = m; run.n = 0; run.at.length = 0; }
      run.n++;
      if (m < 0) return;
      if (run.n < 4) { run.at.push(at); return; }
      if (run.n === 4) for (const a of run.at) this.bassCount(a, m);
      this.bassCount(at, m);
    },
    bassCount(at, m) {
      const bt = this.beatOf(at), bar = this.bt.bars.get(bt.bar);
      if (!bar) return;
      const notes = bar.notes[bt.beat];
      notes.set(m, (notes.get(m) || 0) + 1);
    },
    // Where time t falls on the grid by the beat: its bar and beat (0-3). (While locked.)
    beatOf(t) {
      const T = this.tempo, b = Math.floor(T.n0 + (t - T.t0) / T.P - T.down), bar = Math.floor(b / 4);
      return { bar, beat: b - 4 * bar };
    },

    // A bass note starting at t: its step goes in the bass line's rhythm, and (unless it came with
    // a kick, which is already counted) it helps find the tempo.
    bassHit(t, s, f0, forTempo = true) {
      if (forTempo) this.onsets.push({ t, id: 'bass', s });
      this.lastBassHit = { t, f0 };
      this.place('bass', t, s);
    },

    onset(id, t, s) {
      this.onsets.push({ t, id, s }); // (the last 20 seconds are kept: frame() trims them)
      if (id === 'bd') {
        this.pumpKicks.push(t);
        // A drop: the kick comes back hard after 3+ seconds away while the music kept playing.
        if (this.lastKick > 0 && t - this.lastKick > 3 && this.lastSilentAt < this.lastKick && s >= 0.8 && t - this.lastDrop > 12) {
          this.lastDrop = t;
          this.on.drop();
        }
        this.lastKick = t;
      }
      const p = this.placeAt(t);
      if (p && Math.abs(p.beatF - Math.round(p.beatF)) < 0.15) {
        const i = ((Math.round(p.beatF) % 4) + 4) % 4;
        (id === 'bd' ? this.kickB : this.snareB)[i] += s;
      }
      this.place(id, t, s);
    },

    // Hi-hats: decide closed or open by how long each one rings, then place it.
    hhOnset(t, s) {
      if (this.hhPending) this.hhFinish(this.hhPending, t - this.hhPending.t);
      this.onsets.push({ t, id: 'hh', s });
      // A hat on top of a clap can't be timed: the clap's tail rings on. Call those closed.
      this.hhPending = { t, s, peak: this.hhE, masked: t - this.det.sd.last < 0.03 };
      const p = this.placeAt(t);
      this.hhHit = { t, step: p && Math.abs(p.off) <= 0.38 ? p.step : -1 };
    },
    hhTrack(t) {
      // The hat band's background level: follows the quietest moments, creeping up slowly.
      this.hhFloor = Math.min(this.hhE, (this.hhFloor || this.hhE) * 1.01);
      const p = this.hhPending;
      if (!p) return;
      const age = t - p.t;
      if (age < 0.03) { p.peak = Math.max(p.peak, this.hhE); return; }
      // How far it has died away ~60 ms in: a closed hat is 12+ dB down by then, an open one has
      // barely started. (More telling than when it rings out: a held note can hide that.)
      if (p.drop === undefined && age >= 0.06) p.drop = 10 * Math.log10(p.peak / Math.max(1e-20, this.hhE));
      // Rung out: 30 dB down, or back near the background, whichever comes first.
      if (this.hhE < Math.max(p.peak * 0.001, this.hhFloor * 2) || age > 0.4) this.hhFinish(p, age);
    },
    hhFinish(p, ring) {
      this.hhPending = null;
      if (p.masked) { this.place('hhc', p.t, p.s); return; }
      const xs = this.hhDurs;
      xs.push(Math.log(Math.max(0.005, ring)));
      if (xs.length > 40) xs.shift();
      // Closed or open: cut off within 60 ms, or how fast it died away, settles most. For the rest,
      // split this song's ring times into two groups (closed and open) when there clearly are two.
      if (ring < 0.06 || p.drop >= 12 || p.drop <= 6) {
        this.place(ring >= 0.06 && p.drop <= 6 ? 'hho' : 'hhc', p.t, p.s);
        return;
      }
      let open = false;
      if (xs.length >= 8) {
        let a = Math.min(...xs), b = Math.max(...xs);
        if (b - a > Math.log(2)) {
          for (let it = 0; it < 6; it++) {
            let sa = 0, na = 0, sb = 0, nb = 0;
            for (const x of xs) { if (Math.abs(x - a) <= Math.abs(x - b)) { sa += x; na++; } else { sb += x; nb++; } }
            if (na) a = sa / na;
            if (nb) b = sb / nb;
          }
          open = b - a > Math.log(1.8) && Math.log(Math.max(0.005, ring)) > (a + b) / 2;
        }
      }
      this.place(open ? 'hho' : 'hhc', p.t, p.s);
    },

    // Lead / vocal line: new notes in the 300-2000 Hz range. Only sharp tonal peaks count, and
    // only how much they rose since the last frame, so drums and held chords barely register.
    // The "slice" written in the code is the new note's pitch class.
    lead(t) {
      mid.getFloatFrequencyData(this.midDb);
      this.bassBright(t, this.midDb);
      const db = this.midDb, prev = this.prevMidMag, [a, b] = this.leadBand;
      let flux = 0, best = 0, bestK = -1;
      // The bass note playing right now (this analysis is quick enough to catch a new one at
      // once): the strongest peak between 35 and 250 Hz.
      let lowK = -1;
      for (let k = Math.ceil(35 / hzMid); k <= Math.floor(250 / hzMid); k++) {
        if (db[k] > -70 && db[k] > db[k - 1] && db[k] >= db[k + 1] && (lowK < 0 || db[k] > db[lowK])) lowK = k;
      }
      const fNow = lowK > 0 ? (lowK + (() => { const p = db[lowK - 1], q = db[lowK + 1], d = p - 2 * db[lowK] + q; return d < 0 ? (0.5 * (p - q)) / d : 0; })()) * hzMid : 0;
      const overtone = (f, f0) => { if (!(f0 > 0)) return false; const n = f / f0; return Math.abs(n - Math.round(n)) < 0.04 * Math.max(1, Math.round(n) / 4); };
      for (let k = a; k <= b; k++) {
        const v = db[k];
        if (v < -90 || !(v > db[k - 1] && v >= db[k + 1]) || v - Math.max(db[k - 3], db[k + 3]) < 6) continue;
        // skip the bass note's own overtones; a new bass note is not a new melody note
        if (overtone(k * hzMid, this.bassF0) || overtone(k * hzMid, fNow)) continue;
        const before = Math.max(prev[k - 1], prev[k], prev[k + 1]);
        const rise = Math.log1p(1000 * 10 ** (v / 20)) - Math.log1p(1000 * before);
        if (rise > 0) {
          flux += rise;
          if (rise > best) { best = rise; bestK = k; }
        }
      }
      // A chord brings in several new notes at once; a melody note brings in one (and its
      // overtones). Count the strong newcomers that aren't overtones of the strongest.
      let others = 0;
      if (bestK > 0) {
        const fBest = bestK * hzMid;
        for (let k = a; k <= b; k++) {
          const v = db[k];
          if (k === bestK || v < -90 || !(v > db[k - 1] && v >= db[k + 1]) || v - Math.max(db[k - 3], db[k + 3]) < 6) continue;
          if (overtone(k * hzMid, this.bassF0) || overtone(k * hzMid, fNow) || overtone(k * hzMid, fBest) || overtone(fBest, k * hzMid)) continue;
          const before = Math.max(prev[k - 1], prev[k], prev[k + 1]);
          if (Math.log1p(1000 * 10 ** (v / 20)) - Math.log1p(1000 * before) > 0.5 * best) others++;
        }
      }
      for (let k = a - 1; k <= b + 1; k++) prev[k] = db[k] > -160 ? 10 ** (db[k] / 20) : 0;
      // A clap's noise can poke through as peaks for a moment; skip just after one.
      const nearClap = t - this.det.sd.last < 0.05;
      const hit = detectOnset(this.det.lead, flux, t, !nearClap && others < 2);
      if (!hit || bestK < 1) return;
      const p = db[bestK - 1], q = db[bestK + 1], v = db[bestK], den = p - 2 * v + q;
      const f = (bestK + (den < 0 ? (0.5 * (p - q)) / den : 0)) * hzMid;
      // This analysis hears ~85 ms at a time, so it notices a note ~40 ms after it starts.
      this.place('vox', t - 0.04, hit, String((((Math.round(69 + 12 * Math.log2(f / 440)) % 12) + 12) % 12)));
    },

    pitch(t) {
      slow.getFloatFrequencyData(this.slowDb);
      const db = this.slowDb, c = this.frameChroma, b = this.frameBass;
      c.fill(0);
      b.fill(0);

      const bm = this.bassMap;
      let loud = 0;
      for (let i = 0; i < bm.idx.length; i++) {
        const d = db[bm.idx[i]];
        if (d <= -110) continue;
        const m = bm.w[i] * 10 ** (d / 20);
        b[bm.pc[i]] += m;
        loud = Math.max(loud, 10 ** (d / 20));
      }
      // The bass note now: the lowest strong peak (a peak in the spectrum within 6 dB of the
      // loudest between 35 and 220 Hz), not the loudest. A riddim's or dubstep's growl is louder
      // than its sub: the loudest named the growl's partials as the bass (g3 and ab3 in a line of
      // c#1 and f1, on a riddim track); the lowest strong one is the note's own. Most bass lines
      // are loudest at their lowest anyway, and don't change.
      let lowI = -1;
      for (let i = 0; i < bm.idx.length && lowI < 0; i++) {
        const k = bm.idx[i], d = db[k];
        if (d > -110 && d >= db[k - 1] && d >= db[k + 1] && 10 ** (d / 20) >= 0.5 * loud) lowI = i;
      }
      const peakMidi = lowI >= 0 ? bm.midi[lowI] : 0;

      // Notes come from tonal peaks only (like Essentia's HPCP): a bin counts if it is a local
      // maximum standing 8 dB above its neighbourhood. Drums and noise rarely do.
      const o = chromaLo - 8, pre = this.prefix;
      pre[0] = 0;
      for (let k = o; k <= chromaHi + 8; k++) pre[k - o + 1] = pre[k - o] + Math.max(-140, db[k]);
      for (let k = chromaLo; k <= chromaHi; k++) {
        const v = db[k];
        if (v < -100 || !(v > db[k - 1] && v >= db[k + 1])) continue;
        const localMean = (pre[k + 8 - o + 1] - pre[k - 8 - o]) / 17;
        if (v - localMean < 8) continue;
        const p = db[k - 1], q = db[k + 1], den = p - 2 * v + q;
        const f = (k + (den < 0 ? (0.5 * (p - q)) / den : 0)) * hzSlow;
        const m = 69 + 12 * Math.log2(f / 440), r = Math.round(m);
        c[((r % 12) + 12) % 12] += Math.cos(Math.PI * (m - r)) ** 2 * 10 ** (v / 20);
      }
      // This analysis hears ~0.34 s at a time, so readings right at a bar line still hear the
      // bar next door; they count for less in this bar's chord and bass note.
      let edge = 1;
      const T = this.tempo;
      if (T.locked) {
        const hBarF = (T.n0 + (t - T.t0 - this.lag) / T.P - T.down) / 4, f = hBarF - Math.floor(hBarF), half = this.lag / (4 * T.P);
        if (f < half || f > 1 - half) edge = 0.25;
      }
      let mx = 0;
      for (const x of c) mx = Math.max(mx, x);
      if (mx > 1e-7) {
        for (let i = 0; i < 12; i++) {
          c[i] /= mx;
          this.barChroma[i] += edge * c[i];
          this.stepChroma[i] += c[i];
          this.beatChroma[i] += c[i];
        }
        this.stepN++;
      }

      // Count a frame toward the bass line only when the low end is actually playing.
      let bx = 0;
      for (const x of b) bx = Math.max(bx, x);
      this.barFrames++;
      this.bassF0 = 0;
      if (bx > 1e-7 && bx > 0.15 * mx) {
        const w = (t - this.lastKick < 0.15 ? 0.25 : 1) * edge; // the kick smears into the bass range
        for (let i = 0; i < 12; i++) {
          this.barBass[i] += (w * b[i]) / bx;
          this.beatBass[i] += (w * b[i]) / bx;
        }
        // (and the lowest strong peak's note a full vote more: see above)
        if (lowI >= 0) { this.barBass[bm.pc[lowI]] += w; this.beatBass[bm.pc[lowI]] += w; }
        this.bassMidi[peakMidi] += w;
        this.bassFrames++;
        this.bassF0 = 440 * 2 ** ((peakMidi - 69) / 12);
      }
      if (mx > 1e-7) this.listenOpening(t, c, b);

      // Brightness of the bass and the chords, for the .lpf() numbers; hat level for .gain().
      const centroid = (lo, hi) => {
        let num = 0, den = 0;
        for (let k = Math.ceil(lo / hzSlow); k <= Math.floor(hi / hzSlow); k++) {
          const m = 10 ** (db[k] / 20);
          num += m * k * hzSlow; den += m;
        }
        return den > 0 ? num / den : 0;
      };
      this.knobAcc.bass += centroid(40, 800);
      this.knobAcc.chords += centroid(200, 6000);
      this.knobAcc.hh += this.hhE;
      this.knobAcc.n++;
    },

    clock(t) {
      const T = this.tempo;
      // (before the beats are counted: halving starts their count over)
      if (this.halveFor !== null) { const x = this.halveFor; this.halveFor = null; if (T.locked && T.half === x) this.halve(t, x); }
      if (!T.locked) {
        if (t - this.lastCol > 0.125) { this.lastCol = t; this.pushCol(); }
        return;
      }
      const beatF = T.n0 + (t - T.t0) / T.P, beat = Math.floor(beatF);
      if (this.ringBeat !== null && beatF >= this.ringBeat + 0.4 + 0.1 / T.P) { this.snareRing(this.ringBeat); this.ringBeat = null; }
      if (this.beat !== null && beat > this.beat) { this.newBeat(beat); this.ringBeat = beat; }
      const barF = (beatF - T.down) / 4;
      const bar = Math.floor(barF), step = Math.floor((barF - bar) * 16);
      if (this.bar !== null && bar > this.bar) { this.newBar(this.bar); this.tapeBar(t, bar); }
      if (this.bar === null || bar >= this.bar) { this.bar = bar; this.step = step; this.barF = barF; }
      if (this.beat === null || beat > this.beat) this.beat = beat;

      // Harmony keeps its own clock, running this.lag behind the drums.
      const hbF = beatF - this.lag / T.P;
      const hBarF = (hbF - T.down) / 4;
      const hBar = Math.floor(hBarF), hStep = Math.floor((hBarF - hBar) * 16), hBeat = Math.floor(hbF);
      if (this.hStep !== null && (hStep !== this.hStep || hBar !== this.hBar)) this.pushCol();
      if (this.hBeat !== null && hBeat > this.hBeat) this.harmonyBeat(hBeat);
      if (this.hBar !== null && hBar > this.hBar) this.harmonyBar(this.hBar);
      if (this.hBar === null || hBar >= this.hBar) { this.hBar = hBar; this.hStep = hStep; }
      if (this.hBeat === null || hBeat > this.hBeat) this.hBeat = hBeat;
    },

    pushCol() {
      const col = new Float32Array(12);
      // Stretch each column between its quietest and loudest note so chord notes stand out.
      const lo = Math.min(...this.stepChroma), hi = Math.max(...this.stepChroma);
      if (this.stepN && hi > lo) for (let i = 0; i < 12; i++) col[i] = (this.stepChroma[i] - lo) / (hi - lo);
      this.rollCols.push(col);
      if (this.rollCols.length > ROLL_COLS) this.rollCols.shift();
      this.stepChroma.fill(0);
      this.stepN = 0;
      this.rollDirty = true;
    },

    // Chords tend to change on the first beat of a bar. That settles cases the drums can't:
    // a kick on every beat with claps on 2 and 4 looks the same shifted by half a bar.
    // The bass note changing counts most: melodies change notes inside bars, bass lines rarely do.
    harmonyBeat(hBeat) {
      const change = (cur, prev) => {
        const a = Math.hypot(...cur), b = prev ? Math.hypot(...prev) : 0;
        if (!a || !b) return null;
        let dot = 0;
        for (let i = 0; i < 12; i++) dot += cur[i] * prev[i];
        return 1 - dot / (a * b);
      };
      const chroma = change(this.beatChroma, this.prevBeatChroma);
      const bass = change(this.beatBass, this.prevBeatBass);
      const total = bass === null ? chroma : chroma === null ? bass : 0.75 * bass + 0.25 * chroma;
      // These cover beat hBeat-1 and the one before, so a change here began at beat hBeat-1.
      if (total !== null) this.changeB[(((hBeat - 1) % 4) + 4) % 4] += total;
      this.prevBeatChroma = Math.hypot(...this.beatChroma) ? this.beatChroma.slice() : null;
      this.prevBeatBass = Math.hypot(...this.beatBass) ? this.beatBass.slice() : null;
      this.beatChroma.fill(0);
      this.beatBass.fill(0);
    },

    newBeat() {
      for (let i = 0; i < 4; i++) { this.kickB[i] *= 0.97; this.snareB[i] *= 0.97; this.changeB[i] *= 0.97; }
      const K = this.kickB, S = this.snareB, H = this.changeB, T = this.tempo;
      this.halfTime();
      let best = T.half === null ? 0 : (T.half + 2) % 4, bestScore = -Infinity;
      for (let d = 0; d < 4 && T.half === null; d++) {
        // (a halved tempo knows its backbeat: the bar can start on either kick, never on the snare)
        if (T.halved && (d - T.down) % 2) continue;
        const score = K[d] + 0.5 * K[(d + 2) % 4] + S[(d + 1) % 4] + S[(d + 3) % 4] - 0.5 * (S[d] + S[(d + 2) % 4]) + 3 * H[d];
        if (score > bestScore + 1e-6) { bestScore = score; best = d; }
      }
      if (best === T.down) { T.downN = 0; return; }
      if (best === T.downCand) T.downN++;
      else { T.downCand = best; T.downN = 1; }
      if (T.downN >= 8) {
        // Bar lines moved.
        this.relabel(4 * (best - T.down));
        T.down = best;
        T.downN = 0;
      }
    },

    // The snare at beat b: of the 2-14 kHz bursts starting within 0.4 of a beat of b (a rise of
    // 6 dB on the 15-30 ms before), the one ringing loudest over 60 ms (its ring), and how well it
    // holds: its loudness 30-90 ms in against its first 30 ms (a snare's or a clap's noise rings on;
    // a kick's click, however loud, dies away at once). Looked for that widely so a beat placed a
    // 16th off, as on a drop full of 16th-note growls, still finds the snare on its own beat. Kept
    // per beat of 4 as the medians of the last 8 readings.
    snareRing(b) {
      const T = this.tempo, at = T.t0 + (b - T.n0) * T.P, w = 0.4 * T.P, ts = this.ringT, vs = this.ringV;
      const ringAt = (i) => {
        let e = 0, n = 0;
        for (let j = i; j < ts.length && ts[j] < ts[i] + 0.06; j++) { e += 10 ** (vs[j] / 10); n++; }
        return 10 * Math.log10(e / n);
      };
      let on = -1, ring = -Infinity;
      for (let i = 2; i < ts.length; i++) {
        if (ts[i] < at - w || ts[i] > at + w || vs[i] - Math.min(vs[i - 1], vs[i - 2]) < 6) continue;
        const r = ringAt(i);
        if (r > ring) { ring = r; on = i; }
      }
      if (on < 0) return;
      // how well it holds: its loudness 30-90 ms in against its first 30 ms
      const span = (a, z) => {
        let e = 0, n = 0;
        for (let j = on; j < ts.length && ts[j] < ts[on] + z; j++) if (ts[j] >= ts[on] + a) { e += 10 ** (vs[j] / 10); n++; }
        return n ? 10 * Math.log10(e / n) : null;
      };
      const head = span(0, 0.03), tail = span(0.03, 0.09);
      if (head === null || tail === null) return;
      // (the medians of the last 8: one odd hit, a crash, doesn't count, and a drop coming in takes
      // over in 5 bars where a slow average took 20 to forget a quiet intro)
      const k = ((b % 4) + 4) % 4, median = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
      if (!this.ringN[k]) { this.ringH[k].length = 0; this.holdH[k].length = 0; }
      this.ringH[k].push(ring);
      this.holdH[k].push(tail - head);
      if (this.ringH[k].length > 8) { this.ringH[k].shift(); this.holdH[k].shift(); }
      this.ringB[k] = median(this.ringH[k]);
      this.holdB[k] = median(this.holdH[k]);
      this.ringN[k]++;
      // In half-time this is the snare on beat 3: the clap there, if the clap detector placed none
      // (a dubstep snare's distorted body can read as the bass, the hats or nothing). Only one
      // ringing as it usually does, within 3 dB: not a fill's or a breakdown's quieter one.
      if (T.half === k && ring >= this.ringB[k] - 3 && !(this.v.sd.last > ts[on] - 0.1 * T.P)) this.place('sd', ts[on], 1);
    },

    // Half-time (dubstep, trap): the snare on beat 3 alone, the kick on 1. Its claps don't fall
    // between the kicks, so the bar line a 4/4 song's claps give lands a beat off. Told by the
    // snare (snareRing, the last 8 bars), once each beat of 4 has been heard 8 times, with the
    // drums going full tilt (the snare within 4.5 dB of the loudest it has rung, which fades 1 dB in
    // 32 beats; a
    // breakdown's lone sound on one beat isn't a snare):
    // - one beat ringing out 3 dB over each of the others (2 once the song has shown it's
    //   half-time: the beats can be counted afresh, or slip, and the snare turn up on another),
    // - and holding on 1.5 dB better than the beat two from it, which in half-time is the kick's
    //   click (a 4/4 song's other clap holds on as well, though one clap can ring out over the
    //   other by 5 dB),
    // - with that beat, the kick's, not the emptiest of the four (it has its kick: a 4/4 song's
    //   bridge with two beats gone quiet isn't half-time),
    // for 4 beats running. Then the bar starts two beats from the snare. That holds through 32 beats
    // against it (another beat ringing out, or it standing out by under 0.5 dB, or holding on by
    // under 0.75): a drop's fill or a quieter stretch doesn't throw it. (Measured on 3 dubstep
    // songs and 4 others, live in the app and replayed from the sound.)
    halfTime() {
      const R = this.ringB, H = this.holdB, T = this.tempo;
      if (Math.min(...this.ringN) < 8) { T.half = null; T.halfN = T.halfOff = 0; return; }
      let x = 0;
      for (let i = 1; i < 4; i++) if (R[i] > R[x]) x = i;
      const gap = R[x] - Math.max(R[(x + 1) % 4], R[(x + 2) % 4], R[(x + 3) % 4]);
      const holds = H[x] - H[(x + 2) % 4];
      T.ringTop = Math.max(R[x], T.ringTop - 0.03);
      if (T.half !== null) {
        T.halfOff = x !== T.half || gap < 0.5 || holds < 0.75 ? T.halfOff + 1 : 0;
        if (T.halfOff >= 32) { T.half = null; T.halfOff = 0; }
      }
      if (T.half === null) {
        const clear = gap >= (T.halfSeen ? 2 : 3) && holds >= 1.5 && R[x] >= T.ringTop - 4.5 && R[(x + 2) % 4] >= Math.min(R[(x + 1) % 4], R[(x + 3) % 4]);
        T.halfN = clear ? (x === T.halfCand ? T.halfN + 1 : 1) : 0;
        T.halfCand = x;
        if (T.halfN >= 4) { T.half = x; T.halfSeen = true; if (T.bpm >= 150) this.halveFor = x; }
      }
    },

    // A slow song counted at double its tempo looks like half-time from here: its backbeat, on 2
    // and 4, lands on 3 of each double-speed bar (Eyes Without a Face, its 85 bpm read as 171, the
    // worlds cutting twice a bar; Oct 18). Half-time music proper runs its hats at the fast tempo
    // (8ths and 16ths: two to four a beat), a slow song at its own (its 16ths read as 8ths: Eyes
    // Without a Face 1.6 to 2.1 a beat at 171). So past 150 bpm, with fewer than two and a half hats
    // a beat over the last 8 seconds, the tempo is halved: the beats are every other one, the
    // kick's and the snare's (two apart, now one), and the bar starts on a kick.
    halve(t, x) {
      const T = this.tempo;
      let hats = 0;
      for (const o of this.onsets) if (o.id === 'hh' && o.t > t - 8) hats++;
      if (hats / ((8 * T.bpm) / 60) >= 2.5) return;
      // the latest of the kick's beats, which the new count runs from
      let b = Math.floor(T.n0 + (t - T.t0) / T.P);
      while ((((b - x - 2) % 4) + 4) % 4) b--;
      const at = T.t0 + (b - T.n0) * T.P, bpm = T.bpm / 2;
      this.lockTo(t, bpm, `tempo halved ${T.bpm.toFixed(1)} -> ${bpm.toFixed(1)} (a backbeat counted at double speed)`);
      T.t0 = at;
      T.n0 = 0;
      T.down = 0;
      T.halved = true;
    },

    // While the song is read as half-time: is t on the snare's beat ('snare') or the kick's, two
    // from it ('kick'), within 0.15 of a beat? Else null.
    halfRole(t) {
      const T = this.tempo;
      if (!T.locked || T.half === null) return null;
      const f = T.n0 + (t - T.t0) / T.P, b = Math.round(f);
      if (Math.abs(f - b) > 0.15) return null;
      const k = ((b % 4) + 4) % 4;
      return k === T.half ? 'snare' : k === (T.half + 2) % 4 ? 'kick' : null;
    },

    // The step numbers moved back by `shift` (new bar lines, or the beat found on another 16th).
    // Turn what's been learned with them so the patterns stay put, and let the blocks know.
    relabel(shift) {
      for (const id of PARTS) {
        const v = this.v[id], g = v.grid.slice(), on = v.on.slice(), tok = v.tok.slice(), shown = v.shown?.slice(), long = v.long.slice();
        for (let s = 0; s < 16; s++) {
          const to = (((s - shift) % 16) + 16) % 16;
          v.grid[to] = g[s];
          v.on[to] = on[s];
          v.tok[to] = tok[s];
          v.long[to] = long[s];
          if (shown) v.shown[to] = shown[s];
        }
        v.sig = v.on.join();
        v.hitBar.fill(-999);
      }
      // (the bass line by the beat starts over: its beats aren't the same beats now)
      this.bt.bars.clear();
      this.bassBeats.fill(null);
      this.tempo.renumber -= shift;
      this.resetClocks();
    },

    // The bar starting now, for exporting the song (tape.js): the patterns the code shows in it.
    tapeBar(t, bar) {
      if (!this.tape) return;
      const parts = {};
      for (const id of PARTS) {
        if (!this.present(id, t)) continue;
        const v = this.v[id];
        parts[id] = id === 'vox' ? { on: v.shown.slice(), tok: v.tok.slice() } : v.shown.slice();
      }
      this.tape.pattern(bar * 4 + this.tempo.down, parts);
    },

    // The bass's brightness now (its 150-2000 Hz against its 30-150 Hz, as a log), while there's
    // bass to speak of, and its deep sub (30-70 Hz) for the bar.
    bassBright(t, db) {
      const pow = (lo, hi) => { let e = 0; for (let k = Math.max(1, Math.round(lo / hzMid)); k < Math.round(hi / hzMid); k++) e += 10 ** (db[k] / 10); return e; };
      const sub = pow(30, 70), low = pow(30, 150), mids = pow(150, 2000);
      if (low < 1e-7) return;
      this.wobT.push(t);
      this.wobV.push(Math.log10((mids + 1e-12) / low));
      this.wobL.push(Math.log10(low));
      this.wobM.push(Math.log10(mids + 1e-12));
      while (this.wobT.length && this.wobT[0] < t - 6) { this.wobT.shift(); this.wobV.shift(); this.wobL.shift(); this.wobM.shift(); }
      this.subAcc.sub += sub;
      this.subAcc.all += low + mids;
    },

    // Once a bar: does the bass wobble? A filter swept on the beat's 8ths, triplets or 16ths
    // (dubstep's wobble, riddim's pulse) moves the bass's brightness at that rate, where a
    // four-on-the-floor song's moves with its kick, on the quarters. The strength of that
    // movement over the last 6 seconds at 1, 2, 3 and 4 a beat, against its typical strength from
    // 0.5 to 16 Hz: a wobble when the strongest of the 8ths, triplets and 16ths is 8 times typical
    // and 3 times the quarters' (measured on whole songs: riddim 69 at the 8ths against 9 at the
    // quarters, dubstep 20 against 5; two house songs 72 and 311 at the 8ths against 409 and 766).
    // And it must be the filter: the bass's mids swinging while its low end holds (the low end
    // moving at most half as much, at that rate), by a real amount (0.15 of a log10 each way):
    // drums in the bass's range and a bass line's own rhythm move the low end too (measured: on a
    // garage song and a 2-step one, 0.7 to 6.5 times as much, where a riddim's and a dubstep
    // remix's wobbles held it to 0.03 to 0.38). It comes or changes once two bars running agree, and goes once four do (a beat or two
    // without one mid-drop isn't the drop ending). And how much of the bass is deep sub.
    wobbleCheck() {
      const T = this.tempo, ts = this.wobT, vs = this.wobV, a = this.subAcc;
      if (a.all > 0) this.bassSound.sub = this.bassSound.sub * 0.7 + 0.3 * (a.sub / a.all);
      this.subAcc = { sub: 0, all: 0 };
      if (!T.locked || !(T.P > 0) || ts.length < 100 || ts[ts.length - 1] - ts[0] < 4) return;
      // (evenly spaced, 33 a second, each the reading at or before it)
      const dt = 1 / 33, n = Math.floor((ts[ts.length - 1] - ts[0]) / dt);
      const even = (src) => {
        const x = new Float32Array(n);
        let j = 0;
        for (let i = 0; i < n; i++) {
          const at = ts[0] + i * dt;
          while (j < ts.length - 1 && ts[j + 1] <= at) j++;
          x[i] = src[j];
        }
        return x;
      };
      const x = even(vs);
      const power = (y, f) => {
        let mean = 0, re = 0, im = 0;
        for (let i = 0; i < n; i++) mean += y[i] / n;
        for (let i = 0; i < n; i++) {
          const v = (y[i] - mean) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))), ph = 2 * Math.PI * f * i * dt;
          re += v * Math.cos(ph);
          im -= v * Math.sin(ph);
        }
        return re * re + im * im;
      };
      const strength = (f) => power(x, f);
      const all = [];
      for (let f = 0.5; f <= 16; f += 0.25) all.push(strength(f));
      all.sort((p, q) => p - q);
      const typical = all[all.length >> 1] || 1e-12, beat = 1 / T.P;
      const quarters = strength(beat) / typical, faster = [2, 3, 4].map((k) => strength(k * beat) / typical);
      let best = 0;
      for (let k = 1; k < 3; k++) if (faster[k] > faster[best]) best = k;
      const f = (best + 2) * beat, swing = (4 * Math.sqrt(strength(f))) / n;
      const wobbles = faster[best] >= 8 && faster[best] >= 3 * quarters && swing >= 0.15 && power(even(this.wobL), f) <= 0.25 * power(even(this.wobM), f);
      const rate = wobbles ? best + 2 : 0;
      const R = this.wobRun;
      if (rate === R.rate) R.n++;
      else { R.rate = rate; R.n = 1; }
      if (R.n >= (rate ? 2 : 4) && this.bassSound.wobble !== rate) {
        this.bassSound.wobble = rate;
        this.note(rate ? `wobble: the bass's filter sweeps on the ${{ 2: '8ths', 3: 'triplets', 4: '16ths' }[rate]}` : 'wobble stopped');
      }
    },

    newBar(ended) {
      // Patterns change only at bar lines, the way a live coder re-evaluates at the end of a cycle.
      // Separate on/off thresholds (hysteresis) stop steps flickering.
      for (const id of PARTS) {
        const v = this.v[id], g = v.grid;
        let mx = 0;
        for (const x of g) mx = Math.max(mx, x);
        for (let s = 0; s < 16; s++) {
          if (!v.on[s] && g[s] >= Math.max(v.onAt * mx, 0.5)) v.on[s] = true;
          else if (v.on[s] && g[s] < Math.max(v.offAt * mx, 0.3)) v.on[s] = false;
        }
        // A clap part is a few hits a bar: the backbeat, some ghost notes, a roll for a bar or two.
        // Two bars running of more than 6 is something else heard as claps (a tambourine, a
        // keyboard playing 8ths): no clap is shown (present) until it has been thinner for four
        // bars running (one thinner bar would bring it back, and the next hide it again). The same
        // for open hats, a few a bar too: more than 6 is closed hats heard as open (long, roomy
        // ones; on a recording of Oct 15, 15 of 16 steps for half of Hard Refresh).
        if (id === 'sd' || id === 'hho') {
          const busy = v.on.filter(Boolean).length > 6;
          v.busyN = busy ? v.busyN + 1 : 0;
          v.calmN = busy ? 0 : v.calmN + 1;
          if (v.busyN >= 2) v.tooBusy = true;
          else if (v.calmN >= 4) v.tooBusy = false;
        }
        // Show a pattern only once its rhythm has held steady, so early guesses don't flash by.
        // (For vox only the rhythm counts; its notes may change from bar to bar.) An empty
        // pattern never replaces a real one: a part that stops fades out via present() instead.
        const sig = v.on.join();
        v.sigN = sig === v.sig ? v.sigN + 1 : 0;
        v.sig = sig;
        if (v.sigN >= v.holdBars && v.on.some(Boolean)) { v.shown = v.on.slice(); v.approx = false; }
        // The closed hats, plainly playing (3 or more a bar for 4 bars, on 7 of the 8 eighths over
        // the last several bars) but never holding still long enough to be learned (distorted or
        // buried hats, caught about half the time, a different half each bar): the steady
        // subdivision is written instead of nothing, hh*8, or hh*16 when the 16ths between hold 30%
        // of them, as a live coder would. On whole songs from a recording (Oct 15) the hat line was
        // there 13% of the time in one, 0% in two; with this 77 to 87%, matching each bar's hats
        // (F1) 0.35 to 0.67; the songs whose hats were learned as before or a little more often.
        if (id === 'hhc') {
          let n = 0;
          for (let s = 0; s < 16; s++) { const hit = v.hitBar[s] === ended; n += hit; v.long[s] = v.long[s] * 0.85 + hit; }
          v.counts.push(n);
          if (v.counts.length > 4) v.counts.shift();
          const top = Math.max(...v.long), heard = v.counts.length === 4 && v.counts.reduce((a, b) => a + b, 0) >= 12;
          let eighths = 0, odd = 0, all = 0;
          for (let s = 0; s < 16; s++) { all += v.long[s]; if (s % 2) odd += v.long[s]; else if (v.long[s] >= 0.25 * top) eighths++; }
          // (or when the line learned shows under half the hats heard: one step that happened to
          // repeat, from hats caught a different half each bar)
          const thin = v.shown && !v.approx && v.shown.filter(Boolean).length < (0.5 * v.counts.reduce((a, b) => a + b, 0)) / Math.max(1, v.counts.length);
          if ((!v.shown || v.approx || thin) && heard && eighths >= 7) {
            v.shown = Array.from({ length: 16 }, (_, s) => odd >= 0.3 * all || s % 2 === 0);
            v.approx = true;
          }
        }
        for (let s = 0; s < 16; s++) g[s] *= 0.6;
      }
    },

    // A song's first chord is usually its home chord, which settles what the notes alone can't:
    // A minor or C major (the same notes). From where the music starts, a second of the note
    // analysis at a time (moved along half a second) until one gives a clear chord, for up to 30
    // seconds (an intro of drums alone). Only for a song heard from its start: Toaster switched
    // on halfway through a song would take whatever chord is playing for home. Found right on all
    // 16 test songs, two takes each (Oct 15). It also counts as a bar of the key's evidence, so
    // the key starts out right.
    listenOpening(t, c, b) {
      const o = this.opening;
      if (!o.armed || o.chord) return;
      // right after a reset the note analysis still hears what played before it (the last song,
      // in the test suite: it took reggaeton's G minor for G major)
      if (t - this.resetAt < 2 * this.lag + 0.02) return;
      if (o.from === null) o.from = o.halfAt = t;
      if (t - o.from > 30) { o.armed = false; return; }
      for (let i = 0; i < 12; i++) { o.half.c[i] += c[i]; o.half.b[i] += b[i]; }
      o.half.n++;
      if (t - o.halfAt < 0.5) return;
      // most of the second has to have notes in it (14 of its ~22 readings)
      if (o.prev && o.prev.n + o.half.n >= 14) {
        const sum = Array.from(o.half.c, (x, i) => x + o.prev.c[i]), bass = Array.from(o.half.b, (x, i) => x + o.prev.b[i]);
        let bassPc = -1, bmax = 0;
        for (let i = 0; i < 12; i++) if (bass[i] > bmax) { bmax = bass[i]; bassPc = i; }
        const chord = bestChord(sum, bassPc);
        if (chord && chord.score > 0.75) {
          o.chord = chord;
          o.key = { root: chord.root, mode: chord.q === 'm' ? 'minor' : 'major' };
          for (let i = 0; i < 12; i++) this.longChroma[i] += 0.1 * (chord.tones[i] + (i === chord.root ? 0.3 : 0));
          this.note(`first chord ${chord.name}`);
          return;
        }
      }
      o.prev = o.half;
      o.half = openingHalf();
      o.halfAt = t;
    },

    harmonyBar(prevBar) {
      this.wobbleCheck();
      let bassPc = -1, bmax = 0;
      const hasBass = this.bassFrames >= 0.25 * this.barFrames;
      if (hasBass) for (let i = 0; i < 12; i++) if (this.barBass[i] > bmax) { bmax = this.barBass[i]; bassPc = i; }
      const chord = bestChord(this.barChroma, bassPc);
      // Bass usually plays the chord's root; prefer it when the two are close.
      if (chord && bassPc >= 0 && chord.root !== bassPc && this.barBass[chord.root] >= 0.75 * bmax) bassPc = chord.root;
      // Octave: the lowest one carrying real weight for that note.
      let midi = -1, mw = 0;
      for (let m = 0; m < 128; m++) if (m % 12 === bassPc) mw = Math.max(mw, this.bassMidi[m]);
      for (let m = 0; m < 128 && midi < 0; m++) if (m % 12 === bassPc && mw > 0 && this.bassMidi[m] >= 0.25 * mw) midi = m;
      // The bass tracker's notes for the bar (bassTrack): each beat's commonest note, held through a
      // tenth of the beat's readings or more, and the bar's (the commonest over the whole bar, a tenth
      // of it). (A third, first tried, lost a staccato bass's notes between its stabs: Show Me Love's
      // organ, Gotye's pluck; 73% right where a tenth gets 83%, and anything from 2% to 10% the same.)
      // Where it has one, that's the bar's bass note (it's right more often than the one the note
      // analysis hears: see bassTrack); the chord and the key still go by the analysis's.
      const tb = this.bt.bars.get(prevBar);
      for (const k of this.bt.bars.keys()) if (k <= prevBar) this.bt.bars.delete(k);
      let beats = null, tracked = -1;
      if (tb) {
        const all = new Map();
        beats = tb.notes.map((notes, k) => {
          let best = -1, bn = 0;
          for (const [m, n] of notes) { all.set(m, (all.get(m) || 0) + n); if (n > bn) { bn = n; best = m; } }
          return best >= 0 && bn >= 0.1 * tb.n[k] ? best : null;
        });
        let bn = 0;
        for (const [m, n] of all) if (n > bn) { bn = n; tracked = m; }
        if (bn < 0.1 * (tb.n[0] + tb.n[1] + tb.n[2] + tb.n[3])) tracked = -1;
      }
      const bassM = tracked > 0 ? tracked : midi;
      // Keep a slot's last known value when that part sits a bar out, so the line comes back intact.
      const slot = ((prevBar % 4) + 4) % 4, old = this.slots[slot];
      if (chord || bassM > 0) {
        this.slots[slot] = {
          chord: chord || old?.chord || null,
          bass: bassM > 0 ? NOTES[bassM % 12].toLowerCase() + (Math.floor(bassM / 12) - 1) : old?.bass || null,
        };
      }
      if (beats?.some((m) => m !== null)) this.bassBeats[slot] = beats;
      else if (midi > 0) this.bassBeats[slot] = null; // (the slot's note alone, then)
      const t = nowSec();
      this.tape?.harmony(prevBar * 4 + this.tempo.down, chord, bassM > 0 ? bassM : null, this.bassSound.wobble, beats?.some((m) => m !== null) ? beats : null);
      if (bassM > 0) this.bassSeen = t;
      if (chord) {
        this.chordSeen = t;
        this.lastChord = chord;
        // The key comes from the chords and bass notes found so far, not raw spectra: each chord's
        // own three notes (not its overtones, which add notes the song doesn't have).
        for (let i = 0; i < 12; i++) this.longChroma[i] = this.longChroma[i] * 0.9 + 0.1 * (chord.tones[i] + (i === bassPc ? 0.3 : 0));
        const same = (a, b) => a && b && a.root === b.root && a.mode === b.mode;
        const relative = (a, b) => a && b && a.mode !== b.mode && (a.mode === 'major' ? (a.root + 9) % 12 === b.root : (b.root + 9) % 12 === a.root);
        const parallel = (a, b) => a && b && a.root === b.root && a.mode !== b.mode;
        // next door on the circle of fifths, one note apart (C major and G major, A minor and G
        // major): the major keys with the same notes a fifth apart
        const majorOf = (k) => (k.mode === 'major' ? k.root : (k.root + 3) % 12);
        const nextDoor = (a, b) => a && b && [5, 7].includes((majorOf(a) - majorOf(b) + 12) % 12);
        const fits = keyFits(this.longChroma);
        let k = bestKey(fits);
        // A minor or C major? The same notes, and the major key often fits a little better (on
        // the test songs in minor keys, by up to 0.2, once 0.34), so the song's first chord
        // settles it, unless the notes clearly say otherwise.
        const home = this.opening.key;
        if (relative(k, home)) {
          const h = fits.find((f) => same(f, home));
          if (k.score - h.score < 0.3) k = h;
        }
        // Change the displayed key only after the new one wins two bars running. After the first
        // eight bars, a relative or parallel key (A minor for C major, or C minor) needs eight: the
        // same notes, or the same home note with a different third, so which one wins is often a
        // close call, and the two would trade places. A key next door needs four (on a recording
        // the key went Bb major, D minor, Bb major, D minor in 25 seconds; real key changes, often
        // to a key next door, come a few bars later). Once a key has been shown for 16 bars it's
        // the song's, and a change takes twice as long (16, 12, and 8 bars for any other key): on
        // whole songs from a recording (Oct 15) the key still went A major, F# minor, A major, F#
        // minor in one; with this, half the changes, and the test songs' keys found as before.
        this.keyBars++;
        const settled = this.keyShown >= 16;
        const need = this.keyBars <= 8 ? 2 : relative(k, this.key) || parallel(k, this.key) ? (settled ? 16 : 8) : nextDoor(k, this.key) ? (settled ? 12 : 4) : settled ? 8 : 2;
        if (!this.key || same(k, this.key)) { this.key = k || this.key; this.keyCand = null; this.keyCandN = 0; }
        else if (same(k, this.keyCand)) {
          if (++this.keyCandN >= need) { this.key = k; this.keyCand = null; this.keyCandN = 0; this.keyShown = 0; }
        } else { this.keyCand = k; this.keyCandN = 1; }
        this.keyShown++;
      }
      this.updateKnobs();
      if (window.NC_DEBUG) {
        this.trace('bar', {
          bar: prevBar, slot, chord: chord?.name, score: chord && +chord.score.toFixed(3), bass: this.slots[slot]?.bass,
          on: Object.fromEntries(VOICES.map((id) => [id, this.v[id].on.map((x, s) => (x ? (id === 'vox' ? this.v[id].tok[s] ?? 'x' : 'x') : '.')).join('')])),
        });
      }
      this.barChroma.fill(0);
      this.barBass.fill(0);
      this.bassMidi.fill(0);
      this.barFrames = this.bassFrames = 0;
    },

    // Sidechain pumping, for .duck(): the chords and pads dipping under each kick and swelling
    // back, the way a compressor keyed off the kick does it (most house and EDM). Heard in the
    // 800-3000 Hz band (above the kick and most of the bass, below the hats): its level 40-150 ms
    // after a kick against 280-400 ms after, for kicks with no clap on them and nothing else
    // hitting before the band has come back (another kick, a clap). The middle of the last 24 such
    // dips: 3 dB or more and it pumps, under 1.5 dB and it's stopped. Measured on the test songs
    // (tools/checks.js): house with its pad pumping 8 dB reads about 5.2, without the pumping
    // about 1 (from 500 Hz up, the offbeat bass lifted that to 2.3). Also how deep, for
    // .duckdepth(): a tenth for every 0.8 dB, from .3 to .9, moving on a change of .2 or more.
    pumpCheck(t) {
      const K = this.pumpKicks;
      while (K.length && t - K[0] >= 0.42) {
        const k = K.shift();
        if (this.onsets.some((o) => (o.id === 'bd' || o.id === 'sd') && o.t > k + 0.02 && o.t < k + 0.42) || this.onsets.some((o) => o.id === 'sd' && Math.abs(o.t - k) < 0.03)) continue;
        let dip = 0, dn = 0, back = 0, bn = 0;
        for (let i = 0; i < this.bodyT.length; i++) {
          const d = this.bodyT[i] - k;
          if (d >= 0.04 && d <= 0.15) { dip += this.bodyV[i]; dn++; }
          else if (d >= 0.28 && d <= 0.4) { back += this.bodyV[i]; bn++; }
        }
        if (dn < 3 || bn < 3) continue;
        this.pumpDips.push(back / bn - dip / dn);
        if (this.pumpDips.length > 24) this.pumpDips.shift();
        if (this.pumpDips.length < 12) continue;
        this.pump = this.pumpDips.slice().sort((a, b) => a - b)[this.pumpDips.length >> 1];
        const depth = clamp(Math.round(this.pump / 0.8) / 10, 0.3, 0.9);
        if (!this.ducking && this.pump >= 3) { this.ducking = true; this.duckDepth = depth; this.note(`pumping: the chords dip ${this.pump.toFixed(1)} dB under the kick`); }
        else if (this.ducking && this.pump < 1.5) { this.ducking = false; this.note('pumping stopped'); }
        else if (this.ducking && Math.abs(depth - this.duckDepth) >= 0.2) this.duckDepth = depth;
      }
    },

    // .lpf() and .gain() numbers that follow the music. They move only on real changes (>15%).
    updateKnobs() {
      const a = this.knobAcc, k = this.knobs;
      if (!a.n) return;
      const step = (old, x, round) => (Math.abs(x - old) / old > 0.15 ? Math.round(x / round) * round : old);
      k.bassLpf = clamp(step(k.bassLpf, (a.bass / a.n) * 3, 50), 150, 4000);
      k.chordLpf = clamp(step(k.chordLpf, (a.chords / a.n) * 1.5, 100), 400, 9000);
      const hh = a.hh / a.n;
      k.hhMax = Math.max(hh, k.hhMax * 0.98);
      k.hhGain = step(k.hhGain, clamp(Math.sqrt(hh / k.hhMax), 0.1, 1), 0.1);
      this.knobAcc = { bass: 0, chords: 0, hh: 0, n: 0 };
    },

    estimateTempo(t) {
      const recent = this.onsets.filter((o) => o.t > t - 8);
      if (recent.length < 10) return;
      const N = 800, env = new Float32Array(N + 2), start = t - 8;
      const weight = (o) => ({ bd: 1, sd: 0.8, bass: 0.7 }[o.id] || 0.35) * Math.min(o.s, 1.5);
      for (const o of recent) {
        const w = weight(o);
        const i = Math.round((o.t - start) * 100);
        if (i < 1 || i >= N) continue;
        env[i] += w; env[i - 1] += w * 0.5; env[i + 1] += w * 0.5;
      }
      const ac = new Float32Array(172);
      for (let L = 30; L <= 170; L++) {
        let s = 0;
        for (let i = 0; i + L < N; i++) s += env[i] * env[i + L];
        ac[L] = s / (N - L);
      }
      // Besides how periodic the hits are, how well each tempo explains them, which settles the
      // usual misreadings (4/3, 3/2, 5/4, half or double the real tempo):
      // grid: the hits sit on its 16th notes, straight or swung (the 16ths between the 8ths come
      //   late), measured over 2-second stretches so a period that's slightly off doesn't smear it;
      // beats: the kicks and claps land on its beats (at the best phase), not between them.
      // That's how a listener tells too: drum & bass at half speed puts every snare between
      // beats, a shuffle read at 1.5x puts the backbeat between them.
      const strong = recent.filter((o) => o.id === 'bd' || o.id === 'sd');
      const hist = new Float32Array(32), win = [];
      const fit = (P) => {
        let grid = 0, gw = 0;
        for (let w0 = start; w0 < t; w0 += 2) {
          // this stretch's hits, in 8th notes, and where its 8ths fall
          let c8 = 0, s8 = 0, n = 0;
          win.length = 0;
          for (const o of recent) {
            if (o.t < w0 || o.t >= w0 + 2) continue;
            const w = weight(o), x = (2 * o.t) / P;
            win.push(w, x);
            c8 += w * Math.cos(2 * Math.PI * x); s8 += w * Math.sin(2 * Math.PI * x); n += w;
          }
          if (!n) continue;
          const at = Math.atan2(s8, c8) / (2 * Math.PI);
          let top = 0;
          for (const swing of [0, 0.16, 0.33]) {
            const mid = 0.5 + swing / 2; // where the 16th between two 8ths falls, in 8ths
            let c = 0, s = 0;
            for (let i = 0; i < win.length; i += 2) {
              let u = win[i + 1] - at;
              u -= Math.floor(u); // how far into its 8th
              const v = u < mid ? (u * 0.5) / mid : 0.5 + ((u - mid) * 0.5) / (1 - mid); // straightened
              c += win[i] * Math.cos(4 * Math.PI * v); s += win[i] * Math.sin(4 * Math.PI * v);
            }
            top = Math.max(top, Math.hypot(c, s));
          }
          grid += top;
          gw += n;
        }
        let beats = 1;
        if (strong.length >= 4) {
          hist.fill(0);
          let tot = 0, top = 0;
          for (const o of strong) { const w = weight(o); hist[Math.floor(((o.t / P) % 1) * 32) % 32] += w; tot += w; }
          for (let b = 0; b < 32; b++) { let sum = 0; for (let d = -4; d <= 4; d++) sum += hist[(b + d + 32) % 32]; top = Math.max(top, sum); }
          beats = top / tot;
        }
        return (gw ? grid / gw : 1) * beats ** 1.5;
      };
      // Music has about four hits a beat at its real tempo (8ths and 16ths across the kit). That
      // settles half versus double, which the rest can't: drum & bass read at half speed has
      // eight a beat, boom-bap read at double speed two.
      const span = recent[recent.length - 1].t - recent[0].t || 1;
      const score = new Float32Array(82), fits = new Float32Array(82);
      let bestL = 0, best = 0, total = 0;
      for (let L = 33; L <= 80; L++) { // 180 down to 75 bpm
        const bpm = 6000 / L, perBeat = (recent.length * L) / 100 / span;
        const prior = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.55) ** 2) * Math.exp(-0.5 * (Math.log2(perBeat / 4) / 1.2) ** 2);
        fits[L] = fit(L / 100);
        score[L] = (ac[L] + 0.5 * ac[2 * L]) * prior * fits[L];
        total += score[L];
        // From 150 to 176 bpm a lag step is 2.5 to 3% of the beat, so a tempo between two (174 falls
        // between 0.34 and 0.35 s) drifts off either one's grid over the 8 seconds, and lost to half
        // of it (0.69 s, almost exactly a step): drum & bass locked at 87 in 3 of 12 tries. A third
        // of a step either side is tried there too, for picking the best (not for how sure it is).
        if (L >= 34 && L <= 40) {
          const refined = Math.max(fits[L], fit((L - 0.33) / 100), fit((L + 0.33) / 100));
          if (refined > fits[L]) { fits[L] = refined; score[L] = (ac[L] + 0.5 * ac[2 * L]) * prior * refined; }
        }
        if (score[L] > best) { best = score[L]; bestL = L; }
      }
      if (!bestL || best <= 0) return;
      this.rhythm = { fit: fits[bestL], conf: 1 - total / 48 / best, bpm: 6000 / bestL };
      const a = score[bestL - 1] || 0, b = score[bestL], c = score[bestL + 1] || 0;
      const den = a - 2 * b + c;
      const delta = den ? clamp((0.5 * (a - c)) / den, -0.5, 0.5) : 0;
      const conf = 1 - total / 48 / best;
      // How much better this reading scores than the tempo we're locked to.
      const T = this.tempo, Lk = T.locked ? 6000 / T.bpm : 0;
      const held = Lk >= 33 && Lk <= 80 ? Math.max(score[Math.floor(Lk)], score[Math.ceil(Lk)]) : 0;
      // A drum tempo needs drums: kicks or claps, 4 at least in the 8 seconds (with fewer, beats
      // above can't check where they land). Without them, the regular shimmer of a pad or the
      // syllables of talking can pass for a beat here; that's left to the whole sound's tempo
      // (fluxUpdate), which checks for a steady pulse all through.
      const drums = strong.length >= 4;
      // And how well the hits fit the locked tempo's grid (its double or half, outside the range).
      let Lf = Lk;
      while (Lf > 80) Lf /= 2;
      while (Lf && Lf < 33) Lf *= 2;
      const heldFit = Lf ? Math.max(fits[Math.floor(Lf)], fits[Math.ceil(Lf)]) : 0;
      // an estimate stuck at the edge of the 75-180 range is usually a double- or half-time reading
      this.tempoUpdate(t, 6000 / (bestL + delta), conf, bestL <= 33 || bestL >= 80, held > 0 ? best / held : Infinity, drums ? fits[bestL] : 0, drums ? heldFit : 0);
    },

    tempoUpdate(t, bpm, conf, atEdge, gain = Infinity, fit = 1, heldFit = 0) {
      const T = this.tempo;
      const near = (x, y) => Math.abs(x - y) / y < 0.035;
      // Double or half the locked tempo is the same beat counted differently.
      const octave = (x, y) => [2, 0.5].some((r) => Math.abs(x - y * r) / (y * r) < 0.06);
      // Only a clear beat gets locked onto: one tempo standing out (music measures 0.86 and up,
      // talking or ambience under 0.8) whose grid the hits actually fit (music mostly 0.33 and
      // up, a livestream's talk and game sounds mostly under 0.25).
      const dense = this.dense(t, bpm), clear = conf >= 0.82 && fit >= 0.25 && dense;
      if (clear) T.clearAt = t;
      // No clear beat for a while after music. In a song (a breakdown, a quiet verse) the beat
      // comes back at the same tempo, so keep it: the parts go dim until they're heard again, and
      // the drop effect fires when the kick returns. Without a song to go on (a stream going from
      // music to talking, say), let the beat go after a minute. (Clear means a lower bar than
      // locking on.)
      if (T.locked) {
        T.unclearN = conf >= 0.8 && fit >= 0.2 ? 0 : (T.unclearN || 0) + 1;
        if (T.unclearN >= 120 && !this.song().known && !T.tapped) {
          this.note('no clear beat any more: listening again');
          this.reset();
          this.on.newSong();
          return;
        }
      }
      // A different reading only counts if it clearly beats the tempo we have, so two close
      // readings can't keep trading places. (Double or half never does: some beats, like drum &
      // bass, score about the same both ways, and switching back and forth would be worse.) A
      // tempo you tapped stays until the song changes or you tap again.
      // Once locked, a change of tempo can also come from readings whose grid the hits fit less
      // than a lock needs (0.18 rather than 0.25), as long as they're as sure of it and beat the
      // tempo held by half again: in a DJ mix the new song plays over the end of the old one, and
      // its hits fit untidily for a while. Crossfades between songs 9 to 27% apart in tempo were
      // followed about 2.5 s sooner, and a recorded mix going from 133 to 139.6 at all (it never
      // did in the 7 s left of it); on the logs of 42 songs and 19 test songs nothing else moved
      // (Oct 20).
      const changing = T.locked && conf >= 0.82 && fit >= 0.18 && dense && gain >= 1.5;
      if (T.locked && (T.tapped || near(bpm, T.bpm) || octave(bpm, T.bpm) || atEdge || gain < 1.3)) {
        T.candN = 0; // same beat; fine-tuning happens in updatePhase from the hits themselves
      } else if (clear || changing) {
        if (T.cand && near(bpm, T.cand)) { T.cand = T.cand * 0.7 + bpm * 0.3; T.candN++; }
        else { T.cand = bpm; T.candN = 1; }
        // a real tempo change has to hold for 3 seconds before the patterns get relearned
        if (T.candN >= (T.locked ? 6 : 4) && (T.locked || this.repeats(t, T.cand) >= 0.35) && this.repeatsThere(t, T.cand)) {
          this.lockTo(t, T.cand, T.locked ? `tempo change ${T.bpm.toFixed(1)} -> ${T.cand.toFixed(1)}` : `tempo lock ${T.cand.toFixed(1)}`);
        }
      }
      // The drums' reading lately, clear or not: the readings running at one tempo, with drums (fit
      // is 0 without them) and fairly sure. Most real songs measure under the clear bar (conf 0.6 to
      // 0.85, fit 0.1 to 0.3, on the songs of a 17-minute recording of Oct 15) while holding the
      // right tempo for seconds on end. Held for 3 seconds (6 readings), each conf 0.75 and fit 0.18
      // or more, it locks (Hard Refresh: 150 at 7 s, where the whole sound's reading would have
      // locked it at 100; Outside Those Doors: 160 at 5 s, not 80 at 10).
      const sure = fit > 0 && conf >= 0.6, run = T.drumRun;
      if (sure && run.length && near(bpm, run[run.length - 1].bpm)) run.push({ t, bpm, conf, fit, dense });
      else T.drumRun = sure ? [{ t, bpm, conf, fit, dense }] : [];
      if (T.drumRun.length > 12) T.drumRun.shift();
      const held = T.drumRun.slice(-6);
      if (!T.locked && held.length === 6 && held.every((r) => r.conf >= 0.75 && r.fit >= 0.18 && r.dense) && this.repeats(t, held[5].bpm) >= 0.35) {
        const mean = held.reduce((a, r) => a + r.bpm, 0) / 6;
        this.lockTo(t, mean, `tempo lock ${mean.toFixed(1)} (the drums held it)`);
      }
      // Locked at 2/3 or 3/2 of the real tempo: the usual misreading of breakbeats (kicks a beat
      // and a half apart sound like the beat of a tempo two thirds as fast) and shuffles. Readings
      // of the real one seldom come clear in such music, so the usual change (6 clear readings)
      // never comes: I Must Apologise (drum & bass at 157) locked at 103 and stayed a minute
      // (Oct 16), while the drums read 157 every few seconds, the hits fitting its grid about
      // twice as well. So a sure reading at 3:2 or 2:3 of the locked tempo (within 6%) whose grid
      // the hits fit 1.5 times as well or more, in 6 of the drums' last 12 readings, changes it.
      // 3:2, and (tempoFix) 4:3 at a gentler 1.25: other ratios come from odd bars and fills (Take
      // Five, in 5/4, read at 3/5 and 3/4 of its tempo for seconds on end; Dancin at 4/5), but at 4:3
      // house's syncopated intros lock wrong (Gypsy Woman's 160 for its 120) and its kicks fit the
      // right grid 1.2-1.6 times as well for 30 s before 1.5 came round. Replayed on the onset logs of
      // 20 songs and 36 test runs at three timings, locked as heard, at the right tempo or at a 3:2
      // one: no right tempo moved, and wrong ones came right (I Must Apologise after 11-14 s).
      if (T.locked && !T.tapped && fit > 0) {
        const at32 = [1.5, 2 / 3].some((r) => Math.abs(bpm / T.bpm - r) / r < 0.06);
        const at43 = !!this.tempoFix && [4 / 3, 3 / 4].some((r) => Math.abs(bpm / T.bpm - r) / r < 0.06);
        const better = !atEdge && conf >= 0.6 && ((at32 && fit >= 0.1 && fit >= 1.5 * heldFit) || (at43 && fit >= 0.15 && fit >= this.tempoFix.fit43 * heldFit));
        T.better.push(better ? bpm : 0);
        if (T.better.length > 12) T.better.shift();
        const same = better ? T.better.filter((b) => b && near(b, bpm)) : [];
        const mean = same.length >= 6 ? same.reduce((a, b) => a + b, 0) / same.length : 0;
        if (mean && this.repeatsThere(t, mean)) this.lockTo(t, mean, `tempo change ${T.bpm.toFixed(1)} -> ${mean.toFixed(1)} (the hits fit it better)`);
      }
      if (T.locked) this.updatePhase(t);
    },

    // Are there enough kicks and claps to be a beat at bpm: half a hit a beat or more, over the
    // last 8 seconds (or since the sound started, 2 at least). Songs have one or more (four on the
    // floor 1, kick and backbeat 1.25); the talking test sound's game noises, about 0.4, once held
    // a steady 125 for 5 seconds and locked.
    // Do the hits repeat, as drums do? The kicks, claps and hats of the last 8 seconds on a 16th grid
    // fitted finely (the tempo within 2.5% of bpm, in tenths of a percent, and the phase in 128ths
    // of a 16th, the most hits within 15 ms of a 16th): the share with one of their kind on the
    // same 16th a bar or half a bar before or after, whichever is more. Music repeats (on the logged
    // runs 0.5 and up at its lock, by the time it locks); random thumps don't: the talking test
    // sound's game noises (a thump, a bang or a click at about one a second, at random) locked a beat
    // through the drum rules in two of four takes, there under 0.35. Worked out only when a lock is
    // about to happen.
    repeats(t, bpm) {
      if (t !== this.repAt) { this.repAt = t; this.repCache.clear(); }
      const key = Math.round(bpm * 1000);
      if (this.repCache.has(key)) return this.repCache.get(key);
      const s = this.onsets.filter((o) => o.t > t - 8 && (o.id === 'bd' || o.id === 'sd' || o.id === 'hh'));
      if (s.length < 4) { this.repCache.set(key, 0); return 0; }
      let best = -1, q16 = 0, phase = 0;
      for (let k = -25; k <= 25; k++) {
        const q = 15 / (bpm * (1 + k * 0.001));
        for (let j = 0; j < 128; j++) {
          const ph = (j / 128) * q;
          let c = 0;
          for (const o of s) { const x = (o.t - ph) / q; if (Math.abs(x - Math.round(x)) * q < 0.015) c++; }
          if (c > best) { best = c; q16 = q; phase = ph; }
        }
      }
      const at = (o) => Math.round((o.t - phase) / q16), sets = { bd: new Set(), sd: new Set(), hh: new Set() };
      // An off-grid hit isn't repetition evidence just because rounding puts it near another.
      // Keep all hits in the denominator: a grid fitting only a few mustn't score a perfect loop.
      const fitted = s.filter((o) => Math.abs(o.t - phase - at(o) * q16) < 0.015);
      for (const o of fitted) sets[o.id].add(at(o));
      const share = (gap) => fitted.filter((o) => { const k = at(o), S = sets[o.id]; return S.has(k + gap) || S.has(k - gap); }).length / s.length;
      const v = Math.max(share(16), share(8));
      this.repCache.set(key, v);
      return v;
    },

    // A change to 3:2, 2:3, 4:3 or 3:4 of the locked tempo (from the drums or the whole sound) also
    // needs the hits to repeat at least as well in bars of the new tempo (repeats): dubstep's
    // triplet wobbles and riddim's half-time hits read for seconds on end as a tempo 3/4 or 2/3 as
    // fast (a dubstep remix at 140 went to 105 in its triplet wobbles, a riddim track at 141 to 95
    // in its drop), but their bars repeat at their own tempo, not there; a wrong lock (a breakbeat
    // at 2/3, house at 4/3) repeats better at the right one, so it still comes right.
    // A tempo held 45 s or more takes a clear win (0.1 more) to leave: the scores can be close. The
    // corrections of a wrong lock come early (Gypsy Woman 160 -> 120 at 0.444 against 0.417, 19 s
    // after its lock; I Must Apologise 105 -> 157 at 0.742 against 0.730, after 23 s), while the
    // dubstep remix's breakdown went from 140, held 83 s, to 105 at 0.718 against 0.692, for 40 s.
    repeatsThere(t, bpm) {
      const T = this.tempo;
      const related = T.locked && [1.5, 2 / 3, 4 / 3, 3 / 4].some((r) => Math.abs(bpm / T.bpm - r) / r < 0.06);
      const margin = t - (T.lockedAt ?? t) >= 45 ? 0.1 : 0;
      return !related || this.repeats(t, bpm) >= this.repeats(t, T.bpm) + margin;
    },

    dense(t, bpm) {
      const first = this.onsets.length ? this.onsets[0].t : t, span = Math.max(2, Math.min(8, t - first));
      let n = 0;
      for (const o of this.onsets) if (o.t > t - span && (o.id === 'bd' || o.id === 'sd')) n++;
      return n / ((span * bpm) / 60) >= 0.5;
    },

    // Tapping the beat (space): from the fourth tap the tempo is the taps' (their middle gap, kept
    // between 75 and 180 bpm), with the beats on the taps and the first tap starting a bar. For a
    // song it can't find the beat of, or finds wrong; it stays (the hits still fine-tune where the
    // beats fall) until the song changes. A pause of 2 seconds starts the count over. Returns how
    // many taps there are so far.
    tap(t) {
      const taps = (this.taps ||= []);
      if (taps.length && t - taps[taps.length - 1] > 2) { taps.length = 0; this.firstTap = null; }
      if (this.firstTap == null) this.firstTap = t;
      taps.push(t);
      if (taps.length > 8) taps.shift();
      if (taps.length < 4) return taps.length;
      const gaps = taps.slice(1).map((x, i) => x - taps[i]).sort((a, b) => a - b);
      let bpm = 60 / gaps[Math.floor(gaps.length / 2)];
      while (bpm < 75) bpm *= 2;
      while (bpm > 180) bpm /= 2;
      const T = this.tempo;
      this.lockTo(t, bpm, `tempo tapped ${bpm.toFixed(1)}`, taps[taps.length - 1]);
      T.byFlux = false;
      T.tapped = true;
      // beat numbers count back from the last tap (0): the first tap of the count starts a bar
      const down = (((-Math.round((taps[taps.length - 1] - this.firstTap) / T.P)) % 4) + 4) % 4;
      if (down !== T.down) { this.relabel(4 * (down - T.down)); T.down = down; }
      return taps.length;
    },

    // Locks onto bpm (or changes to it), with a beat at beatAt if that's known (else at the last
    // kick), and starts learning the patterns again. A beat given means the tempo came from the
    // whole sound (fluxUpdate), not the drums.
    lockTo(t, bpm, what, beatAt) {
      const T = this.tempo, fix = this.tempoFix;
      // The first lock (not a tapped one): where do the bars repeat, here or at 3:4 or 4:3 of it (see
      // tempoFix)? Clearly better there: that's the tempo (its beats from the hits, not this reading's).
      // About as well: wait for the song to say, a while.
      if (fix && !T.locked && !/tapped/.test(what)) {
        const here = this.repeats(t, bpm), alts = [3 / 4, 4 / 3].map((r) => bpm * r).filter((x) => x >= 75 && x <= 180);
        let best = bpm, top = here;
        const slow = bpm * 0.75, rs = slow >= 75 ? this.repeats(t, slow) : 0;
        if (rs >= here + fix.margin) { top = rs; best = slow; }
        if (best !== bpm) {
          what = `tempo lock ${best.toFixed(1)} (its bars repeat: ${top.toFixed(2)}, against ${here.toFixed(2)} at ${bpm.toFixed(1)})`;
          bpm = best;
          beatAt = undefined;
        } else {
          T.firstTry ??= t;
          if (t - T.firstTry < fix.wait && alts.some((x) => this.repeats(t, x) >= here - fix.tie)) return;
        }
      }
      this.tape?.lock(bpm, T.down);
      this.note(what);
      const before = T.locked ? this.stepAt(t) : null;
      T.locked = true;
      T.lockedAt = t;
      T.byFlux = beatAt !== undefined;
      T.tapped = false;
      this.setPeriod(t, bpm, true);
      if (beatAt !== undefined) T.t0 = beatAt;
      if (before !== null) {
        T.renumber += this.stepAt(t) - before; // new numbering from here on
        // a new tempo, perhaps a new song: its key comes in at the usual pace, not a settled one's
        this.keyShown = 0;
      }
      T.candN = T.frun = 0;
      T.better = [];
      // Start learning again, but keep showing the old patterns until new ones settle.
      for (const id of PARTS) {
        const v = this.v[id];
        v.grid.fill(0); v.on.fill(false); v.hitBar.fill(-999);
        v.sig = null; v.sigN = 0;
        v.long.fill(0); v.counts.length = 0; // (the hats' fallback memory too: a new grid)
      }
      this.bt.bars.clear();
      this.kickB.fill(0);
      this.snareB.fill(0);
      this.changeB.fill(0);
      this.ringN.fill(0);
      this.ringBeat = null;
      T.half = null;
      T.halfN = T.halfOff = 0;
      T.halfSeen = false;
      T.halved = false;
      T.ringTop = -Infinity;
      this.prevBeatChroma = this.prevBeatBass = null;
      this.resetClocks();
    },

    // A tempo reading from every instrument's onsets together (strummed or picked guitar, piano,
    // voice, not just drums): how strongly the last 10 seconds of them repeat at each tempo from
    // 75 to 180 bpm, every multiple of the beat counted in. pulse: how strong the best one is
    // (measured live: songs with drums 0.4 to 1.3, soft ones 0.15 to 0.6, talking up to about
    // 0.25, so it can't tell those last two apart alone; support below does). beatAt: when a beat
    // fell, the time that lines the most onsets up on the beats.
    fluxTempo(t, lockedBpm = 0) {
      const ts = this.fluxT, vs = this.fluxV;
      if (ts.length < 2) return null;
      const start = Math.max(ts[0], t - 10), n = Math.floor((t - start) * 100);
      if (n < 600) return null; // 6 seconds at least
      // onto a 100 Hz grid, then just the onsets: above the level around them (0.4 s), less the mean
      const on = new Float32Array(n), pre = new Float64Array(n + 1);
      for (let i = 0, j = 0; i < n; i++) {
        const x = start + i / 100;
        while (j < ts.length - 2 && ts[j + 1] < x) j++;
        const u = ts[j + 1] > ts[j] ? clamp((x - ts[j]) / (ts[j + 1] - ts[j]), 0, 1) : 0;
        on[i] = vs[j] + (vs[j + 1] - vs[j]) * u;
        pre[i + 1] = pre[i] + on[i];
      }
      let mean = 0;
      for (let i = 0; i < n; i++) {
        const a = Math.max(0, i - 20), b = Math.min(n, i + 20);
        on[i] = Math.max(0, on[i] - (pre[b] - pre[a]) / (b - a));
        mean += on[i] / n;
      }
      for (let i = 0; i < n; i++) on[i] -= mean;
      const ac = new Float32Array(321);
      let a0 = 0;
      for (let i = 0; i < n; i++) a0 += on[i] * on[i];
      if (a0 <= 0) return null;
      for (let L = 33; L <= 320 && L < n; L++) {
        let s = 0;
        for (let i = 0; i + L < n; i++) s += on[i] * on[i + L];
        ac[L] = s / a0;
      }
      const comb = (L) => ac[L] + 0.5 * ac[2 * L] + 0.33 * ac[3 * L] + 0.25 * ac[4 * L];
      const score = new Float32Array(82);
      let bestL = 0;
      for (let L = 33; L <= 80; L++) {
        score[L] = Math.max(0, comb(L)) * Math.exp(-0.5 * (Math.log2(6000 / L / 120) / 0.55) ** 2);
        if (score[L] > (score[bestL] || 0)) bestL = L;
      }
      if (!bestL) return null;
      const a = score[bestL - 1] || 0, b = score[bestL], c = score[bestL + 1] || 0, den = a - 2 * b + c;
      const L = bestL + (den ? clamp((0.5 * (a - c)) / den, -0.5, 0.5) : 0);
      // the beats: counting back from now in steps of L, the phase that lands on the most onset
      let phase = 0, top = -Infinity;
      for (let p = 0; p < L; p++) {
        let s = 0;
        for (let x = n - 1 - p; x >= 1; x -= L) { const i = Math.round(x); s += on[i - 1] + on[i] + (on[i + 1] ?? 0); }
        if (s > top) { top = s; phase = p; }
      }
      // Does each half of the stretch show that beat on its own? Readings this far apart share
      // most of their 10 seconds, so a chance pattern in talking (a run of evenly spaced syllables)
      // can win several in a row; a real beat runs through both halves. support: the weaker half's
      // pulse at the beat (measured live: songs with drums 0.5 to 1, a soft song with a steady
      // pulse 0.15 to 0.4, talking at most 0.18).
      const half = (a, b) => {
        let m = 0;
        for (let i = a; i < b; i++) m += on[i] / (b - a);
        const at = (lag) => { let s = 0; for (let i = a; i + lag < b; i++) s += (on[i] - m) * (on[i + lag] - m); return s; };
        const h0 = at(0);
        return h0 > 0 ? [1, 2, 3, 4].reduce((s, k, j) => s + [1, 0.5, 0.33, 0.25][j] * at(k * bestL), 0) / h0 : 0;
      };
      const support = Math.min(half(0, n >> 1), half(n >> 1, n));
      // gain: how much better this reading scores than the tempo we're locked to (if any)
      const Lk = lockedBpm ? 6000 / lockedBpm : 0;
      const held = Lk >= 33 && Lk <= 80 ? Math.max(score[Math.floor(Lk)], score[Math.ceil(Lk)]) : 0;
      // Finer: the comb works in whole steps of 10 ms, so a tempo between two (128 bpm is 46.9
      // steps, between 127.7 and 130.4) came out wherever the noise put it, and a tempo locked from
      // here followed it (on a steady synth track at 128: 127.6 up to 130.4 and back in ten
      // seconds). So the beat length is fitted to the onsets of all ten seconds: about twenty beats
      // counted back from now, the length moved in fiftieths of a step near the comb's answer, the
      // phase in halves, the onsets smoothed a little and read between samples.
      const sm = new Float32Array(n);
      for (let i = 0; i < n; i++) sm[i] = 0.25 * on[Math.max(0, i - 1)] + 0.5 * on[i] + 0.25 * on[Math.min(n - 1, i + 1)];
      const read = (x) => { const i = Math.floor(x), f = x - i; return i >= 0 && i + 1 < n ? sm[i] * (1 - f) + sm[i + 1] * f : 0; };
      let fineL = L, finePhase = phase, top2 = -Infinity;
      for (let Lf = L - 0.6; Lf <= L + 0.6 + 1e-9; Lf += 0.02) {
        for (let p = 0; p < Lf; p += 0.5) {
          let s = 0;
          for (let x = n - 1 - p; x >= 1; x -= Lf) s += read(x);
          if (s > top2) { top2 = s; fineL = Lf; finePhase = p; }
        }
      }
      return { bpm: 6000 / fineL, pulse: comb(bestL), support, beatAt: start + (n - 1 - finePhase) / 100, gain: held > 0 ? score[bestL] / held : Infinity };
    },

    // When the drums give no clear beat (an acoustic song, a piano ballad, a quiet intro), locks
    // onto the whole sound's tempo once it has held for 3 seconds: the reading from 3 seconds ago
    // and at least 3 in 5 of those since (one every half second) agree on it (within 3.5%), each
    // with a pulse of 0.2 and up that both halves of its 10 seconds show on their own (0.15 and
    // up). Readings half a second apart share nine and a half of their ten seconds, so two running
    // agreeing proved little. Tried on the readings of 12 test runs (talk 6 takes, ambient 4,
    // acoustic 2) and 10 recordings: two running locked falsely 4 times (a chance pulse in talking
    // or in detuned pads beating, held for a second or two) and one recording at half its tempo;
    // holding 2 seconds, 2 false locks; 3 seconds, none, and every recording with a beat locked at
    // the right tempo, 2 to 8 seconds later than before; 4 or 5, one never locked. A song without a
    // steady pulse (a rubato ballad) keeps waiting for one, rather than risk locking onto talking. A
    // tempo found this way follows the readings that agree with it and moves when three running
    // agree on another; locked onto the drums, a strong pulse at the locked tempo (or double or
    // half) only counts as the beat still being there.
    fluxUpdate(t) {
      const T = this.tempo;
      const sameBeat = (a, b) => [1, 2, 0.5].some((k) => Math.abs(a - b * k) / (b * k) < 0.06);
      if (T.locked && !T.byFlux) {
        if (T.unclearN > 0) {
          const r = this.fluxTempo(t);
          if (r && r.pulse >= 0.3 && sameBeat(r.bpm, T.bpm)) T.unclearN = 0;
        }
        return;
      }
      const r = this.fluxTempo(t, T.locked ? T.bpm : 0);
      // The drums' reading (this tick's, if there was one) and this one agree, within 3%, three
      // times running, with a pulse of 0.3 or more here: two ways of hearing the beat that rarely
      // agree by chance. Locks well before either is sure alone (Bad Girls: 9.5 s, not 15.5; I Like:
      // 7.5, not 9.5). (With a weaker pulse, 0.2, the intro of reborn locked at 133 for its 148.)
      if (!T.locked) {
        const d = T.drumRun.length ? T.drumRun[T.drumRun.length - 1] : null;
        if (r && r.pulse >= 0.3 && d && t - d.t < 0.4 && d.fit >= 0.1 && Math.abs(d.bpm - r.bpm) / r.bpm < 0.03 && this.dense(t, r.bpm)) {
          if (T.agreeN && Math.abs(r.bpm - T.agreeBpm) / T.agreeBpm < 0.03) { T.agreeN++; T.agreeBpm = (T.agreeBpm + r.bpm) / 2; }
          else { T.agreeN = 1; T.agreeBpm = r.bpm; }
          if (T.agreeN >= 3) {
            this.lockTo(t, T.agreeBpm, `tempo lock ${T.agreeBpm.toFixed(1)} (the drums and the whole sound agree)`, r.beatAt);
            // the drums had their say: they keep it (as when they lock alone), so the whole sound's
            // reading can't change it by itself later. Locked as the whole sound's, Umbraid's
            // 150 went to 100 for 7 seconds (its 2:3) while the drums weren't clear (Oct 16).
            T.byFlux = false;
            return;
          }
        } else T.agreeN = 0;
      }
      const ok = !!r && r.pulse >= 0.2 && r.support >= 0.15;
      T.fseen.push({ t, bpm: r ? r.bpm : 0, ok });
      while (T.fseen.length && T.fseen[0].t < t - 6) T.fseen.shift();
      if (!ok) { T.frun = 0; return; }
      if (T.frun && Math.abs(r.bpm - T.fbpm) / T.fbpm < 0.035) { T.fbpm = (T.fbpm + r.bpm) / 2; T.frun++; }
      else { T.fbpm = r.bpm; T.frun = 1; }
      const drums = t - T.clearAt < 1.5;
      if (T.locked) {
        // A reading straight on, within 3.5% of the tempo, is followed (a twentieth of the way each
        // half second: the reading still wobbles a little, and a tempo that followed it a fifth of
        // the way wandered with it; real drift, a band speeding up, is followed over about ten
        // seconds). It's the same beat within 3.5% at double or half too, but isn't followed from
        // there: those readings are rougher, and the grid wandered with them (the quiet test song's
        // hats came out half missed, Oct 21). Further off, double or half or not, it's another
        // tempo. Counted as the same beat within 6% at double and half, a lock that came out 4.6%
        // off kept it all song: We Will Rock You (81) locked at 154.8 on its first readings, then
        // read a steady 81 (162 doubled), and the beat drifted off its grid (Oct 20).
        let fb = T.fbpm;
        while (fb < T.bpm / 1.42) fb *= 2;
        while (fb > T.bpm * 1.42) fb /= 2;
        if (Math.abs(T.fbpm - T.bpm) / T.bpm < 0.035) this.setPeriod(t, T.bpm + 0.05 * (T.fbpm - T.bpm), false);
        if (Math.abs(fb - T.bpm) / T.bpm < 0.035) T.unclearN = 0;
        // A different tempo has to hold for 3 seconds and clearly beat the one we have, as with the
        // drums (tempoUpdate): a swung or shuffled song shows a pulse at 3:2 or 4:3 of its tempo
        // too, and the readings would trade places (100, 133 and 150 bpm, back and forth). At 3:2 or
        // 4:3 of it, the hits have to repeat as well there too (repeatsThere): Gypsy Woman went
        // 160 -> 120 -> 160 -> 120 this way in one take.
        else if (T.frun >= 6 && !drums && r.gain >= 1.3 && this.repeatsThere(t, T.fbpm)) this.lockTo(t, T.fbpm, `tempo change ${T.bpm.toFixed(1)} -> ${T.fbpm.toFixed(1)} (from the whole sound)`, r.beatAt);
        return;
      }
      // held for 3 seconds: the reading from then and 3 in 5 since agree, and passed
      const agrees = (h) => h.ok && Math.abs(h.bpm - T.fbpm) / T.fbpm < 0.035;
      const since = T.fseen.filter((h) => h.t >= t - 3.25);
      if (!since.length || t - since[0].t < 2.75 || !agrees(since[0]) || since.filter(agrees).length < 0.6 * since.length) return;
      // unless the drums are about to lock onto a different tempo of their own: theirs goes first
      if (T.candN >= 2 && drums && !sameBeat(T.cand, T.fbpm)) return;
      // or the drums have held a tempo of their own for a moment (3 readings) that isn't this beat
      // at all (3:2, say): wait for one of them to be sure
      const dr = T.drumRun;
      if (dr.length >= 3 && !sameBeat(dr[dr.length - 1].bpm, T.fbpm)) return;
      // The drums can still say which octave: kicks and claps running at double this for a moment
      // (3 readings, each conf 0.7 and half a hit a beat or more at their tempo) make it theirs,
      // and they keep it. Outside Those Doors, four on the floor at 160, locked at 80 this way in
      // one take of five; on 65 logged runs nothing else changes (a slow song's drums at double
      // its tempo are too thin for it).
      const last = dr.slice(-3);
      let bpm = T.fbpm;
      if (last.length === 3 && t - last[2].t < 1 && Math.abs(last[2].bpm - 2 * T.fbpm) / (2 * T.fbpm) < 0.06 && last.every((x) => x.conf >= 0.7 && x.dense)) {
        bpm = (last[0].bpm + last[1].bpm + last[2].bpm) / 3;
      }
      this.lockTo(t, bpm, `tempo lock ${bpm.toFixed(1)} (from the whole sound: no clear drums${bpm !== T.fbpm ? '; the drums say double' : ''})`, r.beatAt);
      if (bpm !== T.fbpm) T.byFlux = false;
    },

    setPeriod(t, bpm, fresh) {
      const T = this.tempo;
      if (fresh || !T.P) {
        const kick = [...this.onsets].reverse().find((o) => o.id === 'bd');
        T.t0 = kick ? kick.t : t;
        T.n0 = 0;
      } else {
        // Re-anchor near "now" so beat numbering stays continuous when the period changes.
        const n = Math.round((t - T.t0) / T.P);
        T.t0 += n * T.P;
        T.n0 += n;
        this.tape?.tempo(bpm);
      }
      T.bpm = bpm;
      T.P = 60 / bpm;
      // The tempo as shown (the code's setcpm, the ID card): a whole number that moves only when
      // the tempo has moved a whole bpm from it, so fine-tuning between 147.4 and 147.6 doesn't
      // retype the line as 147, 148, 147 (on a recording of Oct 15, all through a song)
      if (fresh || !T.shown || Math.abs(bpm - T.shown) >= 1) T.shown = Math.round(bpm);
    },

    updatePhase(t) {
      const T = this.tempo;
      // Fine-tune the period: fit a straight line through the last 10 seconds of hits against
      // their 16th-note numbers: kicks and claps on any 16th, hi-hats on the 8ths (swing moves the
      // 16ths in between). Sparse beats still give plenty of points that way. Recent hits count
      // more, so a band that speeds up or slows down is followed.
      let m = 0, w0 = 0, sn = 0, st = 0, snn = 0, snt = 0;
      for (const o of this.onsets) {
        if (o.t < t - 10 || o.id === 'bass') continue;
        const q = (4 * (o.t - T.t0)) / T.P, k = Math.round(q); // 16ths since t0
        if (Math.abs(q - k) > 0.2 || (o.id === 'hh' && k % 2 !== 0)) continue;
        const y = o.t - T.t0, w = Math.exp((o.t - t) / 4); // small numbers, for precision
        m++; w0 += w; sn += w * k; st += w * y; snn += w * k * k; snt += w * k * y;
      }
      const den = w0 * snn - sn * sn;
      if (m >= 8 && den > 0) {
        const P = (4 * (w0 * snt - sn * st)) / den; // seconds per 16th, times 4
        if (Math.abs(P - T.P) / T.P < 0.02) this.setPeriod(t, 60 / (T.P + 0.3 * (P - T.P)), false);
      }
      // Phase. Drums land on 16th notes, but only some of those are beats: an average over every
      // hit gets dragged off the beat by syncopated kicks. So first, which 16th carries the beat:
      // the one with the most kick and clap weight (claps count more; they sit on the beat far
      // more reliably than kicks). Just after locking on, if another 16th clearly wins for 2
      // seconds, the beat moves there. After that it takes far more, because a song's beat doesn't
      // move: in breakbeats and live-coded patterns the kicks keep shifting between
      // sections and can outweigh the beat for a while, and following them flipped the beat half
      // a beat every 15 to 30 seconds. Then: the last 16 seconds (the latest counting most), a
      // third more weight (half again for half a beat, the usual mix-up), held for 6 seconds.
      const settled = t - (T.lockedAt ?? t) > 10, span = settled ? 16 : 6;
      const slots = [0, 0, 0, 0];
      for (const o of this.onsets) {
        if (o.t < t - span || (o.id !== 'bd' && o.id !== 'sd')) continue; // kicks and claps only
        const q = ((Math.round((4 * (o.t - T.t0)) / T.P) % 4) + 4) % 4;
        // by count, not loudness: one loud hit can't swing it
        slots[q] += (o.id === 'bd' ? 1 : 1.5) * (settled ? Math.exp((o.t - t) / 8) : 1);
      }
      let k = 0;
      for (let q = 1; q < 4; q++) if (slots[q] > slots[k]) k = q;
      const need = !settled ? 1.15 : k === 2 ? 1.5 : 1.33;
      // (only with enough kicks and claps to go on: a stretch without drums proves nothing)
      if (k && slots[k] > need * slots[0] && slots[0] + slots[1] + slots[2] + slots[3] >= 8) {
        T.slotN = T.slotCand === k ? T.slotN + 1 : 1;
        T.slotCand = k;
      } else T.slotN = 0;
      if (T.slotN >= (settled ? 12 : 4)) {
        const shift = k === 3 ? -1 : k; // the nearer way round
        T.t0 += (shift * T.P) / 4;
        this.tape?.shift(shift / 4);
        T.slotN = 0;
        this.kickB.fill(0);
        this.snareB.fill(0);
        this.changeB.fill(0);
        this.note(`beat moved ${shift > 0 ? 'later' : 'earlier'} by ${Math.abs(shift)}/16`);
        this.relabel(shift);
      }
      // Then fine-tune on the hits near the beat only, the latest counting most.
      let C = 0, S = 0, W = 0;
      for (const o of this.onsets) {
        if (o.t < t - 6 || (o.id !== 'bd' && o.id !== 'sd')) continue; // kicks and claps only
        const x = (o.t - T.t0) / T.P, d = x - Math.round(x);
        if (Math.abs(d) > 0.125) continue;
        const w = (o.id === 'bd' ? 1 : 0.6) * Math.min(o.s, 1.5) * Math.exp((o.t - t) / 2.5);
        C += w * Math.cos(2 * Math.PI * d);
        S += w * Math.sin(2 * Math.PI * d);
        W += w;
      }
      if (W < 1) return;
      T.t0 += (Math.atan2(S, C) / (2 * Math.PI)) * T.P * 0.6;
    },

    // Where time t falls on the step grid (16 per bar, counted from the start), or null.
    stepAt(t) {
      const T = this.tempo;
      return T.locked ? ((T.n0 + (t - T.t0) / T.P - T.down) / 4) * 16 : null;
    },

    // A part starts playing once it has been heard twice in 3 bars, and stops after 3 bars without
    // it. So a stray hit doesn't bring a part back, and a patchy one (hits missed, a sparse
    // pattern) doesn't come and go: each would mute and unmute it (a _ typed and deleted) every few
    // seconds.
    present(id, t) {
      const v = this.v[id], P = this.tempo.P;
      // (and nothing plays in silence: the music has stopped, whatever was learned stays for when
      // it comes back)
      if (!this.tempo.locked || this.silent || !v.shown?.some(Boolean) || v.tooBusy) return (v.here = false);
      const within = Math.max(4.5, P * 12);
      v.here = v.here ? t - v.last < within : t - v.last < within && t - v.prev < within;
      return v.here;
    },
    playing(seen, t) {
      return this.tempo.locked && !this.silent && t - seen < 10 * this.tempo.P;
    },

    // A short log of the big moments (locks, resets), for checking how the engine behaves.
    note(what) {
      this.events.push(`${nowSec().toFixed(1)} ${what}`);
      if (this.events.length > 100) this.events.shift();
    },

    trace(kind, data) {
      (this.log ||= []).push({ kind, t: +nowSec().toFixed(3), ...data });
      if (this.log.length > 800) this.log.shift();
    },
  };
  eng.reset();
  return eng;
}
