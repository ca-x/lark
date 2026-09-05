import type { MobileHomePlayerStyle } from "../../types";
import { useEffect, useEffectEvent } from "react";
import { MobileArtPlayer, type MobileArtPlayerLabels, type PlayerThemePlayMode } from "../player-themes";

export function MobilePlayerDock({
  mediaKey,
  theme,
  cover,
  playing,
  progress,
  duration,
  volume,
  title,
  artist,
  album,
  playMode,
  playModeLabel,
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
  favoriteActive,
  soundEffectsActive,
  castActive,
  castLabel,
  queueActive,
  sleepTimerActive,
  lyricsActive,
}: {
  mediaKey: string;
  theme: MobileHomePlayerStyle;
  cover?: string;
  playing: boolean;
  progress: number;
  duration: number;
  volume: number;
  title: string;
  artist: string;
  album: string;
  playMode: PlayerThemePlayMode;
  playModeLabel: string;
  labels?: MobileArtPlayerLabels;
  onToggle: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  onCyclePlayMode: () => void;
  onSeek: (seconds: number) => void;
  onVolume: (value: number) => void;
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
  const close = useEffectEvent(() => onBack?.());
  useEffect(() => {
    const previous = document.activeElement;
    document.querySelector<HTMLButtonElement>(".mobile-art-topbar-icon")?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented && !document.querySelector('[role="dialog"]')) {
        event.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
    // The dock mounts only while expanded; keep focus stable during playback.
  }, []);
  return (
    <MobileArtPlayer
      mediaKey={mediaKey}
      variant={theme}
      cover={cover}
      playing={playing}
      progress={progress}
      duration={duration}
      volume={volume}
      title={title}
      artist={artist}
      album={album}
      playMode={playMode}
      playModeLabel={playModeLabel}
      labels={labels}
      onToggle={onToggle}
      onPrevious={onPrevious}
      onNext={onNext}
      onCyclePlayMode={onCyclePlayMode}
      onSeek={onSeek}
      onVolume={onVolume}
      onBack={onBack}
      onFavorite={onFavorite}
      onSoundEffects={onSoundEffects}
      onCast={onCast}
      onQueue={onQueue}
      onSleepTimer={onSleepTimer}
      onLyrics={onLyrics}
      favoriteActive={favoriteActive}
      soundEffectsActive={soundEffectsActive}
      castActive={castActive}
      castLabel={castLabel}
      queueActive={queueActive}
      sleepTimerActive={sleepTimerActive}
      lyricsActive={lyricsActive}
    />
  );
}
