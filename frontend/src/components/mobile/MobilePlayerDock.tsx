import type { MobileHomePlayerStyle } from "../../types";
import { MobileArtPlayer, type MobileArtPlayerLabels, type PlayerThemePlayMode } from "../player-themes";

export function MobilePlayerDock({
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
  onQueue,
  onLyrics,
  favoriteActive,
  soundEffectsActive,
  queueActive,
  lyricsActive,
}: {
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
  onPrevious: () => void;
  onNext: () => void;
  onCyclePlayMode: () => void;
  onSeek: (seconds: number) => void;
  onVolume: (value: number) => void;
  onBack?: () => void;
  onFavorite?: () => void;
  onSoundEffects?: () => void;
  onQueue?: () => void;
  onLyrics?: () => void;
  favoriteActive?: boolean;
  soundEffectsActive?: boolean;
  queueActive?: boolean;
  lyricsActive?: boolean;
}) {
  return (
    <MobileArtPlayer
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
      onQueue={onQueue}
      onLyrics={onLyrics}
      favoriteActive={favoriteActive}
      soundEffectsActive={soundEffectsActive}
      queueActive={queueActive}
      lyricsActive={lyricsActive}
    />
  );
}
