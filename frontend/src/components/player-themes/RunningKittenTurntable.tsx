import type { CSSProperties } from "react";
import { Pause, Play, Repeat, RepeatOnce, Shuffle, SkipBack, SkipForward } from "@phosphor-icons/react";

import type { PlayerThemePlayMode } from "./types";
import { useCoverFallback } from "./useCoverFallback";

export function RunningKittenTurntable({
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
  const endWindowSeconds = Math.max(8, Math.min(18, duration * 0.08 || 8));
  const secondsLeft = duration > 0 ? Math.max(0, duration - progress) : Number.POSITIVE_INFINITY;
  const endingPct = Number.isFinite(secondsLeft) ? Math.max(0, Math.min(1, (endWindowSeconds - secondsLeft) / endWindowSeconds)) : 0;
  const isAtEnd = duration > 0 && progress >= duration - 0.2;
  const active = playing && !isAtEnd;
  const coverState = useCoverFallback(cover);
  const spinSeconds = (6.8 * (1 + endingPct * 1.7)).toFixed(2);
  const orbitAngle = -34 + pct * 300;
  const tonearmAngle = 18 - pct * 26;
  const style = {
    "--running-kitten-progress-pct": `${(pct * 100).toFixed(2)}%`,
    "--running-kitten-spin-duration": `${spinSeconds}s`,
    "--running-kitten-orbit-angle": `${orbitAngle.toFixed(2)}deg`,
    "--running-kitten-arm-angle": `${tonearmAngle.toFixed(2)}deg`,
  } as CSSProperties;
  const modeIcon =
    playMode === "shuffle" ? <Shuffle weight="bold" /> : playMode === "repeat-one" ? <RepeatOnce weight="bold" /> : <Repeat weight="bold" />;

  return (
    <div className="running-kitten-player" data-playing={active ? "true" : "false"} style={style}>
      <div className="running-kitten-scene" aria-hidden="true">
        <div className="running-kitten-watercolor" />
        <div className="running-kitten-sun" />
        <div className="running-kitten-horizon" />
        <div className="running-kitten-trail" />
        <div className="running-kitten-platter">
          <div className="running-kitten-record">
            <div className="running-kitten-grooves" />
            <div className="running-kitten-record-sheen" />
            <div className="running-kitten-label" data-has-cover={coverState.displayUrl ? "true" : "false"}>
              {coverState.displayUrl ? <img src={coverState.displayUrl} alt="" onError={coverState.onCoverError} /> : null}
              <span>{title}</span>
            </div>
          </div>
          <div className="running-kitten-progress-orbit">
            <div className="running-kitten-run-orbit">
              <KittenSilhouette />
            </div>
          </div>
          <div className="running-kitten-spindle" />
        </div>
        <WatercolorTonearm />
      </div>

      <div className="running-kitten-console">
        <span className="running-kitten-kicker">Watercolor vinyl</span>
        <h2>{title}</h2>
        <p>{artist}</p>
        <div className="running-kitten-progress">
          <div className="running-kitten-time">
            <time>{formatRunningKittenTime(progress)}</time>
            <time>{formatRunningKittenTime(duration || 0)}</time>
          </div>
          <div className="running-kitten-progress-rail">
            <span><i /></span>
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
        <div className="running-kitten-controls">
          <button type="button" aria-label="Previous" disabled={!onPrevious} onClick={onPrevious}>
            <SkipBack weight="fill" />
          </button>
          <button type="button" className="running-kitten-play" aria-label={playing ? "Pause" : "Play"} disabled={!onToggle} onClick={onToggle}>
            {playing ? <Pause weight="fill" /> : <Play weight="fill" />}
          </button>
          <button type="button" aria-label="Next" disabled={!onNext} onClick={onNext}>
            <SkipForward weight="fill" />
          </button>
          <button type="button" className={playMode === "sequence" ? "" : "active"} aria-label={playModeLabel} title={playModeLabel} disabled={!onCyclePlayMode} onClick={onCyclePlayMode}>
            {modeIcon}
          </button>
        </div>
      </div>
    </div>
  );
}

function KittenSilhouette() {
  return (
    <svg className="running-kitten-cat" viewBox="0 0 96 54" aria-hidden="true">
      <path className="running-kitten-tail" d="M18 28c-12-8-12-23 0-26 7-2 13 3 13 10" />
      <path className="running-kitten-body" d="M29 25c5-10 19-14 34-10 9 2 15 8 16 15 1 8-7 13-22 13H39c-10 0-15-7-10-18Z" />
      <path className="running-kitten-head" d="M72 17l7-8 2 10 9 3-8 6-1 10-8-6-8 3 3-10-5-7Z" />
      <path className="running-kitten-leg front" d="M64 39c6 2 9 5 11 10" />
      <path className="running-kitten-leg front-alt" d="M56 40c-1 5-3 8-8 11" />
      <path className="running-kitten-leg back" d="M39 39c-6 2-10 5-14 10" />
      <path className="running-kitten-leg back-alt" d="M46 39c2 5 1 8-2 12" />
      <circle cx="82" cy="23" r="1.8" />
      <path className="running-kitten-whisker" d="M85 27h9M84 30l8 4" />
    </svg>
  );
}

function WatercolorTonearm() {
  return (
    <div className="running-kitten-arm">
      <span />
      <i />
      <b />
    </div>
  );
}

function formatRunningKittenTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}
