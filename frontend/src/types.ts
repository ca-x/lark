export type Theme =
  | "deep-space"
  | "amber-film"
  | "neon-coral"
  | "arctic-aurora"
  | "carbon-volt"
  | "milk-porcelain"
  | "oat-latte"
  | "mint-soda"
  | "sakura-washi"
  | "dusk-amber";
export type Language = "zh-CN" | "en-US";

export interface Song {
  id: number;
  title: string;
  artist_id: number;
  artist: string;
  album_id: number;
  album: string;
  file_name: string;
  format: string;
  mime: string;
  size_bytes: number;
  duration_seconds: number;
  sample_rate: number;
  bit_rate: number;
  bit_depth: number;
  netease_id: string;
  favorite: boolean;
  play_count: number;
  has_lyrics: boolean;
  lyrics_source: string;
}

export interface Album {
  id: number;
  title: string;
  artist_id: number;
  artist: string;
  album_artist: string;
  favorite: boolean;
  song_count: number;
}
export interface Artist {
  id: number;
  name: string;
  song_count: number;
  album_count: number;
}
export interface Playlist {
  id: number;
  name: string;
  description: string;
  cover_theme: string;
  favorite: boolean;
  song_count: number;
}
export interface Lyrics {
  song_id: number;
  source: string;
  lyrics: string;
  fetched: boolean;
}
export interface Settings {
  language: Language;
  theme: Theme;
  sleep_timer_mins: number;
  library_path: string;
  netease_fallback: boolean;
}
export interface ScanResult {
  scanned: number;
  added: number;
  updated: number;
  skipped: number;
  errors: string[];
}
