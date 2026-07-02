import { useCallback, useRef, useState, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import {
  CaretLeft,
  ChatText,
  HeartStraight,
  MusicNotes,
  Pause,
  Play,
  Queue,
  Repeat,
  RepeatOnce,
  Shuffle,
  SkipBack,
  SkipForward,
  SpeakerSimpleHigh,
  SpeakerSimpleX,
  Timer,
} from "@phosphor-icons/react";

import type { MobileArtPlayerLabels, MobileArtPlayerVariant, PlayerThemePlayMode } from "./types";
import { PaperShaderLayer } from "./PaperShaderLayer";
import { useCoverFallback } from "./useCoverFallback";
import { useDiscScratchSeek } from "./useDiscScratchSeek";

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
  onQueue,
  onSleepTimer,
  onLyrics,
  favoriteActive = false,
  soundEffectsActive = false,
  queueActive = false,
  sleepTimerActive = false,
  lyricsActive = false,
}: {
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
  onQueue?: () => void;
  onSleepTimer?: () => void;
  onLyrics?: () => void;
  favoriteActive?: boolean;
  soundEffectsActive?: boolean;
  queueActive?: boolean;
  sleepTimerActive?: boolean;
  lyricsActive?: boolean;
}) {
  const text = { ...DEFAULT_LABELS, ...labels };
  const pct = duration > 0 ? Math.min(1, Math.max(0, progress / duration)) : 0;
  const smartisanScratch = useDiscScratchSeek({
    duration,
    progress,
    onSeek,
    disabled: variant !== "smartisan-classic",
  });
  const displayProgress = variant === "smartisan-classic" ? smartisanScratch.progress : progress;
  const displayPct = variant === "smartisan-classic" ? smartisanScratch.pct : pct;
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
  const [swipeY, setSwipeY] = useState(0);
  const [swipeX, setSwipeX] = useState(0);
  const swipeStart = useRef({ x: 0, y: 0, tracking: false });

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (isSwipeIgnoredTarget(e.target)) {
      swipeStart.current.tracking = false;
      return;
    }
    const touch = e.touches[0];
    swipeStart.current = { x: touch.clientX, y: touch.clientY, tracking: true };
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!swipeStart.current.tracking) return;
    const touch = e.touches[0];
    const deltaY = touch.clientY - swipeStart.current.y;
    const deltaX = touch.clientX - swipeStart.current.x;
    const absDeltaY = Math.abs(deltaY);
    const absDeltaX = Math.abs(deltaX);
    if (absDeltaY > 10 && absDeltaY > absDeltaX * 1.25 && deltaY > 0) {
      setSwipeY(deltaY);
      setSwipeX(0);
    } else if (absDeltaX > 10 && absDeltaX > absDeltaY * 1.25) {
      setSwipeX(deltaX);
      setSwipeY(0);
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (swipeY > 100) onBack?.();
    else if (swipeX > 80) onPrevious?.();
    else if (swipeX < -80) {
      if (onLyrics) onLyrics();
      else onNext?.();
    }
    swipeStart.current.tracking = false;
    setSwipeY(0);
    setSwipeX(0);
  }, [swipeY, swipeX, onBack, onPrevious, onNext, onLyrics]);

  const handleTouchCancel = useCallback(() => {
    swipeStart.current.tracking = false;
    setSwipeY(0);
    setSwipeX(0);
  }, []);
  const modeIcon =
    playMode === "shuffle" ? <Shuffle weight="bold" /> : playMode === "repeat-one" ? <RepeatOnce weight="bold" /> : <Repeat weight="bold" />;

  return (
    <div className={`mobile-art-player mobile-art-${variant}`} data-playing={playing ? "true" : "false"} style={style}>
      <div className="mobile-art-phone" onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd} onTouchCancel={handleTouchCancel} style={{ transform: swipeY > 0 ? `translateY(${swipeY * 0.6}px)` : swipeX !== 0 ? `translateX(${swipeX * 0.4}px)` : undefined, transition: swipeY === 0 && swipeX === 0 ? "transform .35s var(--ease)" : "none", opacity: swipeY > 0 ? Math.max(0, 1 - swipeY / 400) : undefined }}>
        <div className="mobile-art-bg" aria-hidden="true" />
        {coverState.displayUrl ? (
          <div className="mobile-art-blur-bg" style={{ backgroundImage: `url(${coverState.displayUrl})` }} aria-hidden="true" />
        ) : null}
        <PaperShaderLayer variant={`mobile-${variant}`} playing={playing} cover={coverState.displayUrl} compact />
        {onBack ? (
          <div className="mobile-art-topbar">
            <button type="button" className="mobile-art-topbar-icon" aria-label={text.back} onClick={onBack}>
              <CaretLeft weight="bold" />
            </button>
            <span>{text.nowPlaying}</span>
            <span className="mobile-art-topbar-spacer" aria-hidden="true" />
          </div>
        ) : null}
        {onLyrics ? (
          <div className="mobile-art-page-dots" aria-hidden="true">
            <span className="active" />
            <span />
          </div>
        ) : null}

        {variant === "neon-console" ? (
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
        ) : variant === "soft-vinyl" ? (
          <SoftVinylVisual cover={coverState.displayUrl} fallbackLabel={fallbackLabel} onCoverError={coverState.onCoverError} />
        ) : variant === "gramophone" ? (
          <GramophoneVisual cover={coverState.displayUrl} fallbackLabel={fallbackLabel} playing={playing} onCoverError={coverState.onCoverError} />
        ) : variant === "stage-glass" ? (
          <StageGlassVisual cover={coverState.displayUrl} fallbackLabel={fallbackLabel} playing={playing} onCoverError={coverState.onCoverError} />
        ) : variant === "smartisan-classic" ? (
          <SmartisanClassicVisual
            cover={coverState.displayUrl}
            fallbackLabel={fallbackLabel}
            playing={playing}
            scratchProps={smartisanScratch.scratchProps}
            onCoverError={coverState.onCoverError}
          />
        ) : (
          <BlueHaloVisual cover={coverState.displayUrl} fallbackLabel={fallbackLabel} playing={playing} title={title} artist={artist} onCoverError={coverState.onCoverError} />
        )}

        <div className="mobile-art-meta">
          <span>{variant === "stage-glass" ? `${text.by} ${artist}` : artist}</span>
          <strong>{title}</strong>
          <em>{album}</em>
        </div>

        <div className="mobile-art-actions" aria-label={text.menu}>
          <button type="button" className={favoriteActive ? "active" : ""} aria-label={text.favorite} aria-pressed={favoriteActive} disabled={!onFavorite} onClick={onFavorite}>
            <HeartStraight weight={favoriteActive ? "fill" : "regular"} />
          </button>
          <button type="button" className={soundEffectsActive ? "active" : ""} aria-label={text.soundEffects} aria-pressed={soundEffectsActive} disabled={!onSoundEffects} onClick={onSoundEffects}>
            <MusicNotes weight={soundEffectsActive ? "fill" : "regular"} />
          </button>
          <button type="button" className={sleepTimerActive ? "active" : ""} aria-label={text.sleepTimer} aria-pressed={sleepTimerActive} disabled={!onSleepTimer} onClick={onSleepTimer}>
            <Timer weight={sleepTimerActive ? "fill" : "regular"} />
          </button>
          <button type="button" className={lyricsActive ? "active" : ""} aria-label={text.lyrics} aria-pressed={lyricsActive} disabled={!onLyrics} onClick={onLyrics}>
            <ChatText weight={lyricsActive ? "fill" : "regular"} />
          </button>
          <button type="button" className={queueActive ? "active" : ""} aria-label={text.queue} aria-pressed={queueActive} disabled={!onQueue} onClick={onQueue}>
            <Queue weight={queueActive ? "fill" : "regular"} />
          </button>
        </div>

        <VolumeTicks value={volumePct} label={text.volume} onChange={onVolume} />

        <div className="mobile-art-progress">
          <div className="mobile-art-progress-rail">
            <span aria-hidden="true"><i /></span>
            <input
              aria-label={text.position}
              type="range"
              min="0"
              max={Math.max(0, duration || 0)}
              step="0.01"
              value={Math.min(displayProgress, duration || displayProgress || 0)}
              disabled={!canSeek}
              onChange={(event) => onSeek?.(Number(event.target.value))}
            />
          </div>
          <div className="mobile-art-time">
            <time>{formatThemeTime(displayProgress)}</time>
            <time>{formatThemeTime(duration || 0)}</time>
          </div>
        </div>

        <div className="mobile-art-controls">
          <button type="button" aria-label={text.previous} disabled={!onPrevious} onClick={onPrevious}>
            <SkipBack weight="fill" />
          </button>
          <button type="button" className="mobile-art-play" aria-label={playing ? text.pause : text.play} disabled={!onToggle} onClick={onToggle}>
            {playing ? <Pause weight="fill" /> : <Play weight="fill" />}
          </button>
          <button type="button" aria-label={text.next} disabled={!onNext} onClick={onNext}>
            <SkipForward weight="fill" />
          </button>
          <button type="button" className={playMode === "sequence" ? "" : "active"} aria-label={playModeLabel} aria-pressed={playMode !== "sequence"} title={playModeLabel} disabled={!onCyclePlayMode} onClick={onCyclePlayMode}>
            {modeIcon}
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
    <div className="mobile-art-volume" data-muted={value <= 0.01 ? "true" : "false"}>
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

