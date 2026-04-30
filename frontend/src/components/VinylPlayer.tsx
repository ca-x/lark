import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import { Pause, Play, Power, Record, Repeat, RepeatOnce, Shuffle, SkipBack, SkipForward } from "@phosphor-icons/react";

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
  const tonearmPct = duration > 0 ? pct : 0;
  const knobRotation = -145 + Math.max(0, Math.min(1, volume)) * 290;
  const deckStyle = {
    "--vinyl-spin-duration": spinDuration,
    "--vinyl-progress-pct": `${(pct * 100).toFixed(2)}%`,
  } as CSSProperties;
  return (
    <div className={decorative ? "turntable vinyl-component decorative" : "turntable vinyl-component"} data-playing={recordSpinning ? "true" : "false"} data-ending={endingPct > 0 && recordSpinning ? "true" : "false"} style={deckStyle}>
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
            <Tonearm progress={tonearmPct} />
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
              <ToneKnob name="BASS" subtitle="80 Hz" value={bassGain} tone="bass" onChange={onBass} />
              <ToneKnob name="TREBLE" subtitle="8 kHz" value={trebleGain} tone="treble" onChange={onTreble} />
            </div>
            <div className="vinyl-mini-transport">
              <button type="button" aria-label="Previous" disabled={!onPrevious} onClick={onPrevious}><SkipBack weight="fill" /></button>
              <button type="button" aria-label={playing ? "Pause" : "Play"} onClick={onToggle}>{playing ? <Pause weight="fill" /> : <Play weight="fill" />}</button>
              <button type="button" aria-label="Next" disabled={!onNext} onClick={onNext}><SkipForward weight="fill" /></button>
              <div className="vinyl-position-row">
                <span className="vinyl-position-track" aria-hidden="true">
                  <span className="vinyl-position-fill" />
                  <span className="vinyl-position-dot" />
                </span>
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
            <button className="vinyl-reset-button" type="button" aria-label={resetToneLabel} title={resetToneLabel} onClick={onResetTone ?? (() => { onBass?.(0); onTreble?.(0); })}>
              RESET
            </button>
            <button type="button" className={playMode === "sequence" ? "" : "active"} aria-label={playModeLabel} title={playModeLabel} onClick={onCyclePlayMode} disabled={!onCyclePlayMode}>
              {playMode === "shuffle" ? <Shuffle /> : playMode === "repeat-one" ? <RepeatOnce /> : <Repeat />}
            </button>
          </div>
        </div>
      </div>
      <div
        className={playing ? "turntable-status vinyl-power-status on" : "turntable-status vinyl-power-status"}
        aria-label={playing ? "Power status on" : "Power status off"}
        title={playing ? "Power on" : "Power off"}
      >
        <Power weight="bold" />
      </div>
    </div>
  );
}

