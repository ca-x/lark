import type { CSSProperties } from "react";
import { Pause, Play, Repeat, RepeatOnce, Shuffle, SkipBack, SkipForward } from "@phosphor-icons/react";
import { resolvePlayerThemeLabels, type PlayerThemeLabels, type PlayerThemePlayMode } from "./types";
import { playbackPosition } from "./conceptPlayback";

export type ConceptPlayerProps = {
  cover?: string;
  playing: boolean;
  progress?: number;
  duration?: number;
  title?: string;
  artist?: string;
  album?: string;
  activeLyricText?: string;
  playMode?: PlayerThemePlayMode;
  playModeLabel?: string;
  labels?: PlayerThemeLabels;
  onToggle?: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  onCyclePlayMode?: () => void;
  onSeek?: (seconds: number) => void;
};

function clockTime(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

export function ConceptPlayerControls({ playing, progress, duration, playMode = "sequence", playModeLabel = "Play mode", labels, onToggle, onPrevious, onNext, onCyclePlayMode, onSeek }: ConceptPlayerProps) {
  const text = resolvePlayerThemeLabels(labels);
  const { total, position, fraction } = playbackPosition(progress, duration);
  const canSeek = total > 0 && Boolean(onSeek);
  const modeIcon = playMode === "shuffle" ? <Shuffle /> : playMode === "repeat-one" ? <RepeatOnce /> : <Repeat />;

  return (
    <footer className="concept-player-controls" style={{ "--concept-progress": `${fraction * 100}%` } as CSSProperties}>
      <div className="concept-player-progress">
        <span>{clockTime(position)}</span>
        <input
          aria-label={text.position}
          aria-valuetext={`${clockTime(position)} / ${clockTime(total)}`}
          type="range"
          min="0"
          max={total}
          step={1}
          value={position}
          disabled={!canSeek}
          onChange={(event) => {
            const seconds = Number(event.target.value);
            if (canSeek && Number.isFinite(seconds)) onSeek?.(Math.min(total, Math.max(0, seconds)));
          }}
        />
        <span>{clockTime(total)}</span>
      </div>
      <div className="concept-player-transport" role="group" aria-label={text.controls}>
        <button type="button" aria-label={playModeLabel} title={playModeLabel} data-mode={playMode} disabled={!onCyclePlayMode} onClick={onCyclePlayMode}>{modeIcon}</button>
        <button type="button" aria-label={text.previous} title={text.previous} disabled={!onPrevious} onClick={onPrevious}><SkipBack weight="fill" /></button>
        <button type="button" className="concept-player-play" aria-label={playing ? text.pause : text.play} title={playing ? text.pause : text.play} disabled={!onToggle} onClick={onToggle}>{playing ? <Pause weight="fill" /> : <Play weight="fill" />}</button>
        <button type="button" aria-label={text.next} title={text.next} disabled={!onNext} onClick={onNext}><SkipForward weight="fill" /></button>
      </div>
    </footer>
  );
}
