import type { CSSProperties } from "react";
import { Pause, Play, Record, Repeat, RepeatOnce, Shuffle, SkipBack, SkipForward } from "@phosphor-icons/react";

import type { PlayerThemePlayMode } from "./types";

export function SmartisanTurntable({
  cover,
  playing,
  progress = 0,
  duration = 0,
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
  const coverImage = cover ? `url("${cover.replace(/"/g, "%22")}")` : undefined;
  const needleAngle = smartisanNeedleAngle(pct, duration, playing);
  const playerStyle = {
    "--smartisan-turntable-progress": `${(pct * 100).toFixed(2)}%`,
    "--smartisan-turntable-needle": `${needleAngle.toFixed(2)}deg`,
    ...(coverImage ? { "--smartisan-turntable-cover": coverImage } : {}),
  } as CSSProperties;
  const playModeIcon =
    playMode === "shuffle" ? <Shuffle weight="bold" /> : playMode === "repeat-one" ? <RepeatOnce weight="bold" /> : <Repeat weight="bold" />;

  return (
    <div className="smartisan-turntable-player" data-playing={playing ? "true" : "false"} style={playerStyle}>
      <div className="smartisan-turntable-titlebar" aria-hidden="true">
        <span />
        <i />
        <span />
      </div>

      <div className="smartisan-turntable-stage">
        <button
          type="button"
          className="smartisan-turntable-record"
          data-has-cover={cover ? "true" : "false"}
          aria-label={playing ? "Pause" : "Play"}
          disabled={!onToggle}
          onClick={onToggle}
        >
          {cover ? <img src={cover} alt="" loading="eager" decoding="async" /> : <Record weight="fill" />}
          <span />
        </button>
        <span className="smartisan-turntable-arm" aria-hidden="true" />
        <span className={playing ? "smartisan-turntable-led on" : "smartisan-turntable-led"} aria-hidden="true" />
      </div>

      <div className="smartisan-turntable-readout">
        <span>{artist}</span>
        <strong>{title}</strong>
      </div>

      <div className="smartisan-turntable-timeline">
        <time>{formatTime(progress)}</time>
        <div className="smartisan-turntable-progress">
          <span className="smartisan-turntable-progress-track" aria-hidden="true"><span /></span>
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
        <time>-{formatTime(Math.max(0, (duration || 0) - progress))}</time>
      </div>

      <div className="smartisan-turntable-controls">
        <button type="button" data-control="previous" aria-label="Previous" disabled={!onPrevious} onClick={onPrevious}><SkipBack weight="fill" /></button>
        <button type="button" data-control={playing ? "pause" : "play"} className="smartisan-turntable-play" aria-label={playing ? "Pause" : "Play"} disabled={!onToggle} onClick={onToggle}>
          {playing ? <Pause weight="fill" /> : <Play weight="fill" />}
        </button>
        <button type="button" data-control="next" aria-label="Next" disabled={!onNext} onClick={onNext}><SkipForward weight="fill" /></button>
        <button type="button" data-control="mode" className={playMode === "sequence" ? "" : "active"} aria-label={playModeLabel} title={playModeLabel} disabled={!onCyclePlayMode} onClick={onCyclePlayMode}>
          {playModeIcon}
        </button>
      </div>
    </div>
  );
}

function formatTime(seconds: number) {
  const total = Math.max(0, Math.floor(seconds || 0));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function smartisanNeedleAngle(progressPct: number, duration: number, playing: boolean) {
  if (!playing || duration <= 0) return 0;
  return 12 + progressPct * 22.3;
}