function SoftVinylVisual({ cover, fallbackLabel, onCoverError }: CoverVisualProps) {
  return (
    <div className="mobile-soft-stage">
      <div className="mobile-soft-deck">
        <div className="mobile-soft-record" data-has-cover={cover ? "true" : "false"} data-fallback-label={fallbackLabel}>
          {cover ? <img src={cover} alt="" loading="eager" decoding="async" onError={onCoverError} /> : null}
          <span>{cover ? null : fallbackLabel}</span>
        </div>
        <div className="mobile-soft-arm" aria-hidden="true"><i /></div>
        <span aria-hidden="true" className="mobile-soft-cube"><span /></span>
        <span aria-hidden="true" className="mobile-soft-knob" />
      </div>
    </div>
  );
}

function GramophoneVisual({ cover, fallbackLabel, playing, onCoverError }: CoverVisualProps & { playing: boolean }) {
  return (
    <div className="mobile-gramophone-stage" data-playing={playing ? "true" : "false"}>
      <div className="mobile-gramophone-platter">
        <div className="mobile-gramophone-record" data-has-cover={cover ? "true" : "false"} data-fallback-label={fallbackLabel}>
          <span className="mobile-gramophone-groove" aria-hidden="true" />
          <div className="mobile-gramophone-label" data-has-cover={cover ? "true" : "false"}>
            {cover ? <img src={cover} alt="" loading="eager" decoding="async" onError={onCoverError} /> : <span>{fallbackLabel}</span>}
            <i aria-hidden="true" />
          </div>
        </div>
        <div className="mobile-gramophone-arm" aria-hidden="true">
          <span />
          <i />
        </div>
      </div>
      <div className="mobile-gramophone-base" aria-hidden="true">
        <span className="mobile-gramophone-grille" />
        <strong>LARK</strong>
        <i className="mobile-gramophone-knob" />
        <em className="mobile-gramophone-led" />
        <b className="mobile-gramophone-foot left" />
        <b className="mobile-gramophone-foot right" />
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

function StageGlassVisual({ cover, fallbackLabel, playing, onCoverError }: CoverVisualProps & { playing: boolean }) {
  return (
    <div className="mobile-stage-visual" data-playing={playing ? "true" : "false"}>
      <div className="mobile-stage-disc" data-has-cover={cover ? "true" : "false"} data-fallback-label={fallbackLabel}>
        {cover ? <img src={cover} alt="" loading="eager" decoding="async" onError={onCoverError} /> : null}
        <i />
      </div>
      <div className="mobile-stage-arm" aria-hidden="true"><span /><i /></div>
    </div>
  );
}

function BlueHaloVisual({
  cover,
  fallbackLabel,
  playing,
  title,
  artist,
  onCoverError,
}: CoverVisualProps & { playing: boolean; title: string; artist: string }) {
  return (
    <div className="mobile-blue-visual" data-playing={playing ? "true" : "false"}>
      <div className="mobile-blue-cassette" aria-hidden="true">
        <div className="mobile-blue-cassette-head">
          <strong>SONIX</strong>
          <span className={playing ? "on" : ""}>TYPE II</span>
        </div>
        <div className="mobile-blue-cassette-shell">
          <div className="mobile-blue-cassette-cover" data-has-cover={cover ? "true" : "false"} data-fallback-label={fallbackLabel}>
            {cover ? <img src={cover} alt="" loading="eager" decoding="async" onError={onCoverError} /> : null}
            <span />
          </div>
          <div className="mobile-blue-cassette-label">
            <strong>{title}</strong>
            <em>{artist}</em>
          </div>
          <div className="mobile-blue-cassette-window">
            <span className="reel left"><i /></span>
            <span className="tape" />
            <span className="reel right"><i /></span>
          </div>
        </div>
        <div className="mobile-blue-cassette-vu">
          {Array.from({ length: 12 }, (_, index) => <i key={index} />)}
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
