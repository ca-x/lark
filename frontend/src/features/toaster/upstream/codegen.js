// Writes what the engine hears as Strudel code, the way it's performed live: named lines (kick:,
// clap:, hhc:, hho:, bassline:, chords:, vox:), mini-notation with ! for repeats, and knob numbers.
// Every line is a list of parts; a part that plays steps (or bars) knows which, for highlighting.
import { NOTES } from './engine.js';

// 16 steps of tokens (null = rest) as mini-notation, as compact as the pattern allows.
export function stepParts(tok) {
  if (!tok.some((x) => x !== null)) return null;
  let p = 16;
  for (const cand of [4, 8]) if (tok.every((x, s) => x === tok[s % cand])) { p = cand; break; }
  let r = 1;
  for (const cand of [4, 2]) if (cand <= p && tok.every((x, s) => x === null || s % cand === 0)) { r = cand; break; }
  const n = p / r, reps = 16 / p;
  const toks = Array.from({ length: n }, (_, i) => tok[i * r] ?? '~');
  const stepsOf = (i) => Array.from({ length: reps }, (_, k) => i * r + k * p);
  const parts = [];
  const sep = () => parts.length && parts.push({ text: ' ' });
  if (toks.every((x) => x === toks[0] && x !== '~')) {
    const all = [];
    for (let s = 0; s < 16; s++) if (tok[s] !== null) all.push(s);
    parts.push({ text: toks[0], steps: all });
    if (all.length > 1) parts.push({ text: '*' + all.length });
  } else if (reps === 2 && n <= 4) {
    for (let k = 0; k < 2; k++) toks.forEach((tk, i) => { sep(); parts.push({ text: tk, steps: tk === '~' ? null : [i * r + k * p] }); });
  } else if (reps > 1) {
    parts.push({ text: '[' });
    toks.forEach((tk, i) => { if (i) parts.push({ text: ' ' }); parts.push({ text: tk, steps: tk === '~' ? null : stepsOf(i) }); });
    parts.push({ text: ']*' + reps });
  } else if (r === 1) {
    for (let b = 0; b < 4; b++) {
      sep();
      parts.push({ text: '[' });
      for (let i = 0; i < 4; i++) {
        const s = b * 4 + i;
        if (i) parts.push({ text: ' ' });
        parts.push({ text: tok[s] ?? '~', steps: tok[s] === null ? null : [s] });
      }
      parts.push({ text: ']' });
    }
  } else {
    toks.forEach((tk, i) => { sep(); parts.push({ text: tk, steps: tk === '~' ? null : [i * r] }); });
  }
  return parts;
}

// Four bars of values as <a b c d>, writing repeats with ! (<e2!2 c2 d2>), the way live coders do.
function slotParts(values) {
  if (!values.some(Boolean)) return null;
  if (values.every((x) => x === values[0])) return [{ text: values[0], slots: [0, 1, 2, 3] }];
  const parts = [{ text: '<' }];
  for (let i = 0; i < 4;) {
    let j = i + 1;
    while (j < 4 && values[j] === values[i]) j++;
    if (parts.length > 1) parts.push({ text: ' ' });
    const slots = Array.from({ length: j - i }, (_, k) => i + k);
    parts.push({ text: (values[i] || '~') + (j - i > 1 ? '!' + (j - i) : ''), slots: values[i] ? slots : null });
    i = j;
  }
  parts.push({ text: '>' });
  return parts;
}

// A bar's bass notes by the beat (4 MIDI notes, null where there's none: see engine.js bassTrack) as
// runs of one note, [{ m, beats }], each held till the next. A beat without a note keeps the one
// before it (the bar's first beats, its first note). null if the bar has none.
export function beatRuns(beats) {
  if (!beats?.some((m) => m !== null)) return null;
  const runs = [];
  let cur = beats.find((m) => m !== null);
  beats.forEach((m, k) => {
    if (m !== null) cur = m;
    const last = runs[runs.length - 1];
    if (last?.m === cur) last.beats.push(k);
    else runs.push({ m: cur, beats: [k] });
  });
  return runs;
}
// A run's length in the bar's mini-notation: [a b] when the runs are even, [a@3 b] when not.
export const runWeight = (runs, r) => (runs.every((x) => x.beats.length === runs[0].beats.length) || r.beats.length === 1 ? '' : '@' + r.beats.length);

