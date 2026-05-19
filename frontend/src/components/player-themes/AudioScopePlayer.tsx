import type { CSSProperties } from "react";
import { Pause, Play, Repeat, RepeatOnce, Shuffle, SkipBack, SkipForward } from "@phosphor-icons/react";

import type { PlayerThemePlayMode } from "./types";

export function AudioScopePlayer({
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
  playing: boolean;
  progress?: number;
  duration?: number;
  decorative?: boolean;
  title?: string;
  artist?: string;
  playMode?: PlayerThemePlayMode;
  playModeLabel?: string;
  onToggle?: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  onCyclePlayMode?: () => void;
  onSeek?: (seconds: number) => void;
}) {
  const pct = duration > 0 ? Math.min(1, Math.max(0, progress / duration)) : 0;
  const canSeek = Boolean(duration && onSeek);
  const playerStyle = {
    "--audio-scope-progress-pct": `${(pct * 100).toFixed(2)}%`,
  } as CSSProperties;
  const playModeIcon =
    playMode === "shuffle" ? <Shuffle weight="bold" /> : playMode === "repeat-one" ? <RepeatOnce weight="bold" /> : <Repeat weight="bold" />;

  return (
    <div
      className={decorative ? "audio-scope-player decorative" : "audio-scope-player"}
      data-playing={playing ? "true" : "false"}
      style={playerStyle}
    >
      <span className="audio-scope-hover-label" aria-hidden="true">{playing ? "pause" : "play"}</span>
      <button
        type="button"
        className="audio-scope-plate"
        aria-label={playing ? "Pause" : "Play"}
        onClick={onToggle}
        disabled={!onToggle}
      >
        <AudioScopeSvg />
      </button>

      <div className="audio-scope-meta">
        <strong>{title}</strong>
        <span>{artist}</span>
      </div>

      <div className="audio-scope-progress">
        <span className="audio-scope-progress-track" aria-hidden="true"><span /></span>
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

      <div className="audio-scope-controls">
        <button type="button" aria-label="Previous" disabled={!onPrevious} onClick={onPrevious}><SkipBack weight="fill" /></button>
        <button type="button" className="audio-scope-play" aria-label={playing ? "Pause" : "Play"} disabled={!onToggle} onClick={onToggle}>
          {playing ? <Pause weight="fill" /> : <Play weight="fill" />}
        </button>
        <button type="button" aria-label="Next" disabled={!onNext} onClick={onNext}><SkipForward weight="fill" /></button>
        <button type="button" className={playMode === "sequence" ? "" : "active"} aria-label={playModeLabel} title={playModeLabel} onClick={onCyclePlayMode} disabled={!onCyclePlayMode}>
          {playModeIcon}
        </button>
      </div>
    </div>
  );
}

function AudioScopeSvg() {
  return (
    <svg className="audio-scope-svg" viewBox="0 0 250 250" aria-hidden="true">
      <g className="audio-scope-word">
        <text x="125" y="63" textAnchor="middle">AUDIO</text>
      </g>
      <path className="audio-scope-chassis" d="M202.8,128.2H214c3.8,0,6.8-2.4,6.8-5.4V18.7c0-3-3.1-5.4-6.8-5.4H36c-3.8,0-6.8,2.4-6.8,5.4v104.1c0,3,3.1,5.4,6.8,5.4h13.1" />
      <g className="audio-scope-disc">
        <circle className="audio-scope-disc-ring" cx="125.5" cy="154" r="66.3" />
        <path className="audio-scope-disc-slice left" d="M64.3,179.5c5.1,12.2,13.7,22.6,24.6,29.8l36.6-55.2L64.3,179.5z" />
        <path className="audio-scope-disc-slice right" d="M181.4,118.5 170.8,106.4 125.5,154z" />
        <circle className="audio-scope-hover-circle" cx="125.5" cy="154" r="24.7" />
        <g className="audio-scope-ripples">
          <circle cx="125.5" cy="154" r="9.6" />
          <circle cx="125.5" cy="154" r="9.6" />
          <circle cx="125.5" cy="154" r="9.6" />
        </g>
        <circle className="audio-scope-center" cx="125.5" cy="154" r="9.6" />
      </g>
      <g className="audio-scope-meter" aria-hidden="true">
        <circle cx="189" cy="82.3" r="4.4" />
        <circle cx="189" cy="98.1" r="4.4" />
      </g>
      <path className="audio-scope-arm-soft" d="M160,196.7l12.2,16.5c2.5,3.3,6.4,6.3,11.6,7.4" />
      <path className="audio-scope-arm" d="M160,196.7l12.2,16.5c2.5,3.3,6.4,6.3,11.6,7.4c6.1,1.2,19.2,3.8,19.2,3.8" />
      <path className="audio-scope-head" d="M169.5,197.3c1.9,2.5,1.5,6-1,8l-2.2,1.7c-2.5,1.9-6,1.5-8-1l-7.3-9.4c-1.9-2.5-1.5-6,1-8l2.2-1.7c2.5-1.9,6-1.5,8,1L169.5,197.3z" />
      <circle className="audio-scope-arm-end" cx="203.1" cy="224.6" r="9.9" />
      <line className="audio-scope-baseline" x1="162.7" y1="236.7" x2="87.3" y2="236.7" />
    </svg>
  );
}
