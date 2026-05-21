import type { MobileHomePlayerStyle } from "../../types";
import { MobileArtPlayer, type MobileArtPlayerLabels, type PlayerThemePlayMode } from "../player-themes";

export function MobilePlayerDock({
  theme,
  cover,
  playing,
  progress,
  duration,
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
  onBack,
  onFavorite,
  onQueue,
  onLyrics,
  favoriteActive,
  queueActive,
  lyricsActive,
}: {
  theme: MobileHomePlayerStyle;
  cover?: string;
  playing: boolean;
  progress: number;
  duration: number;
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
  onBack?: () => void;
  onFavorite?: () => void;
  onQueue?: () => void;
  onLyrics?: () => void;
  favoriteActive?: boolean;
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
      onBack={onBack}
      onFavorite={onFavorite}
      onQueue={onQueue}
      onLyrics={onLyrics}
      favoriteActive={favoriteActive}
      queueActive={queueActive}
      lyricsActive={lyricsActive}
    />
  );
}
