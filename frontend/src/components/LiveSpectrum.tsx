import { useEffect, useRef, useState } from 'react';
import { SlidersHorizontal } from '@phosphor-icons/react';
import type { Theme } from '../types';
import { AUDIO_ANALYSIS_READY, createAudioEnvelope, makeAudioAnalyser, capturePlaybackAnalyser } from '../services/audioAnalysis';
import { createAnimationActivity } from './player-themes/animationActivity';

export function LiveSpectrum({ audio, playing, theme, lowBandwidth, eqActive, onOpenEqualizer, equalizerLabel, label }: {
  audio: HTMLAudioElement | null;
  playing: boolean;
  theme: Theme;
  lowBandwidth: boolean;
  eqActive: boolean;
  onOpenEqualizer: () => void;
  equalizerLabel: string;
  label: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playingRef = useRef(playing);
  const [source, setSource] = useState('idle');
  useEffect(() => { playingRef.current = playing; }, [playing]);
  useEffect(() => {
    const host = root.current;
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!host || !canvas || !context) return;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let reduced = motion.matches;
    let tap: ReturnType<typeof makeAudioAnalyser> | ReturnType<typeof capturePlaybackAnalyser> = null;
    let envelope = createAudioEnvelope();
    let retryAt = 0;
    let resumeAt = 0;
    let resumePending: AudioContext | null = null;
    let previousAt = performance.now();
    let paintedAt = 0;
    let currentSource = "";
    let width = 1;
    let height = 1;
    let color = getComputedStyle(host).getPropertyValue('--accent').trim();
    const silent = new Uint8Array(2048).fill(128);
    const empty = new Uint8Array(1024);
    const peaks = Array<number>(24).fill(0);
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, rect.width); height = Math.max(1, rect.height);
      const ratio = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      color = getComputedStyle(host).getPropertyValue('--accent').trim();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    const rebind = () => {
      tap?.dispose(); tap = null; envelope = createAudioEnvelope(); peaks.fill(0); retryAt = 0; resumePending = null;
    };
    const resumeCapture = (force = false) => {
      if (!tap || !("isAlive" in tap) || tap.context.state !== 'suspended' || audio?.paused) return;
      const captureContext = tap.context;
      if (!force && resumePending === captureContext) return;
      resumePending = captureContext;
      void captureContext.resume().catch(() => undefined).finally(() => {
        if (resumePending === captureContext) resumePending = null;
      });
    };
    const onPlaying = () => resumeCapture(true);
    const onVisibility = () => { if (!document.hidden) resumeCapture(true); };
    audio?.addEventListener('playing', onPlaying);
    audio?.addEventListener(AUDIO_ANALYSIS_READY, rebind);
    document.addEventListener('visibilitychange', onVisibility);
    // A captured stream can replace its audio track on load() without changing
    // the HTMLAudioElement. Always release that source before sampling again.
    audio?.addEventListener('emptied', rebind);
    audio?.addEventListener('loadedmetadata', rebind);
    const onMotionChange = () => { reduced = motion.matches; rebind(); };
    motion.addEventListener('change', onMotionChange);
    const activity = createAnimationActivity(host, now => {
      const delta = Math.min(0.1, (now - previousAt) / 1000); previousAt = now;
      if (tap && "isAlive" in tap && !tap.isAlive()) rebind();
      if (!tap && !reduced && playingRef.current && host.getClientRects().length && now - retryAt > 500) {
        tap = makeAudioAnalyser(audio) || capturePlaybackAnalyser(audio); retryAt = now;
        resumeCapture();
      }
      if (playingRef.current && now - resumeAt > 500) { resumeAt = now; resumeCapture(); }
      const active = Boolean(!reduced && playingRef.current && audio && !audio.paused && !audio.ended && tap?.context.state === 'running');
      if (active && tap) { tap.analyser.getByteFrequencyData(tap.frequencyData); tap.analyser.getByteTimeDomainData(tap.timeDomainData); }
      const values = envelope.update(active && tap ? tap.frequencyData : empty, active && tap ? tap.timeDomainData : silent, tap?.context.sampleRate || 48000, 2048, delta, active);
      if (now - paintedAt < (lowBandwidth ? 100 : 32)) return;
      const paintDelta = Math.min(0.2, (now - paintedAt) / 1000);
      paintedAt = now;
      const nextSource = active ? 'live' : playingRef.current && !reduced ? 'unavailable' : 'idle';
      if (nextSource !== currentSource) { currentSource = nextSource; setSource(nextSource); }
      context.clearRect(0, 0, width, height);
      context.fillStyle = color;
      const step = width / values.bands.length;
      values.bands.forEach((level, index) => {
        const bar = 1.5 + level * (height - 8);
        peaks[index] = Math.max(level, peaks[index] - paintDelta * 0.8);
        context.globalAlpha = active ? 0.5 + level * 0.45 : 0.22;
        context.fillRect(index * step, height - bar, Math.max(1, step - 1.3), bar);
        if (active && peaks[index] > 0.06) {
          context.globalAlpha = 0.85;
          context.fillRect(index * step, height - 4 - peaks[index] * (height - 8), Math.max(1, step - 1.3), 1);
        }
      });
      context.globalAlpha = 1;
    });
    return () => { activity.dispose(); observer.disconnect(); rebind(); audio?.removeEventListener('emptied', rebind); audio?.removeEventListener('loadedmetadata', rebind); audio?.removeEventListener('playing', onPlaying); audio?.removeEventListener(AUDIO_ANALYSIS_READY, rebind); document.removeEventListener('visibilitychange', onVisibility); motion.removeEventListener('change', onMotionChange); };
  }, [audio, lowBandwidth, theme]);
  return (
    <div ref={root} className="player-mood live-spectrum" data-theme-key={theme} data-playing={playing} data-audio-source={source} aria-label={label}>
      <span className="live-spectrum-label">{playing ? 'LIVE' : 'IDLE'}</span>
      <button className={eqActive ? 'wave-eq-button active' : 'wave-eq-button'} type="button" title={equalizerLabel} aria-label={equalizerLabel} onClick={onOpenEqualizer}><SlidersHorizontal /></button>
      <canvas ref={canvasRef} aria-hidden="true" />
      <em aria-hidden="true">40 Hz · 16 kHz</em>
    </div>
  );
}