export function CassetteDeck({
  cover,
  playing,
  progress = 0,
  duration = 0,
  decorative = false,
  title = "Lark",
  artist = "Sonora",
  playMode = "sequence",
  playModeLabel = "Play mode",
  onToggle,
  onPrevious,
  onNext,
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
  playMode?: VinylPlayMode;
  playModeLabel?: string;
  onToggle?: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  onCyclePlayMode?: () => void;
  onSeek?: (seconds: number) => void;
}) {
  const pct = duration > 0 ? Math.min(1, Math.max(0, progress / duration)) : 0;
  const leftReel = 35 - pct * 13;
  const rightReel = 23 + pct * 13;
  const canSeek = Boolean(duration && onSeek);
  const seekBy = (delta: number) => {
    if (!canSeek) return;
    onSeek?.(Math.max(0, Math.min(duration, progress + delta)));
  };
  const deckStyle = {
    "--cassette-progress-pct": `${(pct * 100).toFixed(2)}%`,
    "--cassette-left-reel": leftReel.toFixed(2),
    "--cassette-right-reel": rightReel.toFixed(2),
  } as CSSProperties;
  return (
    <div className={decorative ? "cassette-component decorative" : "cassette-component"} data-playing={playing ? "true" : "false"} style={deckStyle}>
      <div className="cassette-deck">
        <div className="cassette-brand-bar">
          <div className="cassette-brand">SŌNIX</div>
          <div className="cassette-model-row">
            <span className={playing ? "cassette-led on" : "cassette-led"} />
            <span>TC-900 MKII · TYPE II</span>
          </div>
        </div>

        <div className="cassette-bay">
          <svg className="cassette-svg" viewBox="0 0 440 220" aria-hidden="true">
            <defs>
              <linearGradient id="cassetteShellGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--cassette-shell-hi)" />
                <stop offset="45%" stopColor="var(--cassette-shell)" />
                <stop offset="100%" stopColor="var(--cassette-shell-dark)" />
              </linearGradient>
              <linearGradient id="cassetteLabelGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="var(--cassette-label-a)" />
                <stop offset="54%" stopColor="var(--cassette-label-b)" />
                <stop offset="100%" stopColor="var(--cassette-label-c)" />
              </linearGradient>
              <linearGradient id="cassetteTapeGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#6a4820" />
                <stop offset="46%" stopColor="#8a6030" />
                <stop offset="100%" stopColor="#5a3c18" />
              </linearGradient>
              <radialGradient id="cassetteHubGrad" cx="35%" cy="30%" r="65%">
                <stop offset="0%" stopColor="#4a4030" />
                <stop offset="60%" stopColor="#2a2018" />
                <stop offset="100%" stopColor="#181410" />
              </radialGradient>
              <clipPath id="cassetteArtClip"><rect x="32" y="14" width="100" height="100" rx="3" /></clipPath>
              <clipPath id="cassetteWindowClip"><rect x="106" y="72" width="228" height="96" rx="8" /></clipPath>
            </defs>

            <rect x="20" y="4" width="400" height="212" rx="10" fill="rgba(0,0,0,.5)" />
            <path d="M18,8 Q18,0 26,0 L414,0 Q422,0 422,8 L422,212 Q422,220 414,220 L26,220 Q18,220 18,212 Z" fill="url(#cassetteShellGrad)" stroke="var(--cassette-border)" strokeWidth="1" />
            <path d="M26,1 L414,1" stroke="rgba(255,255,255,.09)" strokeWidth="1.5" fill="none" />
            <rect x="26" y="8" width="388" height="196" rx="7" fill="url(#cassetteLabelGrad)" />
            <line x1="26" y1="44" x2="414" y2="44" stroke="rgba(0,0,0,.08)" strokeWidth=".8" />
            <line x1="26" y1="172" x2="414" y2="172" stroke="rgba(0,0,0,.1)" strokeWidth=".8" />

            <rect x="30" y="12" width="104" height="104" rx="4" fill="#1a1410" stroke="rgba(0,0,0,.32)" strokeWidth=".8" />
            <g clipPath="url(#cassetteArtClip)">
              <rect x="32" y="14" width="100" height="100" fill="var(--cassette-art-bg)" />
              {cover ? <image x="32" y="14" width="100" height="100" href={cover} preserveAspectRatio="xMidYMid slice" /> : (
                <g>
                  <ellipse cx="82" cy="78" rx="52" ry="16" fill="var(--cassette-art-wave)" opacity=".68" />
                  <ellipse cx="82" cy="90" rx="46" ry="12" fill="#0a2840" opacity=".56" />
                  <circle cx="82" cy="44" r="16" fill="var(--cassette-art-moon)" opacity=".92" />
                  <line x1="82" y1="60" x2="82" y2="96" stroke="rgba(248,240,200,.14)" strokeWidth="2" />
                </g>
              )}
            </g>
            <rect x="30" y="12" width="104" height="40" rx="4" fill="rgba(255,255,255,.06)" pointerEvents="none" />
            <line x1="134" y1="12" x2="134" y2="116" stroke="rgba(0,0,0,.2)" strokeWidth="1" />

            <text x="148" y="35" className="cassette-svg-title">{title}</text>
            <text x="148" y="50" className="cassette-svg-artist">{artist}</text>
            <text x="148" y="100" className="cassette-svg-spec">TYPE II · CrO₂ · IEC II</text>
            <text x="148" y="112" className="cassette-svg-spec">SIDE A — {formatTime(duration || 0)}</text>

            <rect x="103" y="69" width="234" height="102" rx="10" fill="#0e1408" stroke="var(--cassette-window-border)" strokeWidth="1.5" />
            <g clipPath="url(#cassetteWindowClip)">
              <rect x="106" y="72" width="228" height="96" rx="8" fill="#0a0e08" />
              <rect x="106" y="72" width="228" height="16" rx="8" fill="rgba(255,255,255,.025)" />
              <g className="cassette-left-reel" transform="translate(158,120)">
                <circle r={leftReel} fill="var(--cassette-tape-left)" />
                <circle r={Math.max(17, leftReel - 7)} fill="none" stroke="#7a5828" strokeWidth=".8" opacity=".45" />
                <circle r="17" fill="url(#cassetteHubGrad)" />
                <CassetteHub />
              </g>
              <g className="cassette-right-reel" transform="translate(276,120)">
                <circle r={rightReel} fill="var(--cassette-tape-right)" />
                <circle r={Math.max(15, rightReel - 6)} fill="none" stroke="#5a4020" strokeWidth=".8" opacity=".44" />
                <circle r="15" fill="url(#cassetteHubGrad)" />
                <CassetteHub small />
              </g>
              <circle cx="123" cy="152" r="3.5" fill="#282018" stroke="#3a3020" strokeWidth="1" />
              <circle cx="311" cy="152" r="3.5" fill="#282018" stroke="#3a3020" strokeWidth="1" />
              <rect x="123" y="149" width="188" height="5" fill="url(#cassetteTapeGrad)" rx="1" />
              <rect x="123" y="149" width="188" height="2" fill="rgba(160,100,40,.22)" rx="1" />
              <rect x="210" y="147" width="14" height="10" rx="2" fill="#1a1814" stroke="#282018" strokeWidth=".8" />
              <rect x="214" y="156" width="6" height="14" rx="3" fill="#242018" stroke="#1a1610" strokeWidth=".5" />
            </g>
            <rect x="103" y="69" width="234" height="102" rx="10" fill="none" stroke="rgba(255,255,255,.045)" strokeWidth="1" />
            {[ [44,42], [396,42], [44,178], [396,178] ].map(([cx, cy]) => (
              <g key={`${cx}-${cy}`}>
                <circle cx={cx} cy={cy} r="6" fill="#282018" stroke="#1a1610" strokeWidth=".8" />
                <line x1={cx - 3} y1={cy} x2={cx + 3} y2={cy} stroke="#3a3020" strokeWidth="1.2" />
                <line x1={cx} y1={cy - 3} x2={cx} y2={cy + 3} stroke="#3a3020" strokeWidth="1.2" />
              </g>
            ))}
          </svg>
        </div>

        <div className="cassette-lcd">
          <div className="cassette-lcd-left">
            <span>TRACK 01 · SIDE A</span>
            <div><strong>{artist} — {title}</strong></div>
          </div>
          <time>{formatTime(progress)} / {formatTime(duration || 0)}</time>
        </div>

        <div className="cassette-progress-row">
          <span className="cassette-progress-track" aria-hidden="true"><span /></span>
          <input
            aria-label="Position"
            type="range"
            min="0"
            max={Math.max(0, duration || 0)}
            step="0.01"
            value={Math.min(progress, duration || progress || 0)}
            disabled={!canSeek}
            onChange={(event) => onSeek?.(Number(event.target.value))}
          />
        </div>

        <div className="cassette-vu" aria-hidden="true">
          <div><span>L ───────── +3dB</span><i /></div>
          <div><span>R ───────── +3dB</span><i /></div>
        </div>

        <div className="cassette-controls">
          <button type="button" aria-label="Previous" disabled={!onPrevious} onClick={onPrevious}><SkipBack weight="fill" /></button>
          <button type="button" aria-label="Back 10 seconds" disabled={!canSeek} onClick={() => seekBy(-10)}>-10</button>
          <button type="button" className="cassette-play" aria-label={playing ? "Pause" : "Play"} onClick={onToggle} disabled={!onToggle}>{playing ? <Pause weight="fill" /> : <Play weight="fill" />}</button>
          <button type="button" aria-label="Forward 10 seconds" disabled={!canSeek} onClick={() => seekBy(10)}>+10</button>
          <button type="button" aria-label="Next" disabled={!onNext} onClick={onNext}><SkipForward weight="fill" /></button>
          <button type="button" className={playMode === "sequence" ? "" : "active"} aria-label={playModeLabel} title={playModeLabel} onClick={onCyclePlayMode} disabled={!onCyclePlayMode}>
            {playMode === "shuffle" ? <Shuffle /> : playMode === "repeat-one" ? <RepeatOnce /> : <Repeat />}
          </button>
        </div>
      </div>
    </div>
  );
}

function CassetteHub({ small = false }: { small?: boolean }) {
  const width = small ? 3.2 : 3.6;
  const height = small ? 8 : 9;
  const y = small ? -14 : -16;
  return (
    <g className="cassette-hub">
      {[0, 72, 144, 216, 288].map((angle) => (
        <rect key={angle} x={-width / 2} y={y} width={width} height={height} rx={width / 2} fill="#3a3020" transform={angle ? `rotate(${angle})` : undefined} />
      ))}
      <rect x={small ? -4 : -4.5} y={small ? -4 : -4.5} width={small ? 8 : 9} height={small ? 8 : 9} rx="2" fill="#2f261b" stroke="#1a1410" strokeWidth=".5" />
    </g>
  );
}

function formatTime(seconds: number) {
  const safe = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function ToneKnob({
  name,
  subtitle,
  value,
  tone,
  onChange,
}: {
  name: string;
  subtitle: string;
  value: number;
  tone: "bass" | "treble";
  onChange?: (value: number) => void;
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
    <div className={`vinyl-tone-unit ${tone}`} aria-label={label}>
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
