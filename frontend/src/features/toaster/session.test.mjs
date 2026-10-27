import assert from 'node:assert/strict';
import test from 'node:test';
import { Worker as NodeWorker } from 'node:worker_threads';
import { Script } from 'node:vm';
import { registerAudioAnalysis } from '../../services/audioAnalysis.ts';
import { createToasterSession, strudelLink } from './session.ts';

const workers = new Set();
class BrowserWorker {
  constructor(url) {
    this.thread = new NodeWorker(new URL('./test-worker-bridge.mjs', import.meta.url), { workerData: url.href });
    this.thread.on('message', data => this.onmessage?.({ data }));
    this.thread.on('error', error => this.onerror?.({ message: error.message, preventDefault() {} }));
    this.thread.on('messageerror', () => this.onmessageerror?.());
    workers.add(this);
  }
  postMessage(message) { this.thread.postMessage(message); }
  terminate() { workers.delete(this); void this.thread.terminate(); }
}
globalThis.Worker = BrowserWorker;
globalThis.window = {};

const meta = { mediaKey: 'a', title: '夜曲 Café', artist: '周杰伦 Björk' };
function graph(options = {}) {
  const audio = Object.assign(new EventTarget(), { paused: false, seeking: false, readyState: 4, muted: false, volume: 1, currentTime: 0 });
  const signal = { seconds: 0, audible: true, reads: 0 };
  const taps = [], disconnected = [];
  const output = {
    connect(node) { taps.push(node); options.connect?.(node, taps.length, audio); },
    disconnect(node) { assert.ok(node, 'must disconnect only its analyser branch'); disconnected.push(node); },
  };
  const context = {
    state: 'running', currentTime: 0, sampleRate: 48000,
    close() { assert.fail('must never close the shared context'); },
    createMediaElementSource() { assert.fail('must never create a media source'); },
    createAnalyser() {
      if (options.throwOnTap === taps.length + 1) throw Error('no analyser');
      return {
        fftSize: 2048, smoothingTimeConstant: 0.35, minDecibels: -100, maxDecibels: -30,
        get frequencyBinCount() { return this.fftSize / 2; },
        disconnect() { this.disposals = (this.disposals || 0) + 1; },
        getFloatTimeDomainData(data) {
          signal.reads++;
          const phase = signal.seconds % 0.5;
          const kick = Math.exp(-phase * 35) * 0.65;
          for (let i = 0; i < data.length; i++) {
            const t = signal.seconds + i / context.sampleRate;
            const audible = signal.audible && (options.pulseDuration === undefined || phase < options.pulseDuration);
            data[i] = audible ? Math.sin(2 * Math.PI * 65.4 * t) * (options.amplitude ?? (0.02 + kick)) : 0;
          }
        },
        getFloatFrequencyData(data) {
          signal.reads++;
          data.fill(-120);
          if (!signal.audible) return;
          const phase = signal.seconds % 0.5, hatPhase = signal.seconds % 0.25;
          const hz = context.sampleRate / this.fftSize;
          const fill = (lo, hi, db) => data.fill(db, Math.max(1, Math.floor(lo / hz)), Math.min(data.length, Math.ceil(hi / hz)));
          fill(40, 140, -60 + 42 * Math.exp(-phase * 35));
          fill(160, 400, -85 + 50 * Math.exp(-phase * 40));
          fill(1500, 5000, -105 + 50 * Math.exp(-(signal.seconds % 1) * 30));
          fill(7500, 14000, -110 + 55 * Math.exp(-hatPhase * 70));
          for (const note of [130.8, 164.8, 196]) data[Math.round(note / hz)] = -38;
        },
      };
    },
  };
  registerAudioAnalysis(audio, context, output);
  const sample = (session, ms, playing = true) => {
    signal.seconds = ms / 1000;
    context.currentTime = signal.seconds;
    audio.currentTime = signal.seconds;
    const snapshot = session.tick(ms, playing);
    signal.highlighted ||= snapshot.lines.some(line => line.parts.some(part => part.active));
    return snapshot;
  };
  return { audio, context, signal, taps, disconnected, sample };
}
function analyse(g, session, from, to) {
  let snapshot;
  for (let ms = from; ms <= to; ms += 1000 / 60) snapshot = g.sample(session, ms);
  return snapshot;
}
function lockByTap(g, session) {
  for (const ms of [0, 500, 1000, 1500]) {
    if (ms) analyse(g, session, ms - 500 + 1000 / 60, ms - 1);
    g.sample(session, ms); session.tap(ms);
  }
}

