import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import { ArrowCounterClockwise, Pause, Play, Record, Repeat, RepeatOnce, Shuffle, SkipBack, SkipForward } from "@phosphor-icons/react";

type VinylPlayMode = "sequence" | "shuffle" | "repeat-one";

export function VinylTurntable({
  cover,
  playing,
  progress = 0,
  duration = 0,
  decorative = false,
  title = "Lark",
  artist = "Sonora",
  volume = 0.85,
  bassGain = 0,
  trebleGain = 0,
  playMode = "sequence",
  playModeLabel = "Play mode",
  resetToneLabel = "Reset",
  onToggle,
  onPrevious,
  onNext,
  onVolume,
  onBass,
  onTreble,
  onResetTone,
  onCyclePlayMode,
  onSeek,
}: {
  cover?: string;
  playing: boolean;
  progress?: number;
  duration?: number;
  decorative?: boolean;
  title?: string;
  artist?: string;
  volume?: number;
  bassGain?: number;
  trebleGain?: number;
  playMode?: VinylPlayMode;
  playModeLabel?: string;
  resetToneLabel?: string;
  onToggle?: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  onVolume?: (value: number) => void;
  onBass?: (value: number) => void;
  onTreble?: (value: number) => void;
  onResetTone?: () => void;
  onCyclePlayMode?: () => void;
  onSeek?: (seconds: number) => void;
}) {
  const [rpm, setRpm] = useState<"33" | "45" | "78">("33");
  const pct = duration > 0 ? Math.min(1, Math.max(0, progress / duration)) : 0;
  const rpmLabel = rpm === "33" ? "33⅓" : rpm;
  const baseSpinSeconds = rpm === "33" ? 1.82 : rpm === "45" ? 1.33 : 0.77;
  const endWindowSeconds = Math.max(8, Math.min(18, duration * 0.08 || 8));
  const secondsLeft = duration > 0 ? Math.max(0, duration - progress) : Number.POSITIVE_INFINITY;
  const endingPct = Number.isFinite(secondsLeft) ? Math.max(0, Math.min(1, (endWindowSeconds - secondsLeft) / endWindowSeconds)) : 0;
  const isAtEnd = duration > 0 && progress >= duration - 0.2;
  const spinDuration = `${(baseSpinSeconds * (1 + endingPct * 2.6)).toFixed(2)}s`;
  const recordSpinning = playing && !isAtEnd;
  const knobRotation = -145 + Math.max(0, Math.min(1, volume)) * 290;
  return (
    <div className={decorative ? "turntable vinyl-component decorative" : "turntable vinyl-component"} data-playing={recordSpinning ? "true" : "false"} data-ending={endingPct > 0 && recordSpinning ? "true" : "false"} style={{ "--vinyl-spin-duration": spinDuration } as CSSProperties}>
      <div className="vinyl-plinth">
        <div className="vinyl-top-row">
          <div className="vinyl-platter-wrap">
            <div className="vinyl-mat">
              <div className="vinyl-record">
                <div className="vinyl-record-sheen" />
                <div className="vinyl-label">
                  {cover ? <img src={cover} alt="" /> : null}
                  <span>Sonora</span>
                  <strong>{title}</strong>
                  <em>{rpmLabel} RPM</em>
                </div>
              </div>
            </div>
            <div className="vinyl-spindle" />
            <Tonearm progress={pct} />
          </div>
          <div className="vinyl-controls">
            <div className="vinyl-speed-row"><span>RPM</span>{(["33", "45", "78"] as const).map((value) => (
              <button key={value} type="button" className={rpm === value ? "active" : ""} onClick={() => setRpm(value)}>
                {value === "33" ? "33⅓" : value}
              </button>
            ))}</div>
            <VUMeter playing={playing} seed={title + artist} />
            <div className="vinyl-knobs">
              <label>
                <i style={{ transform: `rotate(${knobRotation}deg)` }} />
                <small>{Math.round(volume * 100)}%</small>
                VOL
                <input
                  aria-label="Volume"
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={volume}
                  onChange={(event) => onVolume?.(Number(event.target.value))}
                />
              </label>
              <ToneKnob name="BASS" subtitle="80 Hz" value={bassGain} tone="bass" onChange={onBass} onReset={() => onBass?.(0)} />
              <ToneKnob name="TREBLE" subtitle="8 kHz" value={trebleGain} tone="treble" onChange={onTreble} onReset={() => onTreble?.(0)} />
            </div>
            <div className="vinyl-mini-transport">
              <button type="button" aria-label="Previous" disabled={!onPrevious} onClick={onPrevious}><SkipBack weight="fill" /></button>
              <button type="button" aria-label={playing ? "Pause" : "Play"} onClick={onToggle}>{playing ? <Pause weight="fill" /> : <Play weight="fill" />}</button>
              <button type="button" aria-label="Next" disabled={!onNext} onClick={onNext}><SkipForward weight="fill" /></button>
              <div className="vinyl-position-row">
                <input
                  aria-label="Position"
                  type="range"
                  min="0"
                  max={Math.max(0, duration || 0)}
                  step="0.01"
                  value={Math.min(progress, duration || progress || 0)}
                  disabled={!duration || !onSeek}
                  onChange={(event) => onSeek?.(Number(event.target.value))}
                />
              </div>
            </div>
          </div>
        </div>
        <div className="vinyl-bottom-strip">
          <span className={playing ? "vinyl-led on" : "vinyl-led"} />
          <strong>Sonora</strong>
          <div className="vinyl-bottom-actions">
            <button type="button" aria-label={resetToneLabel} title={resetToneLabel} onClick={onResetTone ?? (() => { onBass?.(0); onTreble?.(0); })}>
              <ArrowCounterClockwise />
            </button>
            <button type="button" className={playMode === "sequence" ? "" : "active"} aria-label={playModeLabel} title={playModeLabel} onClick={onCyclePlayMode} disabled={!onCyclePlayMode}>
              {playMode === "shuffle" ? <Shuffle /> : playMode === "repeat-one" ? <RepeatOnce /> : <Repeat />}
            </button>
          </div>
        </div>
      </div>
      <div className="turntable-status">{playing ? "PLAY" : "PAUSE"}</div>
    </div>
  );
}

