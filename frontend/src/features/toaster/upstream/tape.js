// The song as heard, kept from the moment the beat is found, for exporting it (X): at every bar
// line, the patterns the code shows for that bar (kick, clap, hats, the lead's notes, the bass
// line's rhythm), and each bar's chord and bass note. The same steady patterns the code is
// written from, not every hit the detectors fire on: those miss the odd kick and take some kicks
// for claps. Kept by beat, with the corrections the engine makes to its beat as it goes (a 16th
// earlier or later, the bar starting on another beat) applied to all of it when it's written
// out, so the whole song lines up with the beat as it ended up. A new tempo starts a new stretch
// (the longest is exported); a new song starts over, keeping the song before (if it got 4 bars)
// for X till the new one has 4 of its own: the time to export a song is often just after it ends,
// and a few seconds of silence count as a new song.
//
// Written out two ways: a MIDI file (drums on channel 10, bass, chords and lead on tracks of their
// own, bar by bar as heard) to take into a DAW, and the whole song as Strudel code: cut into
// sections, each written once as a named stack as most of its bars played it (leaving the chords
// or lead out when they don't recur), played in order with arrange().
import { NOTES } from './engine.js';
import { stepParts, wobble, beatRuns, runWeight } from './codegen.js';

const nameOf = (midi) => NOTES[((midi % 12) + 12) % 12].toLowerCase() + (Math.floor(midi / 12) - 1);

export function createTape() {
  let stretches = [], cur = null, before = null;
  const api = {
    // who(): the song playing, { name, about } (set by the app), noted with each bar, so a song
    // kept after it ended is still named after itself
    who: null,
    // A new song. down: where the bar started in the one that's ending.
    reset(down = 0) {
      const done = api.song(down);
      if (done) before = done;
      stretches = [];
      cur = null;
    },
    // The beat found (or found again at a new tempo): beats are numbered afresh, a new stretch.
    // down: where the bar started in the stretch before (its last word on that).
    lock(bpm, down) {
      if (cur) cur.down = down;
      cur = { bpm, bars: [], harmony: [], moved: 0, down: 0 };
      stretches.push(cur);
    },
    tempo(bpm) { if (cur) cur.bpm = bpm; },
    // The engine moved its beat by this many beats (it found it was a 16th or two off): what came
    // before was on a beat this far off.
    shift(beats) { if (cur) cur.moved += beats; },
    // A bar starting at beat beat0 and the patterns playing in it: { id: [16 on/off] or null },
    // the lead's as { on, tok } (its notes, 0-11).
    pattern(beat0, parts) {
      if (!cur) return;
      cur.bars.push({ b: beat0 + cur.moved, parts });
      cur.who = api.who?.() || cur.who;
    },
    // wob: the bass's filter sweeps a beat in that bar (2, 3, 4), or 0 (engine.js: wobbleCheck);
    // beats: its bass notes by the beat (4, null where none: engine.js bassTrack), or null
    harmony(beat0, chord, bass, wob = 0, beats = null) {
      if (cur) cur.harmony.push({ b: beat0 + cur.moved, chord: chord && { root: chord.root, third: chord.third, name: chord.name }, bass, wob, beats });
    },
    // The longest stretch as bars from its first: { bpm, bars: [{ parts, chord, bass }], who }; the
    // song before if this one hasn't 4 bars yet; or null. down: where the bar starts now (for the
    // stretch still going).
    song(down) {
      let best = null;
      for (const st of stretches) if (!best || st.bars.length > best.bars.length) best = st;
      if (!best || best.bars.length < 4) return before;
      const d = best === cur ? down : best.down, off = best.moved;
      const map = new Map(), at = (bar) => { let x = map.get(bar); if (!x) map.set(bar, (x = { parts: {}, chord: null, bass: null })); return x; };
      // A bar recorded before the beat or bar line moved sits k 16ths off the final bar i;
      // turn a copy of its 16 steps by k (as relabel() did live) so the whole song lines up.
      const rot = (a, k) => {
        if (!a) return a;
        const out = new Array(16);
        for (let s = 0; s < 16; s++) out[(s + k + 16) % 16] = a[s];
        return out;
      };
      for (const r of best.bars) {
        const s0 = Math.round((r.b - off - d) * 4), i = Math.round(s0 / 16), k = s0 - 16 * i;
        const parts = {};
        for (const [id, v] of Object.entries(r.parts)) parts[id] = v && (id === 'vox' ? { on: rot(v.on, k), tok: rot(v.tok, k) } : rot(v, k));
        at(i).parts = parts;
      }
      for (const r of best.harmony) {
        const b0 = r.b - off - d, i = Math.floor((b0 + 2) / 4), x = at(i); // the bar its middle falls in
        if (r.chord) x.chord = r.chord;
        if (r.bass) x.bass = r.bass;
        if (r.wob) x.wob = r.wob;
        // (its beats turned by as many beats as the bar line moved since, as the steps are)
        if (r.beats) { const k = Math.round(b0 - 4 * i); x.beats = r.beats.map((_, j) => r.beats[(((j - k) % 4) + 4) % 4]); }
      }
      const keys = [...map.keys()], first = Math.min(...keys), last = Math.max(...keys);
      const bars = [];
      for (let b = first; b <= last; b++) bars.push(map.get(b) || { parts: {}, chord: null, bass: null });
      return { bpm: best.bpm, bars, who: best.who || null };
    },
  };
  return api;
}