// The bass line's notes for the 4 bars: each bar's note, or where the bass moves within the bar its
// notes by the beat (beatRuns: <c2 [c2@3 g1]>, the second bar c2 for three beats, then g1). Repeated
// bars are written with !, as slotParts. Each note knows its bars (slots) and, within a moving bar,
// its beats, for highlighting.
function bassParts(eng) {
  const name = (m) => NOTES[m % 12].toLowerCase() + (Math.floor(m / 12) - 1);
  const bars = eng.slots.map((s, slot) => {
    const runs = beatRuns(eng.bassBeats?.[slot]);
    if (!runs) return s?.bass ? [{ name: s.bass, beats: null }] : null;
    return runs.length === 1 ? [{ name: name(runs[0].m), beats: null }] : runs.map((r) => ({ name: name(r.m), beats: r.beats, w: runWeight(runs, r) }));
  });
  if (!bars.some(Boolean)) return null;
  const text = (b) => (!b ? '~' : b.length === 1 ? b[0].name : '[' + b.map((r) => r.name + r.w).join(' ') + ']');
  const texts = bars.map(text);
  const barParts = (b, slots) => {
    if (!b) return [{ text: '~' }];
    if (b.length === 1) return [{ text: b[0].name, slots }];
    const out = [{ text: '[' }];
    b.forEach((r, i) => {
      if (i) out.push({ text: ' ' });
      out.push({ text: r.name, slots, beats: r.beats });
      if (r.w) out.push({ text: r.w });
    });
    out.push({ text: ']' });
    return out;
  };
  if (texts.every((x) => x === texts[0])) return barParts(bars[0], [0, 1, 2, 3]);
  // two bars taking turns: <a b>
  if (texts[0] === texts[2] && texts[1] === texts[3]) return [{ text: '<' }, ...barParts(bars[0], [0, 2]), { text: ' ' }, ...barParts(bars[1], [1, 3]), { text: '>' }];
  const parts = [{ text: '<' }];
  for (let i = 0; i < 4;) {
    let j = i + 1;
    while (j < 4 && texts[j] === texts[i]) j++;
    if (parts.length > 1) parts.push({ text: ' ' });
    parts.push(...barParts(bars[i], Array.from({ length: j - i }, (_, k) => i + k)));
    if (j - i > 1) parts.push({ text: '!' + (j - i) });
    i = j;
  }
  parts.push({ text: '>' });
  return parts;
}

