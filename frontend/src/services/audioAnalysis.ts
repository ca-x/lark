type AudioGraph = { context: AudioContext; output: AudioNode };
const graphs = new WeakMap<HTMLAudioElement, AudioGraph>();
export const AUDIO_ANALYSIS_READY = "lark:audio-analysis-ready";

// Visualisers tap the existing EQ graph, never create a second media source.
export function registerAudioAnalysis(audio: HTMLAudioElement, context: AudioContext, output: AudioNode) {
  graphs.set(audio, { context, output });
  audio.dispatchEvent?.(new Event(AUDIO_ANALYSIS_READY));
}

export function makeAudioAnalyser(audio: HTMLAudioElement | null) {
  const graph = audio ? graphs.get(audio) : undefined;
  if (!graph || graph.context.state === "closed") return null;
  const analyser = graph.context.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.35;
  graph.output.connect(analyser);
  return {
    analyser,
    context: graph.context,
    frequencyData: new Uint8Array(analyser.frequencyBinCount),
    timeDomainData: new Uint8Array(analyser.fftSize),
    dispose() {
      // Disconnect only this tap; playback and other visualisers keep running.
      try { graph.output.disconnect(analyser); } catch { /* Graph already disposed. */ }
      analyser.disconnect();
    },
  };
}

export function averageFrequencyBand(data: Uint8Array, sampleRate: number, fftSize: number, startHz: number, endHz: number) {
  const binHz = sampleRate / fftSize;
  const start = Math.max(1, Math.floor(startHz / binHz));
  const end = Math.min(data.length, Math.max(start + 1, Math.ceil(endHz / binHz)));
  let sum = 0;
  for (let index = start; index < end; index++) sum += data[index] / 255;
  return sum / Math.max(1, end - start);
}

export function smoothAudioValue(current: number, target: number, delta: number, attack = 0.09, release = 0.4) {
  const seconds = target > current ? attack : release;
  return current + (target - current) * (1 - Math.exp(-Math.max(0, delta) / seconds));
}

export function createAudioEnvelope() {
  const levels = { bass: 0, vocal: 0, mid: 0, treble: 0, energy: 0, beat: 0, beatId: 0, impact: 0, bands: Array<number>(24).fill(0) };
  let sinceBeat = 1;
  let beatStrength = 0;
  return {
    levels,
    update(frequency: Uint8Array, waveform: Uint8Array, sampleRate: number, fftSize: number, delta: number, active: boolean) {
      let squareSum = 0;
      for (const byte of waveform) squareSum += ((byte - 128) / 128) ** 2;
      const rms = active && waveform.length ? Math.sqrt(squareSum / waveform.length) : 0;
      const band = (start: number, end: number) => rms > 0.002 ? averageFrequencyBand(frequency, sampleRate, fftSize, start, end) : 0;
      const bass = band(40, 180);
      const energy = 1 - Math.exp(-rms * 3.5);
      sinceBeat += delta;
      const onset = bass - levels.bass;
      const beat = active && sinceBeat > 0.22 && onset > 0.09 && energy > 0.055 ? Math.min(0.75, onset * 1.5) : 0;
      if (beat) { sinceBeat = 0; beatStrength = beat; levels.beatId++; levels.impact = beat; }
      const beatTarget = active ? beatStrength * Math.exp(-Math.max(0, sinceBeat - 0.07) / 0.18) : 0;
      levels.beat = smoothAudioValue(levels.beat, beatTarget, delta, 0.055, 0.28);
      levels.bass = smoothAudioValue(levels.bass, bass, delta);
      levels.vocal = smoothAudioValue(levels.vocal, band(180, 2400), delta, 0.16, 0.5);
      levels.mid = smoothAudioValue(levels.mid, band(2400, 6000), delta, 0.12, 0.42);
      levels.treble = smoothAudioValue(levels.treble, band(6000, 16000), delta, 0.08, 0.35);
      levels.energy = smoothAudioValue(levels.energy, energy, delta, 0.14, 0.6);
      for (let index = 0; index < levels.bands.length; index++) {
        const start = 40 * (400 ** (index / levels.bands.length));
        const end = 40 * (400 ** ((index + 1) / levels.bands.length));
        levels.bands[index] = smoothAudioValue(levels.bands[index], band(start, end), delta, 0.07, 0.32);
      }
      return levels;
    },
  };
}

/** Capture is read-only: it never redirects the media element through WebAudio. */
export function capturePlaybackAnalyser(audio: HTMLAudioElement | null) {
  if (!audio || audio.paused || audio.readyState < 2) return null;
  const capturable = audio as HTMLAudioElement & {
    captureStream?: () => MediaStream;
    mozCaptureStream?: () => MediaStream;
  };
  const capture = capturable.captureStream || capturable.mozCaptureStream;
  const Context = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!capture || !Context) return null;
  let stream: MediaStream | undefined;
  let context: AudioContext | undefined;
  try {
    stream = capture.call(audio);
    if (!stream.getAudioTracks().length) {
      stream.getTracks().forEach(track => track.stop());
      return null;
    }
    context = new Context();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.35;
    source.connect(analyser);
    const ownedContext = context;
    const ownedStream = stream;
    return {
      context,
      analyser,
      isAlive: () => ownedStream.getAudioTracks().some(track => track.readyState === "live"),
      frequencyData: new Uint8Array(analyser.frequencyBinCount),
      timeDomainData: new Uint8Array(analyser.fftSize),
      dispose() {
        source.disconnect();
        analyser.disconnect();
        ownedStream.getTracks().forEach(track => track.stop());
        void ownedContext.close().catch(() => undefined);
      },
    };
  } catch {
    stream?.getTracks().forEach(track => track.stop());
    void context?.close().catch(() => undefined);
    return null;
  }
}
