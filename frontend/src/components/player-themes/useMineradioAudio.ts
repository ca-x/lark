import { useEffect, useRef, type RefObject } from "react";
import { createAudioEnvelope, makeAudioAnalyser } from "../../services/audioAnalysis";
import { createAnimationActivity } from "./animationActivity";

// Independent of WebGL, so the DOM spectrum also works on software renderers.
export function useMineradioAudio(rootRef: RefObject<HTMLDivElement | null>, audio: HTMLAudioElement | null, playing: boolean) {
  const envelope = useRef(createAudioEnvelope());
  const playingRef = useRef(playing);
  useEffect(() => { playingRef.current = playing; }, [playing]);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    envelope.current = createAudioEnvelope();
    let tap = makeAudioAnalyser(audio);
    let retryAt = 0;
    let previousAt = performance.now();
    let paintedAt = 0;
    const silence = new Uint8Array(2048).fill(128);
    const frequencies = new Uint8Array(1024);
    const bars = root.querySelectorAll<HTMLElement>(".mineradio-stage-spectrum i");
    const reset = () => { envelope.current = createAudioEnvelope(); };
    audio?.addEventListener("emptied", reset);
    const activity = createAnimationActivity(root, (now) => {
      const delta = Math.min(0.1, (now - previousAt) / 1000);
      previousAt = now;
      if (!tap && now - retryAt > 500) { tap = makeAudioAnalyser(audio); retryAt = now; }
      const active = playingRef.current && Boolean(audio && !audio.paused && !audio.ended && tap?.context.state === "running");
      if (active && tap) {
        tap.analyser.getByteFrequencyData(tap.frequencyData);
        tap.analyser.getByteTimeDomainData(tap.timeDomainData);
      }
      const levels = envelope.current.update(active && tap ? tap.frequencyData : frequencies, active && tap ? tap.timeDomainData : silence, tap?.context.sampleRate || 48000, 2048, delta, active);
      if (now - paintedAt < 32) return;
      paintedAt = now;
      root.dataset.audioReactive = tap ? "true" : "unavailable";
      for (const key of ["energy", "bass", "mid", "treble", "beat"] as const) root.style.setProperty(`--mineradio-audio-${key}`, levels[key].toFixed(3));
      const solar = levels.vocal * 0.36 + levels.mid * 0.2 + levels.energy * 0.24;
      root.style.setProperty("--mineradio-lyric-solar", solar.toFixed(3));
      root.style.setProperty("--mineradio-lyric-glow", (solar * 0.8 + levels.beat * 0.2).toFixed(3));
      bars.forEach((bar, index) => { bar.style.transform = `scaleY(${(0.06 + levels.bands[index] * 0.94).toFixed(3)})`; });
    });
    return () => {
      activity.dispose();
      tap?.dispose();
      audio?.removeEventListener("emptied", reset);
      delete root.dataset.audioReactive;
    };
  }, [audio, rootRef]);
  return envelope;
}
