import { isMaterialTheme } from "./types";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import {
  CaretDown,
  ChatText,
  HeartStraight,
  MusicNotes,
  Pause,
  Play,
  Queue,
  Repeat,
  RepeatOnce,
  Screencast,
  Shuffle,
  SkipBack,
  SkipForward,
  SpeakerSimpleHigh,
  SpeakerSimpleX,
  Timer,
} from "@phosphor-icons/react";

import type { MobileArtPlayerLabels, MobileArtPlayerVariant, PlayerThemePlayMode } from "./types";
import { MobilePlayerArtwork } from "./MobilePlayerArtwork";
import { PaperShaderLayer } from "./PaperShaderLayer";
import { useCoverFallback } from "./useCoverFallback";
import { useDiscScratchSeek } from "./useDiscScratchSeek";
import { resolvePlayerSwipe } from "../mobile/playerSwipe";
import { useDialogLifecycle } from "../../hooks/useDialogLifecycle";

const DEFAULT_LABELS = {
  nowPlaying: "Now playing",
  position: "Position",
  volume: "Volume",
  previous: "Previous",
  next: "Next",
  play: "Play",
  pause: "Pause",
  recentAdded: "Recently added",
  musicEditor: "Ipod",
  ready: "Ready",
  by: "By",
  back: "Back",
  menu: "Menu",
  favorite: "Favorite",
  soundEffects: "Sound effects",
  cast: "Play to device",
  queue: "Queue",
  sleepTimer: "Sleep timer",
  lyrics: "Lyrics",
};

type CoverVisualProps = {
  cover?: string;
  fallbackLabel: string;
  onCoverError?: () => void;
};

type DivScratchProps = HTMLAttributes<HTMLDivElement> & {
  "data-scratch-enabled"?: string;
  "data-scratching"?: string;
};

function isSwipeIgnoredTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest("button, input, select, textarea, a, [role='button'], [data-no-swipe='true']"));
}

