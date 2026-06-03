export type PlayerThemePlayMode = "sequence" | "shuffle" | "repeat-one";
export type MobileArtPlayerVariant = "neon-console" | "indiewave" | "editorial-pulse" | "soft-vinyl" | "stage-glass" | "blue-halo" | "smartisan-classic";

export type MobileArtPlayerLabels = Partial<{
  nowPlaying: string;
  position: string;
  volume: string;
  previous: string;
  next: string;
  play: string;
  pause: string;
  recentAdded: string;
  musicEditor: string;
  ready: string;
  by: string;
  back: string;
  menu: string;
  favorite: string;
  soundEffects: string;
  queue: string;
  sleepTimer: string;
  lyrics: string;
}>;
