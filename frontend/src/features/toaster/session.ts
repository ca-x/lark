import { createAudioEnvelope, makeAudioAnalyser } from '../../services/audioAnalysis.ts';
import type { ToasterCodeLine, ToasterMeta, ToasterSession, ToasterSnapshot } from './contracts.ts';
import { cleanMeta, codegenMeta } from './export-protocol.ts';
import { createRecording } from './recording.ts';
import { createEngine, NOTES } from './upstream/engine.js';
import { buildLines, LINE_IDS, resetCodegen, strudelProgram } from './upstream/codegen.js';
import type { CodePart } from './upstream/codegen.js';

export { strudelLink } from './upstream/codegen.js';

const FFT_SIZES = [1024, 4096, 16384] as const;
type Tap = NonNullable<ReturnType<typeof makeAudioAnalyser>>;
const disconnect = (taps: Tap[]) => {
  for (const tap of taps) {
    try { tap.dispose(); } catch { /* Keep releasing the other branches if the graph was replaced. */ }
  }
};

export function createToasterSession(audio: HTMLAudioElement | null, initialMeta: ToasterMeta): ToasterSession | null {
  if (!audio) return null;
  const taps: Tap[] = [];
  try {
    for (const size of FFT_SIZES) {
      const tap = makeAudioAnalyser(audio);
      if (!tap) throw new Error('The registered audio graph is unavailable.');
      taps.push(tap);
      if (tap.context !== taps[0].context || tap.context.state === 'closed') throw new Error('The registered audio graph changed.');
      tap.analyser.fftSize = size;
      tap.analyser.smoothingTimeConstant = 0;
    }
    return createSession(audio, taps, initialMeta);
  } catch {
    disconnect(taps);
    return null;
  }
}

