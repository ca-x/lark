import { Pause, Play, Repeat, RepeatOnce, Shuffle, SkipBack, SkipForward } from "@phosphor-icons/react";

import { resolvePlayerThemeLabels, type PlayerThemeLabels, type PlayerThemePlayMode } from "./types";
import { useArtworkActivity } from "./useArtworkActivity";
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
  const { ref: activityRef, visible } = useArtworkActivity();
  const pct = duration > 0 ? Math.min(1, Math.max(0, progress / duration)) : 0;
  const isAtEnd = duration > 0 && progress >= duration - 0.2;
  const active = playing && !isAtEnd;
  const coverState = useCoverFallback(cover);
  const progressPct = `${(pct * 100).toFixed(2)}%`;
  const modeIcon =
    playMode === "shuffle" ? <Shuffle weight="bold" /> : playMode === "repeat-one" ? <RepeatOnce weight="bold" /> : <Repeat weight="bold" />;

  return (
    <div ref={activityRef} className="running-kitten-player" data-motion={visible ? "running" : "paused"} data-playing={active ? "true" : "false"}>
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
          <div className="running-kitten-cat-orbit" data-motion-model="rim-treadmill">
            <div className="running-kitten-cat-runner">
              <span className="running-kitten-sleep-symbol" aria-hidden="true">
                <i>Z</i><i>z</i><i>z</i>
              </span>
              <div className="running-kitten-cat-facing">
                <KittenSilhouette />
                <SleepingKitten />
              </div>
            </div>
          </div>
          <div className="running-kitten-spindle" />
        </div>
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
            <span><i style={{ width: progressPct }} /></span>
            <input
              aria-label={text.position}
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
          <button type="button" aria-label={text.previous} disabled={!onPrevious} onClick={onPrevious}>
            <SkipBack weight="fill" />
          </button>
          <button type="button" className="running-kitten-play" aria-label={playing ? text.pause : text.play} disabled={!onToggle} onClick={onToggle}>
            {playing ? <Pause weight="fill" /> : <Play weight="fill" />}
          </button>
          <button type="button" aria-label={text.next} disabled={!onNext} onClick={onNext}>
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
    <svg className="running-kitten-cat" viewBox="0 0 220 154" aria-hidden="true">
      <g className="running-kitten-tail">
        <path className="running-kitten-tail-outline" d="M61 93C33 97 18 80 23 60c4-17 17-26 27-20" />
        <path className="running-kitten-tail-fill" d="M61 93C33 97 18 80 23 60c4-17 17-26 27-20" />
      </g>
      <path className="running-kitten-leg running-kitten-backleg-two" d="M77 94q-7 20-3 43 2 10 17 6l4-5q-6-19 5-37Z" />
      <path className="running-kitten-leg running-kitten-frontleg-two" d="M151 92q9 18 16 41 4 9 17 3l2-5q-9-22-10-42Z" />
      <g className="running-kitten-body">
        <path className="running-kitten-body-shape" d="M50 87C48 63 71 51 103 52c31 0 59 13 64 34 5 23-17 32-45 31l-46-3c-18-1-26-12-26-27Z" />
        <path className="kitten-belly" d="M65 97q39 20 83-2-8 22-30 20l-40-3Z" />
        <path className="running-kitten-coat-mark" d="m77 57 6 15m9-18 6 14m10-13 3 12" />
      </g>
      <path className="running-kitten-leg running-kitten-backleg-one" d="M56 94q-2 20 0 43 1 9 17 7l4-5q-3-20 8-34Z" />
      <path className="running-kitten-leg running-kitten-frontleg-one" d="M133 96q9 19 12 42 2 10 18 5l2-5q-4-22-10-43Z" />
      <g className="running-kitten-head-group">
        <path className="running-kitten-ear" d="m137 43 1-28 24 19m17-4 25-13-5 33" />
        <path className="running-kitten-ear-detail" d="m145 34-1-11 10 10m32 0 11-8-1 14" />
        <path className="running-kitten-head" d="M133 54c2-20 19-29 38-26 21 1 31 15 29 33l10 9q3 8-10 10c-9 15-26 22-43 14-20-6-28-22-24-40Z" />
        <path className="kitten-muzzle" d="M176 62q15-6 26 7 6 15-14 20-18-2-17-15Z" />
        <path className="running-kitten-coat-mark" d="m147 37 6 9m9-13 2 10m-27 14 10 3m-11 9 11 1" />
        <g className="running-kitten-eye"><ellipse cx="182" cy="56" rx="3.4" ry="4.2" /><circle className="kitten-eye-light" cx="183" cy="55" r="1" /></g>
        <path className="running-kitten-nose" d="m204 66 7 2-5 5Z" />
        <path className="running-kitten-mouth" d="M204 75q-3 5-9 3" />
        <path className="running-kitten-whiskers" d="m194 76-14-2m13 7-14 3" />
      </g>
    </svg>
  );
}

function SleepingKitten() {
  return (
    <svg className="kitten-sleeping" viewBox="0 0 220 154" aria-hidden="true">
      <path className="kitten-sleep-body" d="M39 117c-6-35 20-67 61-66 34-1 55 19 58 43 20-9 39-1 43 14 8 27-27 36-77 35-50 0-80-2-85-26Z" />
      <path className="kitten-sleep-stripes" d="m75 61 8 14m8-18 7 15m10-16 5 13" />
      <path className="kitten-sleep-head" d="m134 92 1-21 20 11q18-7 29 1l17-10-2 24q11 26-17 36-33 10-45-11-7-11-3-30Z" />
      <path className="kitten-sleep-ear" d="m141 86-1-8 10 7m38 5 9-10-1 15" />
      <path className="kitten-sleep-face" d="M147 107q6 6 12 0m18 0q6 6 12-1m-23 12 4 2 4-3" />
      <path className="kitten-sleep-tail" d="M54 102c-11 12-4 28 20 32 20 5 39 3 52-4" />
    </svg>
  );
}

function formatRunningKittenTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}
