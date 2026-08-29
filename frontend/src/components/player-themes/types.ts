export type PlayerThemePlayMode = "sequence" | "shuffle" | "repeat-one" | "order" | "single-play";
export type PlayerThemeLabels = Partial<{
  position: string;
  volume: string;
  previous: string;
  next: string;
  play: string;
  pause: string;
  seekBackward10: string;
  seekForward10: string;
  enter: string;
  controls: string;
}>;

const DEFAULT_PLAYER_THEME_LABELS = {
  position: "Position",
  volume: "Volume",
  previous: "Previous",
  next: "Next",
  play: "Play",
  pause: "Pause",
  seekBackward10: "Back 10 seconds",
  seekForward10: "Forward 10 seconds",
  enter: "Enter player",
  controls: "Player controls",
};

export function resolvePlayerThemeLabels(labels?: PlayerThemeLabels) {
  return { ...DEFAULT_PLAYER_THEME_LABELS, ...labels };
}
export type MobileArtPlayerVariant = "neon-console" | "indiewave" | "editorial-pulse" | "soft-vinyl" | "gramophone" | "stage-glass" | "blue-halo" | "smartisan-classic";

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
  cast: string;
  queue: string;
  sleepTimer: string;
  lyrics: string;
}>;