function ToneKnob({
  name,
  subtitle,
  value,
  tone,
  onChange,
  onReset,
}: {
  name: string;
  subtitle: string;
  value: number;
  tone: "bass" | "treble";
  onChange?: (value: number) => void;
  onReset?: () => void;
}) {
  const clamped = Math.max(-12, Math.min(12, Number.isFinite(value) ? value : 0));
  const pct = (clamped + 12) / 24;
  const angle = -135 + pct * 270;
  const needle = (radius: number) => {
    const rad = (angle - 90) * Math.PI / 180;
    return {
      x: 38 + radius * Math.cos(rad),
      y: 38 + radius * Math.sin(rad),
    };
  };
  const inner = needle(15);
  const outer = needle(24);
  const dash = Math.max(0, Math.min(157, pct * 157));
  const label = `${name} ${clamped > 0 ? "+" : ""}${clamped.toFixed(clamped % 1 ? 1 : 0)} dB`;
  return (
    <div className={`vinyl-tone-unit ${tone}`} aria-label={label} onDoubleClick={onReset}>
      <span className="vinyl-tone-knob">
        <svg viewBox="0 0 76 76" aria-hidden="true">
          <circle cx="38" cy="38" r="30" fill="none" stroke="var(--vinyl-tone-track)" strokeWidth="4" strokeLinecap="round" strokeDasharray="157 220" strokeDashoffset="-31" pathLength="220" />
          <circle cx="38" cy="38" r="30" fill="none" stroke={`var(--vinyl-${tone})`} strokeWidth="4" strokeLinecap="round" strokeDasharray={`${dash} 220`} strokeDashoffset="-31" pathLength="220" />
          <circle cx="38" cy="38" r="22" fill="var(--vinyl-screen)" stroke="var(--vinyl-tone-track)" strokeWidth="1" />
          <line x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} stroke={`var(--vinyl-${tone})`} strokeWidth="2.5" strokeLinecap="round" />
        </svg>
        <span className="vinyl-tone-center">
          <strong>{clamped > 0 ? "+" : ""}{clamped.toFixed(clamped % 1 ? 1 : 0)}</strong>
          <small>dB</small>
        </span>
        <input
          aria-label={label}
          type="range"
          min="-12"
          max="12"
          step="0.5"
          value={clamped}
          onChange={(event) => onChange?.(Number(event.target.value))}
          onWheel={(event) => {
            event.preventDefault();
            onChange?.(clamped + (event.deltaY < 0 ? 0.5 : -0.5));
          }}
        />
      </span>
      <button className="vinyl-tone-reset" type="button" aria-label={`Reset ${name}`} title={`Reset ${name}`} onClick={(event) => { event.preventDefault(); onReset?.(); }}>
        <ArrowCounterClockwise />
      </button>
      <span className="vinyl-tone-name">{name}</span>
      <small>{subtitle}</small>
    </div>
  );
}