test('missing, partial, closed and mismatched graphs do not acquire ownership of playback', () => {
  assert.equal(createToasterSession(null, meta), null);
  assert.equal(createToasterSession(new EventTarget(), meta), null);
  const partial = graph({ throwOnTap: 2 });
  assert.equal(createToasterSession(partial.audio, meta), null);
  assert.equal(partial.taps.length, 1);
  assert.equal(partial.taps[0].disposals, 1);
  assert.deepEqual(partial.disconnected, partial.taps);
  const closed = graph(); closed.context.state = 'closed';
  assert.equal(createToasterSession(closed.audio, meta), null);
  assert.equal(closed.taps.length, 0);
  const other = graph();
  const mismatched = graph({ connect(_node, count, audio) { if (count === 1) registerAudioAnalysis(audio, other.context, { connect(node) { other.taps.push(node); }, disconnect(node) { other.disconnected.push(node); } }); } });
  assert.equal(createToasterSession(mismatched.audio, meta), null);
  assert.equal(mismatched.taps[0].disposals, 1);
  assert.ok(other.taps.every(tap => tap.disposals === 1));
});

test('three taps use upstream FFT settings and disposal is idempotent and branch-only', async () => {
  const g = graph(), session = createToasterSession(g.audio, meta);
  assert.ok(session);
  assert.deepEqual(g.taps.map(tap => tap.fftSize), [1024, 4096, 16384]);
  assert.ok(g.taps.every(tap => tap.smoothingTimeConstant === 0));
  session.dispose(); session.dispose();
  assert.deepEqual(g.disconnected, g.taps);
  assert.ok(g.taps.every(tap => tap.disposals === 1));
  assert.equal(g.context.state, 'running');
  assert.equal(await session.songFiles(), null);
  assert.equal(session.tick(1000, true).energy, 0);
});

test('paused, silent, suspended and unavailable ticks freeze bars/steps without fake activity', () => {
  const g = graph(), session = createToasterSession(g.audio, meta);
  try {
    lockByTap(g, session);
    const live = analyse(g, session, 1517, 4000);
    assert.equal(live.locked, true);
    assert.ok(live.energy > 0);
    const reads = g.signal.reads;
    const paused = g.sample(session, 30_000, false);
    assert.equal(g.signal.reads, reads);
    assert.equal(paused.bar, live.bar);
    assert.equal(paused.step, live.step);
    assert.equal(paused.recordedBars, live.recordedBars);
    assert.ok(paused.bands.every(value => value === 0));
    assert.equal(paused.energy, 0);
    g.signal.audible = false;
    const silent = g.sample(session, 60_000);
    assert.equal(silent.bar, live.bar);
    assert.equal(silent.step, live.step);
    assert.equal(silent.recordedBars, live.recordedBars);
    assert.equal(silent.beat, 0);
    g.signal.audible = true;
    const resumed = g.sample(session, 60_016);
    assert.equal(resumed.bar, live.bar);
    assert.ok(Math.abs(resumed.step - live.step) <= 1);
    g.context.state = 'suspended';
    const suspended = g.sample(session, 70_000);
    assert.equal(suspended.bar, resumed.bar);
    assert.equal(suspended.energy, 0);
    g.context.state = 'running'; g.audio.readyState = 1;
    assert.equal(g.sample(session, 80_000).energy, 0);
  } finally { session.dispose(); }
});