export function MobileArtPlayer({
  mediaKey,
  variant,
  cover,
  playing,
  progress = 0,
  duration = 0,
  volume = 0.85,
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
  onVolume,
  onBack,
  onFavorite,
  onSoundEffects,
  onCast,
  onQueue,
  onSleepTimer,
  onLyrics,
  favoriteActive = false,
  soundEffectsActive = false,
  castActive = false,
  castLabel,
  queueActive = false,
  sleepTimerActive = false,
  lyricsActive = false,
}: {
  mediaKey?: string;
  variant: MobileArtPlayerVariant;
  cover?: string;
  playing: boolean;
  progress?: number;
  duration?: number;
  volume?: number;
  title?: string;
  artist?: string;
  album?: string;
  playMode?: PlayerThemePlayMode;
  playModeLabel?: string;
  labels?: MobileArtPlayerLabels;
  onToggle?: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  onCyclePlayMode?: () => void;
  onSeek?: (seconds: number) => void;
  onVolume?: (value: number) => void;
  onBack?: () => void;
  onFavorite?: () => void;
  onSoundEffects?: () => void;
  onCast?: () => void;
  onQueue?: () => void;
  onSleepTimer?: () => void;
  onLyrics?: () => void;
  favoriteActive?: boolean;
  soundEffectsActive?: boolean;
  castActive?: boolean;
  castLabel?: string;
  queueActive?: boolean;
  sleepTimerActive?: boolean;
  lyricsActive?: boolean;
}) {
  const text = { ...DEFAULT_LABELS, ...labels };
  const dialogRef = useDialogLifecycle<HTMLDivElement>(() => onBack?.(), Boolean(onBack));
  const [seekPreview, setSeekPreview] = useState<number | null>(null);
  const seeking = useRef<number | null>(null);
  const pct = duration > 0 ? Math.min(1, Math.max(0, progress / duration)) : 0;
  const smartisanScratch = useDiscScratchSeek({
    duration,
    progress,
    onSeek,
    disabled: variant !== "smartisan-classic",
  });
  const displayProgress = seekPreview ?? (variant === "smartisan-classic" ? smartisanScratch.progress : progress);
  const displayPct = seekPreview !== null && duration > 0 ? seekPreview / duration : variant === "smartisan-classic" ? smartisanScratch.pct : pct;
  const volumePct = Math.min(1, Math.max(0, volume));
  const canSeek = Boolean(duration && onSeek);
  const coverState = useCoverFallback(cover);
  const smartisanNeedleAngle = mobileSmartisanNeedleAngle(displayPct, duration, playing);
  const precisionTonearmAngle = mobilePrecisionTonearmAngle(pct, playing);
  const gramophoneTonearmAngle = mobileGramophoneTonearmAngle(pct, duration, playing);
  const fallbackLabel = coverFallbackLabel(title, artist);
  const style = {
    "--mobile-art-progress-pct": `${(displayPct * 100).toFixed(2)}%`,
    "--mobile-smartisan-needle": `${smartisanNeedleAngle.toFixed(2)}deg`,
    "--mobile-pa-tonearm": `${precisionTonearmAngle.toFixed(2)}deg`,
    "--mobile-gramophone-arm-angle": `${gramophoneTonearmAngle.toFixed(2)}deg`,
    ...(coverState.coverImage ? { "--mobile-art-cover-image": coverState.coverImage } : {}),
  } as CSSProperties;
  const swipeStart = useRef({
    x: 0,
    y: 0,
    lastX: 0,
    lastY: 0,
    startedAt: 0,
    lastAt: 0,
    sampleX: 0,
    sampleY: 0,
    sampleAt: 0,
    pointerId: -1,
    fromHeader: false,
    axis: "" as "" | "x" | "y",
    tracking: false,
  });

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button !== 0 || isSwipeIgnoredTarget(event.target)) {
      swipeStart.current.tracking = false;
      return;
    }
    if (event.clientX < 24 || event.clientX > window.innerWidth - 24) {
      swipeStart.current.tracking = false;
      return;
    }
    const now = performance.now();
    swipeStart.current = {
      x: event.clientX,
      y: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      startedAt: now,
      lastAt: now,
      sampleX: event.clientX,
      sampleY: event.clientY,
      sampleAt: now,
      pointerId: event.pointerId,
      fromHeader: event.target instanceof Element && Boolean(event.target.closest(".mobile-art-topbar")),
      axis: "",
      tracking: true,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const gesture = swipeStart.current;
    if (!gesture.tracking || gesture.pointerId !== event.pointerId) return;
    const deltaY = event.clientY - gesture.y;
    const deltaX = event.clientX - gesture.x;
    const absDeltaY = Math.abs(deltaY);
    const absDeltaX = Math.abs(deltaX);
    if (!gesture.axis && Math.max(absDeltaX, absDeltaY) > 10) {
      gesture.axis = absDeltaY > absDeltaX * 1.4 ? "y" : absDeltaX > absDeltaY * 1.4 ? "x" : "";
    }
    const now = performance.now();
    if (now - gesture.sampleAt > 80) {
      gesture.sampleX = gesture.lastX;
      gesture.sampleY = gesture.lastY;
      gesture.sampleAt = gesture.lastAt;
    }
    gesture.lastX = event.clientX;
    gesture.lastY = event.clientY;
    gesture.lastAt = now;
  }, []);

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const gesture = swipeStart.current;
    if (!gesture.tracking || gesture.pointerId !== event.pointerId) return;
    const now = performance.now();
    const deltaX = event.clientX - gesture.x;
    const deltaY = event.clientY - gesture.y;
    const action = resolvePlayerSwipe(deltaX, deltaY, now - gesture.startedAt, {
      dx: event.clientX - gesture.sampleX,
      dy: event.clientY - gesture.sampleY,
      idleMs: now - gesture.lastAt,
    });
    if (action === "collapse" && gesture.fromHeader) onBack?.();
    else if (action === "previous") onPrevious?.();
    else if (action === "next") onNext?.();
    swipeStart.current.tracking = false;
  }, [onBack, onPrevious, onNext]);

  const handlePointerCancel = useCallback(() => {
    swipeStart.current.tracking = false;
  }, []);
  useEffect(() => {
    // A seek or swipe belongs to the track on which it started. Natural track
    // changes must not apply the old preview position to the next song.
    seeking.current = null;
    setSeekPreview(null);
    swipeStart.current.tracking = false;
  }, [mediaKey]);
  const modeIcon =
    playMode === "shuffle" ? <Shuffle weight="bold" /> : playMode === "repeat-one" ? <RepeatOnce weight="bold" /> : <Repeat weight="bold" />;

  return (
    <div className={`mobile-art-player mobile-art-${variant}${isMaterialTheme(variant) ? " mobile-material-player" : ""}`} data-playing={playing ? "true" : "false"} style={style}>
      <div ref={dialogRef} role={onBack ? "dialog" : undefined} aria-modal={onBack ? true : undefined} aria-label={onBack ? text.nowPlaying : undefined} tabIndex={onBack ? -1 : undefined} className="mobile-art-phone" onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerCancel} onLostPointerCapture={handlePointerCancel}>
        <div className="mobile-art-bg" aria-hidden="true" />
        {!isMaterialTheme(variant) ? <PaperShaderLayer variant={`mobile-${variant}`} playing={playing} cover={coverState.displayUrl} compact /> : null}
        {onBack ? (
          <div className="mobile-art-topbar">
            <button type="button" className="mobile-art-topbar-icon" data-autofocus aria-label={text.back} onClick={onBack}>
              <CaretDown weight="bold" />
            </button>
            <span>{text.nowPlaying}</span>
            <span className="mobile-art-topbar-spacer" aria-hidden="true" />
          </div>
        ) : null}

        {isMaterialTheme(variant) ? (
          <MobilePlayerArtwork variant={variant} cover={coverState.displayUrl} fallbackLabel={fallbackLabel} playing={playing} progress={pct} onCoverError={coverState.onCoverError} />
        ) : variant === "neon-console" ? (
          <PrecisionAudioVisual cover={coverState.displayUrl} fallbackLabel={fallbackLabel} playing={playing} onCoverError={coverState.onCoverError} />
        ) : variant === "indiewave" ? (
          <IndiewaveVisual cover={coverState.displayUrl} fallbackLabel={fallbackLabel} playing={playing} onCoverError={coverState.onCoverError} />
        ) : variant === "editorial-pulse" ? (
          <EditorialPulseVisual
            cover={coverState.displayUrl}
            fallbackLabel={fallbackLabel}
            playing={playing}
            title={title}
            artist={artist}
            playModeIcon={modeIcon}
            playModeLabel={playModeLabel}
            labels={text}
            onCoverError={coverState.onCoverError}
            onToggle={onToggle}
            onPrevious={onPrevious}
            onNext={onNext}
            onCyclePlayMode={onCyclePlayMode}
          />

        ) : variant === "smartisan-classic" ? (
          <SmartisanClassicVisual
            cover={coverState.displayUrl}
            fallbackLabel={fallbackLabel}
            playing={playing}
            scratchProps={smartisanScratch.scratchProps}
            onCoverError={coverState.onCoverError}
          />
        ) : null}

        <div className="mobile-art-meta">
          <strong>{title}</strong>
          <span>{variant === "stage-glass" ? `${text.by} ${artist}` : artist}</span>
          <em>{album}</em>
          <button type="button" className={favoriteActive ? "mobile-art-favorite active" : "mobile-art-favorite"} aria-label={text.favorite} aria-pressed={favoriteActive} disabled={!onFavorite} onClick={onFavorite}>
            <HeartStraight weight={favoriteActive ? "fill" : "regular"} />
          </button>
        </div>


        <div className="mobile-art-progress">
          <div className="mobile-art-progress-rail">
            <span aria-hidden="true"><i /></span>
            <input
              key={mediaKey}
              aria-label={text.position}
              type="range"
              min="0"
              max={Math.max(0, duration || 0)}
              step="0.01"
              value={Math.min(displayProgress, duration || displayProgress || 0)}
              disabled={!canSeek}
              aria-valuetext={`${formatThemeTime(displayProgress)} / ${formatThemeTime(duration)}`}
              onPointerDown={(event) => {
                if (!event.isPrimary || seeking.current !== null) { event.preventDefault(); return; }
                seeking.current = event.pointerId;
              }}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (seeking.current !== null) setSeekPreview(value);
                else onSeek?.(value);
              }}
              onPointerUp={(event) => {
                if (seeking.current !== event.pointerId) return;
                onSeek?.(Number(event.currentTarget.value));
                seeking.current = null;
                setSeekPreview(null);
              }}
              onPointerCancel={(event) => { if (seeking.current === event.pointerId) { seeking.current = null; setSeekPreview(null); } }}
              onBlur={() => { seeking.current = null; setSeekPreview(null); }}
            />
          </div>
          <div className="mobile-art-time">
            <time>{formatThemeTime(displayProgress)}</time>
            <time>{formatThemeTime(duration || 0)}</time>
          </div>
        </div>

        <div className="mobile-art-controls">
          <button type="button" className={playMode === "sequence" ? "mobile-art-mode" : "mobile-art-mode active"} aria-label={playModeLabel} aria-pressed={playMode !== "sequence"} title={playModeLabel} disabled={!onCyclePlayMode} onClick={onCyclePlayMode}>
            {modeIcon}
          </button>
          <button type="button" aria-label={text.previous} disabled={!onPrevious} onClick={onPrevious}>
            <SkipBack weight="fill" />
          </button>
          <button type="button" className="mobile-art-play" aria-label={playing ? text.pause : text.play} disabled={!onToggle} onClick={onToggle}>
            {playing ? <Pause weight="fill" /> : <Play weight="fill" />}
          </button>
          <button type="button" aria-label={text.next} disabled={!onNext} onClick={onNext}>
            <SkipForward weight="fill" />
          </button>
          <button type="button" className={queueActive ? "mobile-art-queue active" : "mobile-art-queue"} aria-label={text.queue} aria-pressed={queueActive} disabled={!onQueue} onClick={onQueue}>
            <Queue weight={queueActive ? "fill" : "regular"} />
          </button>
        </div>
        <VolumeTicks value={volumePct} label={text.volume} onChange={onVolume} />

        <div className="mobile-art-actions" role="group" aria-label={text.menu}>
          <button type="button" className={soundEffectsActive ? "active" : ""} aria-label={text.soundEffects} aria-pressed={soundEffectsActive} disabled={!onSoundEffects} onClick={onSoundEffects}>
            <MusicNotes weight={soundEffectsActive ? "fill" : "regular"} />
            <span>{text.soundEffects}</span>
          </button>
          {onCast ? (
            <button type="button" className={castActive ? "active" : ""} aria-label={castLabel || text.cast} title={castLabel || text.cast} aria-pressed={castActive} onClick={onCast}>
              <Screencast weight={castActive ? "fill" : "regular"} />
              <span>{text.cast}</span>
            </button>
          ) : null}
          <button type="button" className={sleepTimerActive ? "active" : ""} aria-label={text.sleepTimer} aria-pressed={sleepTimerActive} disabled={!onSleepTimer} onClick={onSleepTimer}>
            <Timer weight={sleepTimerActive ? "fill" : "regular"} />
            <span>{text.sleepTimer}</span>
          </button>
          <button type="button" className={lyricsActive ? "active" : ""} aria-label={text.lyrics} aria-pressed={lyricsActive} disabled={!onLyrics} onClick={onLyrics}>
            <ChatText weight={lyricsActive ? "fill" : "regular"} />
            <span>{text.lyrics}</span>
          </button>
        </div>

      </div>
    </div>
  );
}