function createSession(audio: HTMLAudioElement, taps: Tap[], initialMeta: ToasterMeta): ToasterSession {
  const [fast, mid, slow] = taps.map(tap => tap.analyser);
  const context = taps[0].context;
  const engine = createEngine({ fast, mid, slow, sampleRate: context.sampleRate });
  const recording = createRecording();
  const probe = new Float32Array(fast.fftSize);
  const frequency = new Uint8Array(fast.frequencyBinCount);
  const waveform = new Uint8Array(fast.fftSize);
  let meta = cleanMeta(initialMeta);
  let disposed = false;
  let active = false;
  let playbackContinuous = false;
  let sampleTime = performance.now() / 1000;
  let lastWallMs: number | null = null;
  let envelope = createAudioEnvelope();
  let rawLines: Record<string, CodePart[]> = {};
  let lines: ToasterCodeLine[] = [];

  engine.tape = recording.tape;
  engine.song = () => ({ known: Boolean(meta.mediaKey), playing: playbackContinuous });
  // The pinned engine writes these two harmonic timestamps from performance.now.
  // Translate them into the same clock as frame() so a pause cannot age the notes.
  const harmonyBar = engine.harmonyBar;
  engine.harmonyBar = bar => {
    const bassSeen = engine.bassSeen, chordSeen = engine.chordSeen;
    harmonyBar.call(engine, bar);
    if (engine.bassSeen !== bassSeen) engine.bassSeen = sampleTime;
    if (engine.chordSeen !== chordSeen) engine.chordSeen = sampleTime;
  };

  function updateLines(highlight: boolean) {
    rawLines = buildLines(engine, { song: codegenMeta(meta) }, sampleTime);
    const hitOn = (part: CodePart, id: string) => {
      const hit = id === 'hhc' || id === 'hho' ? engine.hhHit : engine.v[id]?.lastHit;
      if (!hit || !part.steps || sampleTime < hit.t || sampleTime - hit.t >= 0.13) return false;
      if (id === 'hhc' || id === 'hho') {
        const open = rawLines.hho.some(part => part.steps?.includes(hit.step));
        if ((id === 'hho') !== open) return false;
      }
      return part.steps.includes(hit.step);
    };
    const slot = engine.bar === null ? -1 : ((engine.bar % 4) + 4) % 4;
    const beat = engine.step === null ? -1 : engine.step >> 2;
    lines = LINE_IDS.map(id => {
      const parts = (rawLines[id] || []).map(part => ({
        text: part.text,
        active: highlight && (part.slots
          ? part.slots.includes(slot) && (!part.beats || part.beats.includes(beat))
          : hitOn(part, id === 'bassline' || id === 'chords' ? 'bass' : id)),
      }));
      return { id, text: parts.map(part => part.text).join(''), parts };
    });
  }
  function reset() {
    if (disposed) return;
    active = false;
    playbackContinuous = false;
    lastWallMs = null;
    sampleTime = performance.now() / 1000;
    envelope = createAudioEnvelope();
    engine.reset({ top: audio.currentTime < 1 });
    engine.resetAt = engine.lastSound = sampleTime;
    engine.silent = true;
    resetCodegen();
    updateLines(false);
  }
  function snapshot(moving: boolean): ToasterSnapshot {
    const levels = envelope.levels;
    return {
      lines: moving ? lines : lines.map(line => ({ ...line, parts: line.parts.map(part => ({ ...part, active: false })) })),
      bpm: engine.tempo.locked ? engine.tempo.shown || engine.tempo.bpm : null,
      key: engine.key ? `${NOTES[engine.key.root]} ${engine.key.mode}` : '',
      bar: engine.bar,
      step: engine.step,
      locked: engine.tempo.locked,
      energy: moving ? levels.energy : 0,
      bass: moving ? levels.bass : 0,
      treble: moving ? levels.treble : 0,
      beat: moving ? levels.beat : 0,
      bands: moving ? [...levels.bands] : Array<number>(24).fill(0),
      patterns: Object.fromEntries(Object.entries(engine.v).map(([id, voice]) => [id, voice.shown ? [...voice.shown] : Array<boolean>(16).fill(false)])),
      recordedBars: recording.bars,
    };
  }
  function rest(keepClock = false) {
    if (active) {
      // No silent engine frames are run, but the next attack must rise from the
      // measured silence rather than the spectrum left by the previous sound.
      engine.prevLg.fill(0);
      engine.prevDb.fill(-160);
      engine.prevMidMag.fill(0);
      engine.lowE = 0;
    }
    active = false;
    if (!keepClock) playbackContinuous = false;
    if (!keepClock || sampleTime - engine.lastSound > 1.2) engine.silent = true;
    envelope = createAudioEnvelope();
    return snapshot(false);
  }
  reset();
  audio.addEventListener('seeking', reset);
  audio.addEventListener('emptied', reset);

  return {
    tick(nowMs, playing) {
      if (disposed) return snapshot(false);
      const now = Number.isFinite(nowMs) ? nowMs : performance.now();
      const delta = lastWallMs === null ? 0 : Math.max(0, Math.min(0.1, (now - lastWallMs) / 1000));
      lastWallMs = now;
      if (!playing || audio.paused || audio.seeking || audio.ended || audio.muted || audio.volume === 0 || audio.readyState < 2 || context.state !== 'running') return rest();
      // Playback remains continuous across quiet beat gaps. Pause/unavailable
      // ticks break this clock so their elapsed wall time is never stitched in.
      if (playbackContinuous) sampleTime += delta;
      playbackContinuous = true;
      fast.getFloatTimeDomainData(probe);
      let sum = 0;
      for (const sample of probe) sum += sample * sample;
      if (Math.sqrt(sum / probe.length) <= 0.004) return rest(true);
      active = true;
      engine.frame(sampleTime, sampleTime);
      const range = fast.maxDecibels - fast.minDecibels;
      for (let i = 0; i < frequency.length; i++) frequency[i] = Math.max(0, Math.min(255, 255 * (engine.fastDb[i] - fast.minDecibels) / range));
      for (let i = 0; i < waveform.length; i++) waveform[i] = Math.max(0, Math.min(255, 128 + engine.time[i] * 127));
      envelope.update(frequency, waveform, context.sampleRate, fast.fftSize, delta || 1 / 60, true);
      updateLines(true);
      return snapshot(true);
    },
    setMeta(nextMeta) {
      if (disposed) return;
      const changed = meta.mediaKey !== nextMeta.mediaKey;
      meta = cleanMeta(nextMeta);
      if (changed) reset(); else updateLines(active);
    },
    tap(nowMs) {
      if (disposed || !active || lastWallMs === null) return;
      engine.tap(sampleTime + Math.max(0, Math.min(0.1, (nowMs - lastWallMs) / 1000)));
      updateLines(true);
    },
    reset,
    code() {
      if (disposed) return '';
      return strudelProgram(Object.fromEntries(lines.map(line => [line.id, line.text])), codegenMeta(meta));
    },
    songFiles() { return disposed ? Promise.resolve(null) : recording.files(meta, engine.tempo.down); },
    dispose() {
      if (disposed) return;
      disposed = true;
      active = false;
      playbackContinuous = false;
      audio.removeEventListener('seeking', reset);
      audio.removeEventListener('emptied', reset);
      recording.dispose();
      disconnect(taps);
    },
  };
}