// ---------------------------------------------------------------- MIDI

const PPQ = 96; // ticks a beat
// General MIDI drums (kick, hand clap, closed and open hat) and how hard each is hit
const DRUM = { bd: [36, 110], sd: [39, 100], hhc: [42, 70], hho: [46, 80] };
function vlq(n) {
  const out = [n & 0x7f];
  while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80);
  return out;
}
const text = (s) => [...new TextEncoder().encode(s)];
// One track from [tick, ...bytes] events (in time order, a note's end before the next one starts).
function track(events) {
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const bytes = [];
  let now = 0;
  for (const [tick, ...ev] of events) { bytes.push(...vlq(tick - now), ...ev); now = tick; }
  bytes.push(0, 0xff, 0x2f, 0); // end of track
  const n = bytes.length;
  return [...text('MTrk'), (n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255, ...bytes];
}
const named = (name) => [0, 0xff, 0x03, ...vlq(text(name).length), ...text(name)];

export function songMidi(song, title) {
  const bar = 4 * PPQ, step = PPQ / 4;
  const tempo = Math.round(60e6 / song.bpm);
  const meta = [[0, 0xff, 0x51, 3, (tempo >> 16) & 255, (tempo >> 8) & 255, tempo & 255], [0, 0xff, 0x58, 4, 4, 2, 24, 8]];
  const note = (list, ch, t, len, n, v) => { list.push([t + len, 0x80 | ch, n, 0], [t, 0x90 | ch, n, v]); };
  const drums = [], bass = [], chords = [], lead = [];
  song.bars.forEach((b, i) => {
    const t0 = i * bar, p = b.parts;
    for (const id in DRUM) p[id]?.forEach((on, s) => { if (on) note(drums, 9, t0 + s * step, step, DRUM[id][0], DRUM[id][1]); });
    p.vox?.on.forEach((on, s) => { const pc = +p.vox.tok[s]; if (on && Number.isFinite(pc)) note(lead, 2, t0 + s * step, step, 72 + pc, 90); });
    if (b.chord) {
      const r = 48 + b.chord.root;
      for (const n of [r, r + b.chord.third, r + 7]) note(chords, 1, t0, bar, n, 70);
    }
    // the bar's bass notes (by the beat, where the bass moves in it) on the steps the bass line
    // plays (each held to the next, up to a beat), or each held through its beats
    const runs = beatRuns(b.beats);
    if (b.bass || runs) {
      const noteAt = (s) => (runs ? runs.find((r) => r.beats.includes(s >> 2)).m : b.bass);
      const on = p.bass ? [...p.bass.keys()].filter((s) => p.bass[s]) : [];
      if (on.length) on.forEach((s, k) => note(bass, 0, t0 + s * step, Math.min(PPQ, ((on[k + 1] ?? 16) - s) * step), noteAt(s), 95));
      else if (runs) runs.forEach((r) => note(bass, 0, t0 + r.beats[0] * PPQ, r.beats.length * PPQ, r.m, 95));
      else note(bass, 0, t0, bar, b.bass, 95);
    }
  });
  const tracks = [
    track([...meta, named(title)]),
    track([named('drums'), ...drums]),
    track([named('bass'), ...bass]),
    track([named('chords'), ...chords]),
    track([named('lead'), ...lead]),
  ];
  const head = [...text('MThd'), 0, 0, 0, 6, 0, 1, 0, tracks.length, 0, PPQ];
  return new Uint8Array([...head, ...tracks.flat()]);
}

// ---------------------------------------------------------------- Strudel

const DRUMS = ['bd', 'sd', 'hhc', 'hho'];
const TOKEN = { bd: 'bd', sd: 'cp', hhc: 'hh', hho: 'oh' };
const TOL = 0.35, MAXBARS = 16, CHORD_CONF = 0.6, LEAD_CONF = 0.5;

// (a bar's steps for a part, worked out once per export (songSections starts it afresh): the
// sections ask for them over and over, and a three-hour set took two seconds to write out)
let stepMemo = new WeakMap();
const steps = (b, p) => {
  let m = stepMemo.get(b);
  if (!m) stepMemo.set(b, (m = {}));
  if (m[p]) return m[p];
  const v = b.parts?.[p === 'bassrhythm' ? 'bass' : p];
  return (m[p] = Array.from({ length: 16 }, (_, s) => !!v?.[s]));
};
const has = (b, p) => {
  if (p === 'bass') return b.bass != null || !!b.beats;
  if (p === 'chords') return b.chord != null;
  if (p === 'lead') return !!b.parts?.vox?.on?.some(Boolean);
  return steps(b, p).some(Boolean);
};
const present = (block, p) => block.filter((b) => has(b, p)).length >= Math.ceil(block.length / 2);

// The most common value (and how many times it came up), with ties broken by the first seen.
function mostCommon(values) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  let best = null, top = 0;
  for (const [v, c] of counts) if (c > top) { best = v; top = c; }
  return top ? [best, top] : null;
}

