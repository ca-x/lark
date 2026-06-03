import type { CSSProperties } from "react";
import { Pause, Play, Record, Repeat, RepeatOnce, Shuffle, SkipBack, SkipForward } from "@phosphor-icons/react";

import type { PlayerThemePlayMode } from "./types";
import { useCoverFallback } from "./useCoverFallback";

export function AlbumSlidePlayer({
  cover,
  playing,
  progress = 0,
  duration = 0,
  decorative = false,
  title = "Lark",
  artist = "Sonora",
  album = "Now Playing",
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
  album?: string;
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
    "--album-slide-progress-pct": `${(pct * 100).toFixed(2)}%`,
    ...(coverState.coverImage ? { "--album-slide-cover-image": coverState.coverImage } : {}),
  } as CSSProperties;
  const playModeIcon =
    playMode === "shuffle" ? <Shuffle weight="bold" /> : playMode === "repeat-one" ? <RepeatOnce weight="bold" /> : <Repeat weight="bold" />;

  return (
    <div
      className={decorative ? "album-slide-player decorative" : "album-slide-player"}
      data-playing={playing ? "true" : "false"}
      style={playerStyle}
    >
      <div className="album-slide-panel">
        <div className="album-slide-content">
          <div className="album-slide-info">
            <span className="album-slide-kicker">Track</span>
            <h2>{title}</h2>
            <div className="album-slide-meta">
              <div>
                <span>Artist</span>
                <strong>{artist}</strong>
              </div>
              <div>
                <span>Album</span>
                <em>{album}</em>
              </div>
            </div>
          </div>

          <div className="album-slide-transport">
            <div className="album-slide-progress">
              <span className="album-slide-progress-track" aria-hidden="true"><span /></span>
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

            <div className="album-slide-controls">
              <button type="button" aria-label="Previous" disabled={!onPrevious} onClick={onPrevious}><SkipBack weight="fill" /></button>
              <button type="button" className="album-slide-play" aria-label={playing ? "Pause" : "Play"} disabled={!onToggle} onClick={onToggle}>
                {playing ? <Pause weight="fill" /> : <Play weight="fill" />}
              </button>
              <button type="button" aria-label="Next" disabled={!onNext} onClick={onNext}><SkipForward weight="fill" /></button>
              <button type="button" className={playMode === "sequence" ? "" : "active"} aria-label={playModeLabel} title={playModeLabel} disabled={!onCyclePlayMode} onClick={onCyclePlayMode}>
                {playModeIcon}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="album-slide-art-stack" aria-hidden="true">
        <div className="album-slide-vinyl-rail">
          <div className="album-slide-vinyl">
            <span />
          </div>
        </div>
        <div className="album-slide-cover" data-has-cover={coverState.hasCover ? "true" : "false"}>
          {coverState.displayUrl ? (
            <img src={coverState.displayUrl} alt="" loading="eager" decoding="async" onError={coverState.onCoverError} />
          ) : (
            <Record weight="fill" />
          )}
        </div>
      </div>
    </div>
  );
}