function VolumeTicks({
  value,
  label,
  onChange,
}: {
  value: number;
  label: string;
  onChange?: (value: number) => void;
}) {
  const activeCount = Math.round(value * 18);
  return (
    <div
      className="mobile-art-volume"
      data-muted={value <= 0.01 ? "true" : "false"}
      style={{ "--mobile-volume-pct": `${(value * 100).toFixed(2)}%` } as CSSProperties}
    >
      <span className="mobile-art-volume-icon" aria-hidden="true">
        {value <= 0.01 ? <SpeakerSimpleX weight="bold" /> : <SpeakerSimpleHigh weight="bold" />}
      </span>
      <div className="mobile-art-volume-ticks">
        <span className="mobile-art-volume-bars" aria-hidden="true">
          {Array.from({ length: 18 }, (_, index) => (
            <i key={index} className={index < activeCount ? "active" : ""} />
          ))}
        </span>
        <input
          aria-label={label}
          aria-valuetext={`${Math.round(value * 100)}%`}
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={value}
          disabled={!onChange}
          onChange={(event) => onChange?.(Number(event.target.value))}
        />
      </div>
    </div>
  );
}

function PrecisionAudioVisual({ cover, fallbackLabel, playing, onCoverError }: CoverVisualProps & { playing: boolean }) {
  return (
    <div className="mobile-pa-visual">
      <div className="mobile-pa-art-stack">
        <span className="mobile-pa-vinyl" data-has-cover={cover ? "true" : "false"} aria-hidden="true"><i>{cover ? null : fallbackLabel}</i></span>
        <div className="mobile-pa-cover" data-has-cover={cover ? "true" : "false"} data-fallback-label={fallbackLabel}>
          {cover ? <img src={cover} alt="" loading="eager" decoding="async" onError={onCoverError} /> : <MusicNotes weight="fill" />}
        </div>
      </div>
      <div className="mobile-pa-tonearm" aria-hidden="true">
        <span />
        <i />
      </div>
      <div className="mobile-pa-status" aria-hidden="true">
        <span className={playing ? "mobile-pa-led on" : "mobile-pa-led"} />
        <strong>33</strong>
        <em>RPM</em>
        <div className="mobile-pa-vu">
          {Array.from({ length: 8 }, (_, index) => <i key={index} style={{ "--vu-height": `${7 + index * 1.6}px` } as CSSProperties} />)}
        </div>
      </div>
    </div>
  );
}