// Per bar position in the 4-bar block: a step is on if it's on in at least half that position's
// bars; a single bar repeated for all positions if that fits the section's bars about as well.
function grid(byPos, p) {
  const allb = byPos.flat();
  const one = Array.from({ length: 16 }, (_, s) => allb.filter((b) => steps(b, p)[s]).length * 2 >= allb.length);
  const four = byPos.map((pos) => (pos.length ? Array.from({ length: 16 }, (_, s) => pos.filter((b) => steps(b, p)[s]).length * 2 >= pos.length) : one.slice()));
  const miss = (g) => byPos.reduce((sum, pos, j) => sum + pos.reduce((m, b) => {
    const st = steps(b, p);
    return m + g[j].reduce((d, on, s) => d + (st[s] !== on), 0);
  }, 0), 0);
  const g1 = byPos.map(() => one.slice());
  return miss(g1) <= miss(four) + 0.5 * allb.length ? g1 : four;
}

function sectionLoop(blocks) {
  const n = Math.max(...blocks.map((b) => b.length));
  const byPos = Array.from({ length: n }, (_, j) => blocks.filter((blk) => j < blk.length).map((blk) => blk[j]));
  const allb = blocks.flat();
  const written = (p) => blocks.filter((blk) => present(blk, p)).length * 2 >= blocks.length;
  const drums = {};
  for (const p of DRUMS) if (written(p)) drums[p] = grid(byPos, p);
  let bass = null, bassBeats = null, bassRhythm = null, wob = 0;
  if (written('bass')) {
    const overall = mostCommon(allb.filter((b) => b.bass != null).map((b) => b.bass));
    bass = byPos.map((pos) => {
      const c = mostCommon(pos.filter((b) => b.bass != null).map((b) => b.bass));
      return c && c[1] * 2 >= pos.length ? c[0] : (overall ? overall[0] : null);
    });
    // and where the bass moves in the bar, its notes by the beat: each beat's as most of the
    // position's bars had it (a bar with no beats counting its one note on all four)
    bassBeats = byPos.map((pos, j) => {
      const beats = [0, 1, 2, 3].map((k) => {
        const c = mostCommon(pos.map((b) => beatRuns(b.beats)?.find((r) => r.beats.includes(k)).m ?? b.bass).filter((m) => m != null));
        return c && c[1] * 2 >= pos.length ? c[0] : bass[j];
      });
      return beats.every((m) => m === beats[0]) ? null : beats;
    });
    if (!bassBeats.some(Boolean)) bassBeats = null;
    bassRhythm = grid(byPos, 'bassrhythm');
    wob = mostCommon(allb.map((b) => b.wob || 0))[0];
  }
  // Chords and lead: votes at each bar position across the section's blocks; whether the song's
  // chords or lead actually repeat enough to keep is decided across the whole song afterwards.
  let cr = 0, cm = 0;
  const ch = byPos.map((pos) => {
    const names = pos.filter((b) => b.chord).map((b) => b.chord.name);
    cr += names.length;
    const c = mostCommon(names);
    if (c) cm += c[1];
    return c ? c[0] : null;
  });
  let lr = 0, lm = 0;
  const ld = byPos.map((pos) => {
    const bar = {};
    for (let s = 0; s < 16; s++) {
      const notes = [];
      for (const b of pos) {
        const v = b.parts?.vox;
        if (v?.on?.[s]) notes.push(v.tok[s]);
      }
      lr += notes.length;
      const c = mostCommon(notes);
      if (c && c[1] * 2 >= pos.length) { bar[s] = c[0]; lm += c[1]; }
    }
    return bar;
  });
  return {
    bars: n,
    drums,
    bassRhythm,
    bass,
    bassBeats,
    wob,
    chords: null,
    lead: null,
    _chords: written('chords') ? ch : null,
    _chordVotes: blocks.length >= 2 ? [cm, cr] : [0, 0],
    _lead: written('lead') ? ld : null,
    _leadVotes: blocks.length >= 2 ? [lm, lr] : [0, 0],
  };
}

