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
export type MobileArtPlayerVariant = import("../../types").MobileHomePlayerStyle;

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
  flipTape: string;
  tapeHint: string;
  cassette: string;
  artwork: string;
  tapeRack: string;
  albumTracks: string;
  albumBack: string;
  expandTapes: string;
  collapseTapes: string;
  loadingTracks: string;
  failedTracks: string;
  emptyTapes: string;
  noAlbumTracks: string;
  retry: string;
  loading: string;
  loadMore: string;
  failedTapes: string;
}>;

export const REWIND_THEMES = ["rewind-classic", "rewind-studio", "rewind-crystal"] as const;
export function isRewindTheme(value: string | null | undefined): value is import("../../types").RewindTheme {
  return REWIND_THEMES.some((theme) => theme === value);
}

export const MATERIAL_THEMES = ["soft-vinyl", "gramophone", "stage-glass", "blue-halo", "moss-wave", "deep-sea", "amber-tape", "clear-tape"] as const;
export type MaterialTheme = (typeof MATERIAL_THEMES)[number];

export function isMaterialTheme(variant: MobileArtPlayerVariant): variant is MaterialTheme {
  return MATERIAL_THEMES.some((theme) => theme === variant);
}