// "The Weeknd" -> TheWeeknd, for the x = x.Artist("Song") header.
function ident(name) {
  const words = String(name || '').normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/).filter(Boolean);
  const id = words.map((w) => w[0].toUpperCase() + w.slice(1)).join('');
  return !id ? 'Unknown' : /^\p{N}/u.test(id) ? '_' + id : id;
}
function cleanTitle(title) {
  const t = String(title || '')
    .replace(/\p{Extended_Pictographic}|\uFE0F|\u200D/gu, ' ')
    .replace(/["\\]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > 44 ? t.slice(0, 43).trimEnd() + '…' : t || 'untitled';
}
const fmt = (x) => String(+x.toFixed(1)).replace(/^0\./, '.');
// A filter on a slider, the way it gets swept live: Strudel draws a slider in the code for
// slider(value, min, max), and the code view slides the number when the value moves.
const slider = (v, lo, hi) => ({ text: `slider(${v}, ${lo}, ${hi})`, slider: [lo, hi] });

// With the chords pumping under the kick (sidechain), the kick ducks the bass line's orbit (2)
// and the chords' (3): .duck("2:3").
const DRUMS = {
  bd: { label: 'kick', token: 'bd', tail: (k, eng) => '.bank("RolandTR909")' + (eng.ducking ? `.duck("2:3").duckdepth(${fmt(eng.duckDepth)})` : '') },
  sd: { label: 'clap', token: 'cp', tail: () => '.bank("RolandTR909").room(.2)' },
  hhc: { label: 'hhc', token: 'hh', tail: (k) => `.bank("RolandTR909").gain(${fmt(k.hhGain)})` },
  hho: { label: 'hho', token: 'oh', tail: () => '.bank("RolandTR909").gain(.4)' },
};
const lastBody = {};

// The code's drum lines change more calmly than the patterns learned, which follow the hits bar by
// bar: a pattern a step or two off the one written (a ghost note in and out, a kick a 16th over)
// is written once it has held two more bars; a bigger change (a new section) at once. On six whole
// songs from a recording (Oct 15) the kick and clap lines changed half as often, mostly a step
// coming and going, and matched the bars' hits as well. (Only the code: the blocks, the export and
// the test songs see the patterns as learned. Holding them back in the engine kept out a pop kick
// it only catches some bars.)
const written = {};
function calm(id, on, bar) {
  if (!on || bar === null) return on;
  const w = written[id];
  if (!w) { written[id] = { on: on.slice(), cand: null, since: 0 }; return on; }
  const diff = on.reduce((n, x, s) => n + (x !== w.on[s]), 0);
  if (diff === 0) w.cand = null;
  else if (diff > 2) { w.on = on.slice(); w.cand = null; }
  else {
    const key = on.join();
    if (w.cand !== key) { w.cand = key; w.since = bar; }
    else if (bar - w.since >= 2) { w.on = on.slice(); w.cand = null; }
  }
  return w.on;
}

// A bass whose filter sweeps on the 8ths, triplets or 16ths (rate: 2, 3, 4 a beat; dubstep's
// wobble, riddim's pulse) as Strudel's filter LFO, locked to the bar (lpsync: sweeps a cycle),
// swinging the cutoff 3 times its own each way, with some resonance and grit. '' for none.
export const wobble = (rate) => (rate ? `.lpsync(${rate * 4}).lpdepth(3).lpq(6).distort(.8)` : '');

export const LINE_IDS = ['title', 'tempo', 'scale', 'bd', 'sd', 'hhc', 'hho', 'bassline', 'chords', 'vox'];

export function buildLines(eng, meta, t) {
  const out = {};
  const plain = (text) => [{ text }];
  const T = eng.tempo;
  const song = meta.song;
  out.title = plain(song?.title ? `x = x.${ident(song.artist || song.app)}("${cleanTitle(song.title)}")` : `// listening: ${meta.source || '...'}`);
  // where the song is, as a comment after the tempo: the first 4 bars of a drop, or a breakdown
  // (no kick for two bars while the music plays on; one bar came and went with every missed kick)
  const bar = T.locked ? 240 / T.bpm : 0;
  const section = !T.locked || eng.silent ? '' : t - eng.lastDrop < 4 * bar ? 'drop' : t - eng.lastKick > 2 * bar ? 'breakdown' : '';
  out.tempo = plain(T.locked ? `setcpm(${T.shown}/4)${section ? '  // ' + section : ''}` : eng.silent ? '// waiting for sound...' : '// setcpm(?)  finding the beat...');
  out.scale = plain(eng.key ? `const scale = "${NOTES[eng.key.root]}:${eng.key.mode}"` : '// const scale = "?"');

  const k = eng.knobs;
  for (const id of ['bd', 'sd', 'hhc', 'hho']) {
    const d = DRUMS[id];
    const on = calm(id, eng.v[id].shown, eng.bar);
    const body = eng.present(id, t) && on ? stepParts(on.map((x) => (x ? d.token : null))) : null;
    if (body) {
      lastBody[id] = body.map((p) => p.text).join('');
      out[id] = [{ text: `${d.label}: s("` }, ...body, { text: '")' + d.tail(k, eng) }];
    } else {
      // stopped: muted the live-coding way, a _ in front of the name (Strudel's mute); never
      // heard yet: a commented-out placeholder
      const text = `${d.label}: s("${lastBody[id] || d.token}")` + d.tail(k, eng);
      out[id] = plain(lastBody[id] ? '_' + text : '// ' + text);
    }
  }

  const vox = eng.v.vox;
  const voxBody = eng.present('vox', t) && vox.shown ? stepParts(vox.shown.map((x, s) => (x ? vox.tok[s] ?? '0' : null))) : null;
  if (voxBody) {
    lastBody.vox = voxBody.map((p) => p.text).join('');
    out.vox = [{ text: 'vox: s("vox").slice(16, "' }, ...voxBody, { text: '").clip(1)' }];
  } else {
    const text = `vox: s("vox").slice(16, "${lastBody.vox || '0'}").clip(1)`;
    out.vox = plain(lastBody.vox ? '_' + text : '// ' + text);
  }

  // Like the drums, bass and chords get muted (_) when that part stops playing.
  const line = (head, parts, tail) => [{ text: head }, ...parts, { text: tail }];
  const bass = bassParts(eng);
  const chords = slotParts(eng.slots.map((s) => s?.chord?.name || null));
  // The bass line's rhythm, once it has settled: the bar's note on the steps a bass note starts
  // (.struct, the Strudel way: note("<f2 c2>").struct("[~ ~ x ~]*4")). Just the downbeat says
  // nothing a plain note per bar doesn't.
  const rv = eng.v.bass, onSteps = rv.shown && eng.present('bass', t) ? rv.shown.map((x) => (x ? 'x' : null)) : null;
  const rhythm = onSteps && onSteps.some((x, s) => x && s) ? stepParts(onSteps) : null;
  const struct = rhythm ? [{ text: '").struct("' }, ...rhythm, { text: '")' }] : [{ text: '")' }];
  const orbit = (n) => (eng.ducking ? [{ text: `.orbit(${n})` }] : []);
  out.bassline = bass ? [{ text: 'bassline: note("' }, ...bass, ...struct, { text: '.s("sawtooth").lpf(' }, slider(k.bassLpf, 100, 4000), { text: ')' + wobble(eng.bassSound?.wobble) }, ...orbit(2)] : plain('bassline: note("~").s("sawtooth")');
  out.chords = chords ? [...line('chords: chord("', chords, '").voicing().s("supersaw").lpf('), slider(k.chordLpf, 200, 9000), { text: ')' }, ...orbit(3)] : plain('chords: chord("~").voicing()');
  const text = (parts) => parts.map((p) => p.text).join('');
  if (!bass) out.bassline = plain('// ' + text(out.bassline));
  else if (!eng.playing(eng.bassSeen, t)) out.bassline = plain('_' + text(out.bassline));
  if (!chords) out.chords = plain('// ' + text(out.chords));
  else if (!eng.playing(eng.chordSeen, t)) out.chords = plain('_' + text(out.chords));
  // hushed (a raised fist, or Q): every part muted, the way Strudel's hush() stops them all
  if (meta.hushed) {
    for (const id of ['bd', 'sd', 'hhc', 'hho', 'bassline', 'chords', 'vox']) {
      const s = text(out[id]);
      if (!s.startsWith('//') && !s.startsWith('_')) out[id] = plain('_' + s);
    }
  }
  return out;
}

export function resetCodegen() {
  for (const key of Object.keys(lastBody)) delete lastBody[key];
  for (const key of Object.keys(written)) delete written[key];
}

// The code on screen as a Strudel program to play and change at strudel.cc: parts that have
// stopped stay muted (_), the title becomes a comment, and the vox line (it plays a vocal
// sample Strudel doesn't have) is kept as a comment with the same notes on a synth under it.
// texts: each line's text, by line id.
export function strudelProgram(texts, song) {
  const about = song?.title ? `"${cleanTitle(song.title)}"${song.artist ? ' by ' + song.artist : ''}` : 'whatever was playing';
  const out = [`// ${about}, written out by toaster`, '// ctrl+enter plays it, ctrl+. stops'];
  for (const id of LINE_IDS) {
    const line = (texts[id] || '').trim();
    if (!line) continue;
    if (id === 'bd' || id === 'bassline') out.push('');
    if (id === 'title') { out.push(line.startsWith('//') ? line : '// ' + line); continue; }
    const vox = id === 'vox' && line.match(/^(\/\/ |_)?vox: s\("vox"\)\.slice\(16, "([^"]*)"\)\.clip\(1\)$/);
    if (vox) {
      // the slice numbers are the notes (0 = C ... 11 = B); not the ones after * or !
      const notes = vox[2].replace(/(?<![*!/@:.\d])\b(\d{1,2})\b/g, (n) => NOTES[+n % 12].toLowerCase() + '4');
      out.push(`// vox: s("vox").slice(16, "${vox[2]}").clip(1)   <- with a vocal sample loaded`);
      out.push(`${vox[1] || ''}vox: note("${notes}").s("triangle").clip(1)`);
      continue;
    }
    out.push(line);
  }
  out.push('', "// everything that's playing as a punchcard under the code", 'all(x => x._punchcard())');
  return out.join('\n') + '\n';
}

// A strudel.cc link that opens with the code in its editor (the REPL reads the code, UTF-8 in
// base64, from after the #).
export function strudelLink(code) {
  let bin = '';
  for (const b of new TextEncoder().encode(code)) bin += String.fromCharCode(b);
  return 'https://strudel.cc/#' + encodeURIComponent(btoa(bin));
}