function mismatch(a, b) {
  let diff = 0, tot = 0;
  for (const p of [...DRUMS, 'bassrhythm']) {
    const x = p === 'bassrhythm' ? a.bassRhythm : a.drums[p];
    const y = p === 'bassrhythm' ? b.bassRhythm : b.drums[p];
    for (let j = 0; j < a.bars; j++) {
      for (let s = 0; s < 16; s++) {
        const u = !!x?.[j]?.[s], v = !!y?.[j]?.[s];
        if (u || v) tot++;
        if (u !== v) diff++;
      }
    }
  }
  return diff / Math.max(1, tot);
}

function samePart(a, b) {
  if (a.bars !== b.bars) return false;
  if (DRUMS.filter((p) => p in a.drums).join(',') !== DRUMS.filter((p) => p in b.drums).join(',')) return false;
  for (const k of ['bass', 'bassBeats', 'wob', 'chords', 'lead']) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) return false;
  }
  return mismatch(a, b) <= TOL;
}

// Cuts the song into sections of up to 16 bars where the same instruments play, takes the pattern,
// bass, chords and lead most of each section's bars played, drops chord or lead lines that never
// repeat across the song (a growling bass misread as chords or lead), and reuses earlier parts when
// a section returns.
export function songSections(song) {
  stepMemo = new WeakMap();
  const bars = song.bars || [];
  const blocks = [];
  for (let i = 0; i < bars.length; i += 4) blocks.push(bars.slice(i, i + 4));
  const sig = (blk) => [...['bd', 'sd', 'bass'].filter((p) => present(blk, p)), ...(present(blk, 'hhc') || present(blk, 'hho') ? ['hats'] : [])].join(',');
  const raw = [];
  let cur = [];
  for (const blk of blocks) {
    if (cur.length && (sig(blk) !== sig(cur[cur.length - 1]) || cur.length * 4 >= MAXBARS || blk.length !== cur[cur.length - 1].length)) {
      raw.push(cur);
      cur = [];
    }
    cur.push(blk);
  }
  if (cur.length) raw.push(cur);
  const loops = raw.map(sectionLoop);
  let cm = 0, cr = 0, lm = 0, lr = 0;
  for (const L of loops) {
    cm += L._chordVotes[0]; cr += L._chordVotes[1];
    lm += L._leadVotes[0]; lr += L._leadVotes[1];
  }
  const chordConf = cr ? cm / cr : 0;
  const leadConf = lr ? lm / lr : 0;
  for (const L of loops) {
    if (chordConf >= CHORD_CONF && L._chords && L._chords.some(Boolean)) L.chords = L._chords;
    if (leadConf >= LEAD_CONF && L._lead && L._lead.some((b) => Object.keys(b).length > 0)) L.lead = L._lead;
    delete L._chords; delete L._chordVotes; delete L._lead; delete L._leadVotes;
  }
  const parts = [], sections = [];
  let start = 0;
  for (let i = 0; i < loops.length; i++) {
    const L = loops[i], len = raw[i].reduce((s, blk) => s + blk.length, 0);
    let part = parts.findIndex((r) => samePart(r, L));
    if (part < 0) { part = parts.length; parts.push(L); }
    sections.push({ start, bars: len, part });
    start += len;
  }
  return { sections, parts, chordConf, leadConf };
}

