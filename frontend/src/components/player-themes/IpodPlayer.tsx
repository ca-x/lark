import type { CSSProperties } from "react";
import { Pause, Play, Repeat, RepeatOnce, Shuffle, SkipBack, SkipForward } from "@phosphor-icons/react";

import type { PlayerThemePlayMode } from "./types";
import { useCoverFallback } from "./useCoverFallback";

export function IpodPlayer({
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
  const coverState = useCoverFallback(cover);
  const playerStyle = {
    "--ipod-progress-pct": `${(pct * 100).toFixed(2)}%`,
  } as CSSProperties;
  const playModeIcon =
    playMode === "shuffle" ? <Shuffle weight="bold" /> : playMode === "repeat-one" ? <RepeatOnce weight="bold" /> : <Repeat weight="bold" />;

  return (
    <div
      className={decorative ? "ipod-component decorative" : "ipod-component"}
      data-playing={playing ? "true" : "false"}
      style={playerStyle}
    >
      <div className="ipod-shell">
        <div className="ipod-headphone-port" aria-hidden="true" />
        <div className="ipod-hold-switch" aria-hidden="true" />

        <div className="ipod-screen-bezel">
          <div className="ipod-screen">
            <div className="ipod-screen-topbar">
              <span>Now Playing</span>
              <span className="ipod-battery" aria-hidden="true"><i /><b /></span>
            </div>
            <div className="ipod-screen-content">
              <div className="ipod-now-row">
                <div className="ipod-mini-art" data-has-cover={coverState.hasCover ? "true" : "false"} aria-hidden="true">
                  {coverState.displayUrl ? <img src={coverState.displayUrl} alt="" loading="eager" decoding="async" onError={coverState.onCoverError} /> : null}
                  <span><i /></span>
                </div>
                <div className="ipod-mini-text">
                  <strong>{title}</strong>
                  <span>{artist}</span>
                </div>
              </div>
              <div className="ipod-eq-row" aria-hidden="true">
                {Array.from({ length: 9 }, (_, index) => (
                  <i key={index} style={{ animationDelay: `${index * -70}ms` }} />
                ))}
              </div>
              <div className="ipod-progress-area">
                <span className="ipod-progress-track" aria-hidden="true">
                  <span className="ipod-progress-fill"><i /></span>
                </span>
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
                <div className="ipod-time-row">
                  <time>{formatIpodTime(progress)}</time>
                  <time>{formatIpodTime(duration || 0)}</time>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="ipod-wheel-wrap">
          <div className="ipod-click-wheel">
            <button
              type="button"
              className="ipod-wheel-button ipod-wheel-menu"
              aria-label={playModeLabel}
              title={playModeLabel}
              onClick={onCyclePlayMode}
              disabled={!onCyclePlayMode}
            >
              <span>MENU</span>
              <em>{playModeIcon}</em>
            </button>
            <button type="button" className="ipod-wheel-button ipod-wheel-prev" aria-label="Previous" onClick={onPrevious} disabled={!onPrevious}>
              <SkipBack weight="fill" />
            </button>
            <button type="button" className="ipod-wheel-button ipod-wheel-next" aria-label="Next" onClick={onNext} disabled={!onNext}>
              <SkipForward weight="fill" />
            </button>
            <button
              type="button"
              className="ipod-wheel-button ipod-wheel-play"
              aria-label={playing ? "Pause" : "Play"}
              onClick={onToggle}
              disabled={!onToggle}
            >
              {playing ? <Pause weight="fill" /> : <Play weight="fill" />}
            </button>
            <button
              type="button"
              className="ipod-center-button"
              aria-label={playing ? "Pause" : "Play"}
              onClick={onToggle}
              disabled={!onToggle}
            >
              <span />
            </button>
          </div>
        </div>

        <div className="ipod-dock-port" aria-hidden="true" />
      </div>
    </div>
  );
}

function formatIpodTime(value: number) {
  const total = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
