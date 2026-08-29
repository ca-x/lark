import type { CSSProperties } from "react";
import { Pause, Play, Repeat, RepeatOnce, Shuffle, SkipBack, SkipForward } from "@phosphor-icons/react";

import { resolvePlayerThemeLabels, type PlayerThemeLabels, type PlayerThemePlayMode } from "./types";
import { PaperShaderLayer } from "./PaperShaderLayer";
import { useCoverFallback } from "./useCoverFallback";

export function GramophonePlayer({
  cover,
  playing,
  progress = 0,
  duration = 0,
  title = "Lark",
  artist = "Sonora",
  album = "Now Playing",
  playMode = "sequence",
  playModeLabel = "Play mode",
  labels,
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
  album?: string;
  playMode?: PlayerThemePlayMode;
  playModeLabel?: string;
  labels?: PlayerThemeLabels;
  onToggle?: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  onCyclePlayMode?: () => void;
  onSeek?: (seconds: number) => void;
}) {
  const text = resolvePlayerThemeLabels(labels);
  const pct = duration > 0 ? Math.min(1, Math.max(0, progress / duration)) : 0;
  const canSeek = Boolean(duration && onSeek);
  const coverState = useCoverFallback(cover);
  const fallbackLabel = initials(artist, title);
  const armAngle = gramophoneArmAngle(pct, duration, playing);
  const playerStyle = {
    "--gramophone-progress": `${(pct * 100).toFixed(2)}%`,
    "--gramophone-arm-angle": `${armAngle.toFixed(2)}deg`,
    ...(coverState.coverImage ? { "--gramophone-cover": coverState.coverImage } : {}),
  } as CSSProperties;
  const playModeIcon =
    playMode === "shuffle" ? <Shuffle weight="bold" /> : playMode === "repeat-one" ? <RepeatOnce weight="bold" /> : <Repeat weight="bold" />;

  return (
    <div className="gramophone-player" data-playing={playing ? "true" : "false"} style={playerStyle}>
      <PaperShaderLayer variant="gramophone" playing={playing} cover={coverState.displayUrl} />
      <div className="gramophone-stage">
        <div className="gramophone-plinth">
          <div className="gramophone-platter">
            <button
              type="button"
              className="gramophone-record"
              data-has-cover={coverState.hasCover ? "true" : "false"}
              aria-label={playing ? text.pause : text.play}
              disabled={!onToggle}
              onClick={onToggle}
            >
              <span className="gramophone-groove" aria-hidden="true" />
              <span className="gramophone-record-sheen" aria-hidden="true" />
              <span className="gramophone-label">
                {coverState.displayUrl ? (
                  <img src={coverState.displayUrl} alt="" loading="eager" decoding="async" onError={coverState.onCoverError} />
                ) : (
                  <strong>{fallbackLabel}</strong>
                )}
                <i aria-hidden="true" />
              </span>
            </button>
            <span className="gramophone-spindle" aria-hidden="true" />
            <span className="gramophone-arm" aria-hidden="true">
              <i />
              <b />
            </span>
            <span className="gramophone-strobe" aria-hidden="true" />
          </div>

          <div className="gramophone-cabinet" aria-hidden="true">
            <span className="gramophone-grille" />
            <span className="gramophone-nameplate">LARK</span>
            <span className={playing ? "gramophone-led on" : "gramophone-led"} />
            <span className="gramophone-knob" />
          </div>
        </div>
      </div>

      <div className="gramophone-console">
        <span className="gramophone-kicker">Gramophone</span>
        <h2 title={title}>{title}</h2>
        <div className="gramophone-meta">
          <span title={artist}>{artist}</span>
          <em title={album}>{album}</em>
        </div>

        <div className="gramophone-progress">
          <time>{formatTime(progress)}</time>
          <div className="gramophone-progress-rail">
            <span aria-hidden="true"><i /></span>
            <input
              aria-label={text.position}
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

        <div className="gramophone-controls">
          <button type="button" aria-label={text.previous} disabled={!onPrevious} onClick={onPrevious}><SkipBack weight="fill" /></button>
          <button type="button" className="gramophone-play" aria-label={playing ? text.pause : text.play} disabled={!onToggle} onClick={onToggle}>
            {playing ? <Pause weight="fill" /> : <Play weight="fill" />}
          </button>
          <button type="button" aria-label={text.next} disabled={!onNext} onClick={onNext}><SkipForward weight="fill" /></button>
          <button type="button" className={playMode === "sequence" ? "" : "active"} aria-label={playModeLabel} title={playModeLabel} disabled={!onCyclePlayMode} onClick={onCyclePlayMode}>
            {playModeIcon}
          </button>
        </div>
      </div>
    </div>
  );
}

function initials(artist?: string, title?: string) {
  const value = [artist?.trim()[0], title?.trim()[0]]
    .filter(Boolean)
    .join("")
    .toUpperCase();
  return value.slice(0, 2) || "L";
}

function gramophoneArmAngle(progressPct: number, duration: number, playing: boolean) {
  if (!playing) return -14;
  if (duration <= 0) return 4;
  return 4 + progressPct * 7.5;
}

function formatTime(seconds: number) {
  const total = Math.max(0, Math.floor(seconds || 0));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}