test('real upstream analysis exports Strudel and valid MIDI with Unicode and safe comments', async () => {
  const g = graph(), session = createToasterSession(g.audio, { ...meta, title: '夜曲 Café\nthrow Error("bad")', artist: 'Björk\r\n$evil()' });
  try {
    assert.equal(await session.songFiles(), null);
    lockByTap(g, session);
    const snapshot = analyse(g, session, 1517, 22_000);
    assert.ok(snapshot.recordedBars >= 4, JSON.stringify(snapshot));
    assert.ok(Object.values(snapshot.patterns).some(pattern => pattern.some(Boolean)));
    const code = session.code();
    new Script(code); // Parse the generated JavaScript without running it.
    assert.ok(g.signal.highlighted, 'measured patterns should highlight real code tokens');
    assert.ok(code.includes('夜曲 Café'));
    assert.ok(code.includes('Björk'));
    assert.ok(code.includes('setcpm(120/4)'));
    assert.ok(code.includes('kick: s(') || code.includes('chords: chord('));
    assert.ok(!code.split('\n').some(line => line.startsWith('throw ') || line.startsWith('$evil')));
    const link = strudelLink(code);
    assert.ok(link.startsWith('https://strudel.cc/#'));
    assert.equal(Buffer.from(decodeURIComponent(link.split('#')[1]), 'base64').toString('utf8'), code);
    const files = await session.songFiles();
    assert.ok(files);
    assert.ok(files.bars >= 4);
    assert.ok(files.code.includes('夜曲 Café'));
    new Script(files.code);
    assert.ok(files.code.includes('$: arrange('));
    assert.ok(Buffer.from(files.midi).includes(Buffer.from('夜曲 Café')));
    assert.ok(!files.code.split('\n').some(line => line.startsWith('throw ') || line.startsWith('$evil')));
    assert.equal(Buffer.from(files.midi.subarray(0, 4)).toString(), 'MThd');
    assert.deepEqual([...files.midi.subarray(4, 14)], [0, 0, 0, 6, 0, 1, 0, 5, 0, 96]);
    let offset = 14;
    for (let track = 0; track < 5; track++) {
      assert.equal(Buffer.from(files.midi.subarray(offset, offset + 4)).toString(), 'MTrk');
      const length = new DataView(files.midi.buffer, files.midi.byteOffset + offset + 4, 4).getUint32(0);
      offset += 8 + length;
      assert.deepEqual([...files.midi.subarray(offset - 4, offset)], [0, 255, 47, 0]);
    }
    assert.equal(offset, files.midi.length);
    assert.ok(files.midi.some(byte => byte === 0x99), 'measured drum notes should appear on channel 10');
  } finally { session.dispose(); }
  assert.equal(workers.size, 0);
});

test('seek, explicit reset and changed media key discard the previous tape and cancel export', async () => {
  const g = graph(), session = createToasterSession(g.audio, meta);
  try {
    lockByTap(g, session); analyse(g, session, 1517, 15_000);
    assert.ok(session.tick(15_000, true).recordedBars >= 4);
    const pending = session.songFiles();
    session.setMeta({ ...meta, mediaKey: 'b', title: '另一首' });
    assert.equal(await pending, null);
    assert.equal(await session.songFiles(), null);
    assert.equal(session.tick(15_017, false).recordedBars, 0);
    assert.ok(session.code().includes('另一首'));
    assert.ok(!session.code().includes('夜曲'));
    lockByTap(g, session); analyse(g, session, 1517, 15_000);
    g.audio.dispatchEvent(new Event('seeking'));
    assert.equal(session.tick(20_000, false).locked, false);
    assert.equal(await session.songFiles(), null);
    session.reset();
    assert.equal(session.tick(20_000, false).recordedBars, 0);
  } finally { session.dispose(); }
});


test('steady synthetic beats produce measured tempo without tap input', () => {
  const g = graph(), session = createToasterSession(g.audio, meta);
  try {
    const snapshot = analyse(g, session, 0, 30_000);
    assert.equal(snapshot.locked, true, JSON.stringify(snapshot));
    assert.ok(Math.abs(snapshot.bpm - 120) < 4, `measured ${snapshot.bpm} BPM`);
    assert.ok(snapshot.recordedBars >= 4);
    assert.ok(session.code().includes('setcpm('));
  } finally { session.dispose(); }
});


test('initial silence and muted audio do not create patterns, tempo or recorded bars', () => {
  const g = graph(), session = createToasterSession(g.audio, meta);
  try {
    g.signal.audible = false;
    const silent = analyse(g, session, 0, 10_000);
    assert.equal(silent.locked, false);
    assert.equal(silent.bpm, null);
    assert.equal(silent.bar, null);
    assert.equal(silent.recordedBars, 0);
    assert.ok(Object.values(silent.patterns).every(pattern => !pattern.some(Boolean)));
    g.signal.audible = true; g.audio.muted = true;
    const reads = g.signal.reads;
    assert.equal(g.sample(session, 20_000).energy, 0);
    assert.equal(g.signal.reads, reads);
    g.audio.muted = false; g.audio.paused = true;
    assert.equal(g.sample(session, 30_000, true).energy, 0);
    assert.equal(g.signal.reads, reads);
  } finally { session.dispose(); }
});

test('disposal cancels a pending export, releases its worker and stops all analyser reads', async () => {
  const g = graph(), session = createToasterSession(g.audio, meta);
  lockByTap(g, session); analyse(g, session, 1517, 15_000);
  const first = session.songFiles(), second = session.songFiles();
  assert.equal(first, second, 'concurrent exports share one request');
  assert.equal(workers.size, 1);
  const reads = g.signal.reads;
  session.dispose();
  assert.equal(await first, null);
  assert.equal(await second, null);
  g.sample(session, 30_000);
  assert.equal(g.signal.reads, reads);
  assert.equal(workers.size, 0);
});

