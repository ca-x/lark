export type PlayerThemePlayMode = "sequence" | "shuffle" | "repeat-one";
export type MobileArtPlayerVariant = "neon-console" | "indiewave" | "editorial-pulse" | "soft-vinyl" | "stage-glass" | "blue-halo";

export type MobileArtPlayerLabels = Partial<{
  nowPlaying: string;
  position: string;
  previous: string;
  next: string;
  play: string;
  pause: string;
  newRelease: string;
  musicEditor: string;
  ready: string;
  by: string;
  back: string;
  menu: string;
  favorite: string;
  queue: string;
  lyrics: string;
}>;