function Tonearm({ progress }: { progress: number }) {
  const angle = 28 - progress * 30;
  return (
    <svg className="vinyl-tonearm" viewBox="0 0 170 280" aria-hidden="true">
      <defs>
        <radialGradient id="vinylKnobGrad" cx="40%" cy="35%">
          <stop offset="0%" stopColor="var(--vinyl-knob-top)" />
          <stop offset="100%" stopColor="var(--vinyl-knob-base)" />
        </radialGradient>
      </defs>
      <circle cx="138" cy="28" r="14" fill="var(--vinyl-knob-base)" stroke="var(--vinyl-border)" strokeWidth="2" />
      <circle cx="138" cy="28" r="9" fill="url(#vinylKnobGrad)" stroke="var(--vinyl-border)" strokeWidth="1.5" />
      <circle cx="138" cy="28" r="3" fill="var(--vinyl-led)" />
      <g transform={`rotate(${angle},138,28)`}>
        <rect x="131" y="28" width="10" height="130" rx="5" fill="var(--vinyl-arm)" stroke="var(--vinyl-border)" strokeWidth="1.5" />
        <rect x="133" y="30" width="3" height="126" rx="2" fill="var(--vinyl-arm-hi)" opacity=".68" />
        <g transform="translate(136,158) rotate(-15)">
          <rect x="-8" y="0" width="16" height="28" rx="3" fill="var(--vinyl-screen)" stroke="var(--vinyl-border)" strokeWidth="1.5" />
          <rect x="-6" y="20" width="12" height="7" rx="2" fill="var(--vinyl-knob-base)" stroke="var(--vinyl-border)" strokeWidth="1" />
          <line x1="0" y1="27" x2="0" y2="34" stroke="var(--vinyl-muted)" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="0" cy="34" r="2" fill="var(--vinyl-muted)" />
        </g>
      </g>
      <line x1="138" y1="28" x2="155" y2="48" stroke="var(--vinyl-arm)" strokeWidth="3" strokeLinecap="round" />
      <circle cx="155" cy="50" r="5" fill="var(--vinyl-knob-base)" stroke="var(--vinyl-border)" strokeWidth="1.5" />
    </svg>
  );
}

function VUMeter({ playing, seed }: { playing: boolean; seed: string }) {
  const base = useMemo(() => Array.from(seed).reduce((sum, char) => sum + char.charCodeAt(0), 0), [seed]);
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!playing) {
      setFrame(0);
      return;
    }
    const timer = window.setInterval(() => setFrame((value) => (value + 1) % 97), 120);
    return () => window.clearInterval(timer);
  }, [playing]);
  return (
    <div className="vinyl-vu">
      <span>· · · VU · · ·</span>
      {['L', 'R'].map((channel, channelIndex) => (
        <div key={channel} className="vinyl-vu-row">
          <em>{channel}</em>
          <div>
            {Array.from({ length: 18 }, (_, index) => {
              const wave = Math.sin((frame + index * 1.7 + channelIndex * 3) * 0.72);
              const jitter = (base + frame * (channelIndex + 3) + index * 11) % 5;
              const lit = playing && index < 7 + Math.round((wave + 1) * 3) + jitter;
              const color = lit ? (index < 11 ? 'g' : index < 14 ? 'y' : 'r') : '';
              return <i key={index} className={color} />;
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export function MiniCoverArt({ url, playing }: { url?: string; playing: boolean }) {
  const style = url ? ({ "--cover-url": `url(${url})` } as CSSProperties) : undefined;
  return (
    <div className="mini-art" data-playing={playing ? "true" : "false"} data-has-cover={url ? "true" : "false"} style={style}>
      {!url ? <Record weight="fill" /> : null}
    </div>
  );
}