// Four values as <a b c d>, repeats written with ! (<e2!2 c2 d2>); one if they're all the same.
function slots(values) {
  if (values.every((v) => v === values[0])) return values[0];
  const out = [];
  for (let i = 0; i < values.length;) {
    let j = i + 1;
    while (j < values.length && values[j] === values[i]) j++;
    out.push(values[i] + (j - i > 1 ? '!' + (j - i) : ''));
    i = j;
  }
  return `<${out.join(' ')}>`;
}
// A bar's 16 steps (tokens or null) as mini-notation, or ~ for an empty bar.
const barText = (tok) => stepParts(tok)?.map((p) => p.text).join('') ?? '~';
// Four bars of a part: the one pattern if they're all the same, else each in turn.
function fourBars(texts) {
  if (texts.every((x) => x === texts[0])) return texts[0];
  return `<${texts.map((x) => (/\s/.test(x) ? `[${x}]` : x)).join(' ')}>`;
}

// The code for 4 bars (or fewer, at the end), one line a part, or null if nothing plays in them.
function blockCode(four) {
  const lines = [];
  for (const id of ['bd', 'sd', 'hhc', 'hho']) {
    if (!four.some((b) => b.parts[id]?.some(Boolean))) continue;
    const texts = four.map((b) => barText((b.parts[id] || []).map((on) => (on ? TOKEN[id] : null)).concat(new Array(16).fill(null)).slice(0, 16)));
    lines.push(`s("${fourBars(texts)}").bank("RolandTR909")${id === 'hhc' ? '.gain(.5)' : id === 'hho' ? '.gain(.4)' : ''}`);
  }
  if (four.some((b) => b.bass || b.beats)) {
    // (a bar whose bass moves, by the beat: [d2 a1], [bb1@3 a1], as the live code writes it)
    const notes = slots(four.map((b) => {
      const runs = beatRuns(b.beats);
      if (runs?.length > 1) return '[' + runs.map((r) => nameOf(r.m) + runWeight(runs, r)).join(' ') + ']';
      return runs ? nameOf(runs[0].m) : b.bass ? nameOf(b.bass) : '~';
    }));
    // the bass line's rhythm, as the live code writes it (.struct), bar by bar: different ones go in
    // turn (<...>), as the notes do, so changing rhythms aren't lost (they were, unless all four
    // bars had the same one). A bar without one (or only the downbeat) has its note held all bar.
    const rhythm = four.map((b) => (b.parts.bass?.some((on, s) => on && s) ? barText(b.parts.bass.map((on) => (on ? 'x' : null))) : 'x'));
    const struct = rhythm.some((r) => r !== 'x') ? `.struct("${fourBars(rhythm)}")` : '';
    // (a wobble as most of the 4 bars had one, if at least two did)
    const wobs = four.map((b) => b.wob || 0).filter(Boolean), count = (r) => wobs.filter((w) => w === r).length;
    const wob = wobs.length >= 2 ? [3, 4].reduce((best, r) => (count(r) > count(best) ? r : best), 2) : 0;
    lines.push(`note("${notes}")${struct}.s("sawtooth").lpf(${wob ? 400 : 800})${wobble(wob)}`);
  }
  if (four.some((b) => b.chord)) lines.push(`chord("${slots(four.map((b) => b.chord?.name ?? '~'))}").voicing().s("supersaw").lpf(2000).gain(.6)`);
  if (four.some((b) => b.parts.vox?.on.some(Boolean))) {
    const texts = four.map((b) => {
      const v = b.parts.vox;
      return barText(Array.from({ length: 16 }, (_, s) => { const pc = +v?.tok[s]; return v?.on[s] && Number.isFinite(pc) ? NOTES[pc].toLowerCase() + '5' : null; }));
    });
    lines.push(`note("${fourBars(texts)}").s("triangle").clip(1)`);
  }
  return lines.length ? lines : null;
}