function IndiewaveVisual({ cover, fallbackLabel, playing, onCoverError }: CoverVisualProps & { playing: boolean }) {
  return (
    <div className="mobile-indie-visual">
      <div className="mobile-indie-stack" data-playing={playing ? "true" : "false"}>
        <div className="mobile-indie-vinyl-rail" aria-hidden="true">
          <div className="mobile-indie-vinyl" data-has-cover={cover ? "true" : "false"}>
            <span>{cover ? null : fallbackLabel}</span>
          </div>
        </div>
        <div className="mobile-indie-cover" data-has-cover={cover ? "true" : "false"} data-fallback-label={fallbackLabel}>
          {cover ? <img src={cover} alt="" loading="eager" decoding="async" onError={onCoverError} /> : null}
          <span aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}

function EditorialPulseVisual({
  cover,
  fallbackLabel,
  playing,
  title,
  artist,
  playModeIcon,
  playModeLabel,
  labels,
  onCoverError,
  onToggle,
  onPrevious,
  onNext,
  onCyclePlayMode,
}: CoverVisualProps & {
  playing: boolean;
  title: string;
  artist: string;
  playModeIcon: ReactNode;
  playModeLabel: string;
  labels: typeof DEFAULT_LABELS;
  onToggle?: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  onCyclePlayMode?: () => void;
}) {
  return (
    <div className="mobile-editorial-visual" data-playing={playing ? "true" : "false"}>
      <div className="mobile-editorial-ipod">
        <span className="mobile-editorial-ipod-port" />
        <span className="mobile-editorial-ipod-switch" />
        <div className="mobile-editorial-ipod-screen">
          <div className="mobile-editorial-ipod-bar">
            <span>Now Playing</span>
            <i />
          </div>
          <div className="mobile-editorial-ipod-row">
            <div className="mobile-editorial-cover" data-has-cover={cover ? "true" : "false"} data-fallback-label={fallbackLabel}>
              {cover ? <img src={cover} alt="" loading="eager" decoding="async" onError={onCoverError} /> : null}
              <span />
            </div>
            <div className="mobile-editorial-ipod-text">
              <strong>{title}</strong>
              <em>{artist}</em>
            </div>
          </div>
          <div className="mobile-editorial-ipod-eq">
            {Array.from({ length: 9 }, (_, index) => <i key={index} style={{ "--eq-delay": `${index * -68}ms` } as CSSProperties} />)}
          </div>
        </div>
        <div className="mobile-editorial-wheel" data-no-swipe="true">
          <button
            type="button"
            className="mobile-editorial-wheel-button mobile-editorial-wheel-menu"
            aria-label={playModeLabel}
            title={playModeLabel}
            disabled={!onCyclePlayMode}
            onClick={onCyclePlayMode}
          >
            <span>MENU</span>
            <em>{playModeIcon}</em>
          </button>
          <button type="button" className="mobile-editorial-wheel-button mobile-editorial-wheel-prev" aria-label={labels.previous} disabled={!onPrevious} onClick={onPrevious}>
            <SkipBack weight="fill" />
          </button>
          <button type="button" className="mobile-editorial-wheel-button mobile-editorial-wheel-next" aria-label={labels.next} disabled={!onNext} onClick={onNext}>
            <SkipForward weight="fill" />
          </button>
          <button type="button" className="mobile-editorial-wheel-button mobile-editorial-wheel-play" aria-label={playing ? labels.pause : labels.play} disabled={!onToggle} onClick={onToggle}>
            {playing ? <Pause weight="fill" /> : <Play weight="fill" />}
          </button>
          <button type="button" className="mobile-editorial-center-button" aria-label={playing ? labels.pause : labels.play} disabled={!onToggle} onClick={onToggle}>
            <span />
          </button>
        </div>
      </div>
    </div>
  );
}

function SmartisanClassicVisual({
  cover,
  fallbackLabel,
  playing,
  scratchProps,
  onCoverError,
}: CoverVisualProps & { playing: boolean; scratchProps?: DivScratchProps }) {
  return (
    <div className="mobile-smartisan-stage">
      <div className="mobile-smartisan-deck">
        <div className="mobile-smartisan-record" data-has-cover={cover ? "true" : "false"} data-fallback-label={fallbackLabel} data-no-swipe="true" {...scratchProps}>
          <div className="mobile-smartisan-rotor" data-has-cover={cover ? "true" : "false"} data-fallback-label={fallbackLabel}>
            {cover ? <img src={cover} alt="" loading="eager" decoding="async" onError={onCoverError} /> : null}
            {cover ? null : <span className="mobile-smartisan-paper-label">{fallbackLabel}</span>}
            <span className="mobile-smartisan-spindle" />
          </div>
        </div>
        <div className="mobile-smartisan-needle" aria-hidden="true">
          <i className="mobile-smartisan-needle-base" />
          <i className="mobile-smartisan-needle-shadow" />
          <i className="mobile-smartisan-needle-arm" />
          <i className="mobile-smartisan-needle-top" />
        </div>
        <span className={playing ? "mobile-smartisan-led on" : "mobile-smartisan-led"} aria-hidden="true" />
      </div>
    </div>
  );
}

function formatThemeTime(value: number) {
  const total = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function coverFallbackLabel(title?: string, artist?: string) {
  const raw = `${artist || ""} ${title || ""}`.trim() || title || artist || "L";
  const parts = raw
    .split(/[\s._\-·/]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const chars = (parts.length >= 2 ? [parts[0][0], parts[1][0]] : Array.from(raw).slice(0, 2))
    .join("")
    .toUpperCase();
  return chars || "L";
}

function mobileSmartisanNeedleAngle(progressPct: number, duration: number, playing: boolean) {
  if (!playing) return 0;
  if (duration <= 0) return 12;
  return 12 + progressPct * 22.3;
}

function mobilePrecisionTonearmAngle(progressPct: number, playing: boolean) {
  if (!playing) return -14;
  return 15 + progressPct * 24;
}

function mobileGramophoneTonearmAngle(progressPct: number, duration: number, playing: boolean) {
  if (!playing) return -14;
  if (duration <= 0) return 17;
  return 17 + progressPct * 14;
}