test('worker failures reject the export and release recording resources', async () => {
  class FailingExportWorker extends BrowserWorker {
    postMessage(message) {
      if (message.type === 'export') queueMicrotask(() => this.onerror?.({ message: 'export failed', preventDefault() {} }));
      else super.postMessage(message);
    }
  }
  globalThis.Worker = FailingExportWorker;
  const g = graph(), session = createToasterSession(g.audio, meta);
  try {
    lockByTap(g, session); analyse(g, session, 1517, 15_000);
    await assert.rejects(session.songFiles(), /export failed/);
    assert.equal(workers.size, 0);
    assert.equal(session.tick(15_017, false).recordedBars, 0);
  } finally { session.dispose(); globalThis.Worker = BrowserWorker; }
});

test('unavailable workers preserve live analysis while full-song export stays unavailable', async () => {
  globalThis.Worker = class { constructor() { throw Error('worker blocked'); } };
  const g = graph(), session = createToasterSession(g.audio, meta);
  try {
    lockByTap(g, session);
    const snapshot = analyse(g, session, 1517, 5000);
    assert.equal(snapshot.locked, true);
    assert.ok(snapshot.energy > 0);
    assert.equal(snapshot.recordedBars, 0);
    assert.equal(await session.songFiles(), null);
    session.setMeta({ ...meta, title: 'bad\ud800title', artist: 'safe\u2028line' });
    const code = session.code();
    assert.ok(code.includes('bad�title'));
    assert.ok(!code.includes('\ud800'));
    assert.equal(Buffer.from(decodeURIComponent(strudelLink(code).split('#')[1]), 'base64').toString('utf8'), code);
  } finally { session.dispose(); globalThis.Worker = BrowserWorker; }
});

test('an export that exceeds its deadline is terminated without blocking playback', async t => {
  const g = graph(), session = createToasterSession(g.audio, meta);
  try {
    lockByTap(g, session); analyse(g, session, 1517, 15_000);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const pending = session.songFiles();
    const rejected = assert.rejects(pending, /took too long/);
    t.mock.timers.tick(60_000);
    await rejected;
    assert.equal(workers.size, 0);
    assert.equal(g.context.state, 'running');
    assert.ok(g.sample(session, 15_017).energy > 0);
  } finally { t.mock.timers.reset(); session.dispose(); }
});


test('brief silent gaps preserve real 120 BPM tap intervals and do not record silent bars', () => {
  const measured = [];
  for (const pulseDuration of [undefined, 0.2]) {
    const g = graph({ amplitude: 0.1, pulseDuration }), session = createToasterSession(g.audio, meta);
    try {
      lockByTap(g, session);
      measured.push(g.sample(session, 1501).bpm);
      const audible = g.sample(session, 1600);
      for (const ms of [1750, 1850, 1950]) {
        const silent = g.sample(session, ms);
        if (pulseDuration !== undefined) {
          assert.equal(silent.energy, 0);
          assert.equal(silent.bar, audible.bar);
          assert.equal(silent.step, audible.step);
          assert.equal(silent.recordedBars, audible.recordedBars);
        }
      }
    } finally { session.dispose(); }
  }
  assert.deepEqual(measured, [120, 120], 'silence between beats must not shorten the tap interval');
});

test('astral Unicode at the upstream title truncation boundary survives code, links and song files', async () => {
  const title = 'A'.repeat(42) + '𝄞B';
  const g = graph(), session = createToasterSession(g.audio, { ...meta, title, artist: 'Test' });
  try {
    const code = session.code();
    assert.equal(code.isWellFormed(), true, 'upstream title truncation must not split a surrogate pair');
    assert.ok(code.includes('𝄞'), 'valid Unicode must remain in generated source');
    assert.equal(Buffer.from(decodeURIComponent(strudelLink(code).split('#')[1]), 'base64').toString('utf8'), code);
    lockByTap(g, session); analyse(g, session, 1517, 15_000);
    const files = await session.songFiles();
    assert.ok(files);
    assert.equal(files.code.isWellFormed(), true);
    assert.ok(files.code.includes(title));
    assert.equal(Buffer.from(decodeURIComponent(strudelLink(files.code).split('#')[1]), 'base64').toString('utf8'), files.code);
    assert.ok(Buffer.from(files.midi).includes(Buffer.from(title)));
  } finally { session.dispose(); }
});