// Synthetic bars for a section's part, so blockCode writes it just as it wrote 4 raw bars.
function partBars(P) {
  return Array.from({ length: P.bars }, (_, j) => {
    const parts = {};
    for (const id of DRUMS) if (P.drums[id]) parts[id] = P.drums[id][j];
    if (P.bassRhythm) parts.bass = P.bassRhythm[j];
    if (P.lead) {
      const m = P.lead[j];
      parts.vox = { on: Array.from({ length: 16 }, (_, s) => s in m), tok: Array.from({ length: 16 }, (_, s) => m[s] ?? null) };
    }
    return {
      parts,
      chord: P.chords?.[j] ? { name: P.chords[j] } : null,
      bass: P.bass ? P.bass[j] : null,
      beats: P.bassBeats ? P.bassBeats[j] : null,
      wob: P.wob,
    };
  });
}

export function songStrudel(song, about) {
  const S = songSections(song);
  const named = [], names = [];
  for (const P of S.parts) {
    const code = blockCode(partBars(P));
    if (code) {
      const name = String.fromCharCode(65 + (named.length % 26)) + (named.length >= 26 ? Math.floor(named.length / 26) : '');
      named.push([name, code]);
      names.push(name);
    } else names.push('silence'); // (Strudel's own: nothing playing)
  }
  if (!named.length) return null;
  const order = [];
  for (const sec of S.sections) {
    const name = names[sec.part], prev = order[order.length - 1];
    if (prev?.name === name) prev.bars += sec.bars;
    else order.push({ name, bars: sec.bars });
  }
  const out = [
    `// ${about}, decompiled by toaster: the song in sections, each written once as most of its`,
    '// bars played it and named, then played in order. ctrl+enter plays it, ctrl+. stops.',
    `setcpm(${Math.round(song.bpm)}/4)`,
    '',
  ];
  for (const [name, code] of named) out.push(`const ${name} = stack(`, ...code.map((l) => `  ${l},`), ')', '');
  out.push(`$: arrange(${order.map((o) => `[${o.bars}, ${o.name}]`).join(', ')})`);
  return out.join('\n') + '\n';
}
