import { useCallback, useRef, useState, type CSSProperties } from "react";
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
  Waveform,
} from "@phosphor-icons/react";

import type { MobileArtPlayerLabels, MobileArtPlayerVariant, PlayerThemePlayMode } from "./types";
import { useCoverFallback } from "./useCoverFallback";

const DEFAULT_LABELS = {
  nowPlaying: "Now playing",
  position: "Position",
  volume: "Volume",
  previous: "Previous",
  next: "Next",
  play: "Play",
  pause: "Pause",
  recentAdded: "Recently added",
  musicEditor: "Music Editor",
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
  onCoverError?: () => void;
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
  const volumePct = Math.min(1, Math.max(0, volume));
  const canSeek = Boolean(duration && onSeek);
  const coverState = useCoverFallback(cover);
  const smartisanNeedleAngle = mobileSmartisanNeedleAngle(pct, duration, playing);
  const style = {
    "--mobile-art-progress-pct": `${(pct * 100).toFixed(2)}%`,
    "--mobile-smartisan-needle": `${smartisanNeedleAngle.toFixed(2)}deg`,
    ...(coverState.coverImage ? { "--mobile-art-cover-image": coverState.coverImage } : {}),
  } as CSSProperties;
  const [swipeY, setSwipeY] = useState(0);
  const swipeStart = useRef({ x: 0, y: 0, tracking: false });

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!onBack || isSwipeIgnoredTarget(e.target)) {
      swipeStart.current.tracking = false;
      return;
    }
    const touch = e.touches[0];
    swipeStart.current = { x: touch.clientX, y: touch.clientY, tracking: true };
  }, [onBack]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!swipeStart.current.tracking) return;
    const touch = e.touches[0];
    const deltaY = touch.clientY - swipeStart.current.y;
    const deltaX = Math.abs(touch.clientX - swipeStart.current.x);
    if (deltaY > 10 && deltaY > deltaX * 1.25) setSwipeY(deltaY);
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (swipeY > 100) onBack?.();
    swipeStart.current.tracking = false;
    setSwipeY(0);
  }, [swipeY, onBack]);

  const handleTouchCancel = useCallback(() => {
    swipeStart.current.tracking = false;
    setSwipeY(0);
  }, []);
  const modeIcon =
    playMode === "shuffle" ? <Shuffle weight="bold" /> : playMode === "repeat-one" ? <RepeatOnce weight="bold" /> : <Repeat weight="bold" />;

  return (
    <div className={`mobile-art-player mobile-art-${variant}`} data-playing={playing ? "true" : "false"} style={style}>
      <div className="mobile-art-phone" onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd} onTouchCancel={handleTouchCancel} style={{ transform: swipeY > 0 ? `translateY(${swipeY * 0.6}px)` : undefined, transition: swipeY === 0 ? "transform .35s var(--ease)" : "none", opacity: swipeY > 0 ? Math.max(0, 1 - swipeY / 400) : undefined }}>
        <div className="mobile-art-bg" aria-hidden="true" />
        {onBack ? (
          <div className="mobile-art-topbar">
            <button type="button" className="mobile-art-topbar-icon" aria-label={text.back} onClick={onBack}>
              <CaretLeft weight="bold" />
            </button>
            <span>{text.nowPlaying}</span>
            <span className="mobile-art-topbar-spacer" aria-hidden="true" />
          </div>
        ) : null}

        {variant === "neon-console" ? (
          <NeonConsoleVisual cover={coverState.displayUrl} playing={playing} onCoverError={coverState.onCoverError} />
        ) : variant === "indiewave" ? (
          <IndiewaveVisual cover={coverState.displayUrl} onCoverError={coverState.onCoverError} />
        ) : variant === "editorial-pulse" ? (
          <EditorialPulseVisual cover={coverState.displayUrl} onCoverError={coverState.onCoverError} />
        ) : variant === "soft-vinyl" ? (
          <SoftVinylVisual cover={coverState.displayUrl} onCoverError={coverState.onCoverError} />
        ) : variant === "stage-glass" ? (
          <StageGlassVisual cover={coverState.displayUrl} playing={playing} onCoverError={coverState.onCoverError} />
        ) : variant === "smartisan-classic" ? (
          <SmartisanClassicVisual cover={coverState.displayUrl} playing={playing} onCoverError={coverState.onCoverError} />
        ) : (
          <BlueHaloVisual cover={coverState.displayUrl} onCoverError={coverState.onCoverError} />
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
              value={Math.min(progress, duration || progress || 0)}
              disabled={!canSeek}
              onChange={(event) => onSeek?.(Number(event.target.value))}
            />
          </div>
          <div className="mobile-art-time">
            <time>{formatThemeTime(progress)}</time>
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

function SoftVinylVisual({ cover, onCoverError }: CoverVisualProps) {
  return (
    <div className="mobile-soft-stage">
      <div className="mobile-soft-deck">
        <div className="mobile-soft-record" data-has-cover={cover ? "true" : "false"}>
          {cover ? <img src={cover} alt="" loading="eager" decoding="async" onError={onCoverError} /> : null}
          <span />
        </div>
        <div className="mobile-soft-arm" aria-hidden="true"><i /></div>
        <span aria-hidden="true" className="mobile-soft-cube"><span /></span>
        <span aria-hidden="true" className="mobile-soft-knob" />
      </div>
    </div>
  );
}

function NeonConsoleVisual({ cover, playing, onCoverError }: CoverVisualProps & { playing: boolean }) {
  return (
    <div className="mobile-neon-visual">
      <div className="mobile-neon-record" data-has-cover={cover ? "true" : "false"}>
        {cover ? <img src={cover} alt="" loading="eager" decoding="async" onError={onCoverError} /> : null}
        <span />
      </div>
      <span className={playing ? "mobile-neon-led on" : "mobile-neon-led"} />
    </div>
  );
}

function IndiewaveVisual({ cover, onCoverError }: CoverVisualProps) {
  return (
    <div className="mobile-indie-visual">
      <div className="mobile-indie-cover" data-has-cover={cover ? "true" : "false"}>
        {cover ? <img src={cover} alt="" loading="eager" decoding="async" onError={onCoverError} /> : null}
        <span aria-hidden="true" />
      </div>
    </div>
  );
}

function EditorialPulseVisual({ cover, onCoverError }: CoverVisualProps) {
  return (
    <div className="mobile-editorial-visual">
      <div className="mobile-editorial-cover" data-has-cover={cover ? "true" : "false"}>
        {cover ? <img src={cover} alt="" loading="eager" decoding="async" onError={onCoverError} /> : null}
        <span aria-hidden="true" />
      </div>
      <div className="mobile-editorial-record" aria-hidden="true">
        <span />
      </div>
      <div className="mobile-editorial-arcs" aria-hidden="true">
        <span className="green"><i /></span>
        <span className="orange"><i /></span>
        <span className="red"><i /></span>
      </div>
    </div>
  );
}

function StageGlassVisual({ cover, playing, onCoverError }: CoverVisualProps & { playing: boolean }) {
  return (
    <div className="mobile-stage-visual">
      <span className="mobile-stage-speaker left"><SpeakerSimpleX weight="bold" /></span>
      <div className="mobile-stage-disc" data-has-cover={cover ? "true" : "false"}>
        {cover ? <img src={cover} alt="" loading="eager" decoding="async" onError={onCoverError} /> : null}
        <i />
      </div>
      <span className="mobile-stage-speaker right"><SpeakerSimpleHigh weight="bold" /></span>
      <div className="mobile-stage-dots" aria-hidden="true">
        {Array.from({ length: 34 }, (_, index) => <i key={index} style={{ transform: `rotate(${index * 8 - 136}deg)` }} />)}
      </div>
      <span className={playing ? "mobile-stage-puck live" : "mobile-stage-puck"} />
    </div>
  );
}

function BlueHaloVisual({ cover, onCoverError }: CoverVisualProps) {
  return (
    <div className="mobile-blue-visual">
      <div className="mobile-blue-art" data-has-cover={cover ? "true" : "false"}>
        {cover ? <img src={cover} alt="" loading="eager" decoding="async" onError={onCoverError} /> : null}
        <span className="mobile-blue-statue" aria-hidden="true" />
      </div>
      <div className="mobile-blue-orbit" aria-hidden="true" />
      <span className="mobile-blue-signal" aria-hidden="true">
        <Waveform weight="bold" />
      </span>
    </div>
  );
}

function SmartisanClassicVisual({ cover, playing, onCoverError }: CoverVisualProps & { playing: boolean }) {
  return (
    <div className="mobile-smartisan-stage">
      <div className="mobile-smartisan-titlebar" aria-hidden="true">
        <span />
        <i />
        <span />
      </div>
      <div className="mobile-smartisan-deck">
        <div className="mobile-smartisan-record" data-has-cover={cover ? "true" : "false"}>
          {cover ? <img src={cover} alt="" loading="eager" decoding="async" onError={onCoverError} /> : null}
          <span />
        </div>
        <div className="mobile-smartisan-arm" aria-hidden="true"><i /></div>
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

function mobileSmartisanNeedleAngle(progressPct: number, duration: number, playing: boolean) {
  if (!playing || duration <= 0) return 0;
  return 12 + progressPct * 22.3;
}
