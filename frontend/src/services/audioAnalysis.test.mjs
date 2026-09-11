import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEnvelope, makeAudioAnalyser, registerAudioAnalysis, smoothAudioValue } from './audioAnalysis.ts';

function signal(hz, amplitude = 0.35) {
  const frequency = new Uint8Array(1024);
  frequency.fill(180, Math.max(1, Math.floor(hz / (48000 / 2048)) - 1), Math.floor(hz / (48000 / 2048)) + 2);
  const waveform = Uint8Array.from({ length: 2048 }, (_, i) => Math.round(128 + Math.sin(2 * Math.PI * hz * i / 48000) * amplitude * 127));
  return { frequency, waveform };
}
function settle(envelope, source, active = true) {
  for (let i = 0; i < 240; i++) envelope.update(source.frequency, source.waveform, 48000, 2048, 1 / 60, active);
  return envelope.levels;
}

test('different frequencies light different bands and switching tracks releases the old band', () => {
  const envelope = createAudioEnvelope();
  const bass = settle(envelope, signal(100));
  assert.ok(bass.bass > 0.2);
  assert.ok(bass.treble < 0.01);
  const firstBands = [...bass.bands];
  const treble = settle(envelope, signal(8000));
  assert.ok(treble.bass < 0.01);
  assert.ok(treble.treble > 0);
  assert.notDeepEqual(treble.bands, firstBands);
});

test('quiet and loud passages retain dynamics without peak normalization saturation', () => {
  const quiet = settle(createAudioEnvelope(), signal(500, 0.06)).energy;
  const medium = settle(createAudioEnvelope(), signal(500, 0.3)).energy;
  const loud = settle(createAudioEnvelope(), signal(500, 0.8)).energy;
  assert.ok(quiet < medium && medium < loud);
  assert.ok(loud < 0.95);
});

test('pause and silence decay to rest instead of inventing a beat', () => {
  const envelope = createAudioEnvelope();
  settle(envelope, signal(100));
  const paused = settle(envelope, signal(100), false);
  for (const name of ['bass', 'vocal', 'mid', 'treble', 'energy', 'beat']) assert.ok(paused[name] < 0.002, name);
  const silence = settle(envelope, signal(100, 0));
  assert.ok(silence.bands.every(value => value < 0.002));
});

test('envelope timing is stable at 30 and 120 fps', () => {
  const evaluate = fps => { let value = 0; for (let i = 0; i < fps; i++) value = smoothAudioValue(value, 0.8, 1 / fps); return value; };
  assert.ok(Math.abs(evaluate(30) - evaluate(120)) < 0.0001);
});

test('analyser shares the registered media graph and disposal keeps playback connected', () => {
  const audio = {};
  const taps = [];
  const disconnected = [];
  const output = { connect(node) { taps.push(node); }, disconnect(node) { assert.ok(node); disconnected.push(node); } };
  const context = { state: 'running', createAnalyser() { return { frequencyBinCount: 1024, disconnect() {} }; } };
  assert.equal(makeAudioAnalyser(audio), null);
  registerAudioAnalysis(audio, context, output);
  const first = makeAudioAnalyser(audio);
  const second = makeAudioAnalyser(audio);
  first.dispose();
  assert.deepEqual(disconnected, [first.analyser]);
  assert.equal(second.context, context);
  assert.equal(taps.length, 2);
  assert.equal(context.state, 'running');
  second.dispose();
});

test('one onset emits one beat event, with consistent impact across display refresh rates', () => {
  const peaks = [30, 60, 120, 144].map(fps => {
    const envelope = createAudioEnvelope();
    const source = signal(100);
    let peak = 0;
    for (let i = 0; i < fps * 2; i++) {
      const value = envelope.update(source.frequency, source.waveform, 48000, 2048, 1 / fps, true);
      peak = Math.max(peak, value.beat);
    }
    assert.equal(envelope.levels.beatId, 1);
    return peak;
  });
  assert.ok(Math.min(...peaks) > 0.08);
  assert.ok(Math.max(...peaks) / Math.min(...peaks) < 1.15);
});

test('passive capture does not create a media element source or connect to speakers', async () => {
  const {capturePlaybackAnalyser}=await import('./audioAnalysis.ts');
  const priorWindow=globalThis.window;
  const calls={capture:0,closed:0,stopped:0,disconnect:0};
  const track={readyState:'live',stop(){calls.stopped++;this.readyState='ended'}};
  const stream={getTracks:()=>[track],getAudioTracks:()=>[track]};
  const analyser={frequencyBinCount:1024,disconnect(){calls.disconnect++}};
  class Context {
    createMediaElementSource(){assert.fail('must preserve native audio routing')}
    createMediaStreamSource(value){assert.equal(value,stream);return{connect(node){assert.equal(node,analyser)},disconnect(){calls.disconnect++}}}
    createAnalyser(){return analyser}
    close(){calls.closed++;return Promise.resolve()}
  }
  globalThis.window={AudioContext:Context};
  try {
    const audio={paused:true,readyState:4,captureStream(){calls.capture++;return stream}};
    assert.equal(capturePlaybackAnalyser(audio),null);
    assert.equal(calls.capture,0);
    audio.paused=false;
    const tap=capturePlaybackAnalyser(audio);
    assert.ok(tap.isAlive());
    tap.dispose();
    assert.equal(audio.paused,false);
    assert.equal(calls.closed,1);
    assert.equal(calls.stopped,1);
    assert.equal(calls.disconnect,2);
  } finally {globalThis.window=priorWindow}
});

test('capture errors fall back without throwing or touching playback', async () => {
  const {capturePlaybackAnalyser}=await import('./audioAnalysis.ts');
  const priorWindow=globalThis.window;
  globalThis.window={AudioContext:class{}};
  try {
    const audio={paused:false,readyState:4,captureStream(){throw Error('capture denied')}};
    assert.equal(capturePlaybackAnalyser(audio),null);
    assert.equal(audio.paused,false);
  } finally {globalThis.window=priorWindow}
});
