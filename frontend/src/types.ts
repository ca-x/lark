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
  year: number;
  netease_id: string;
  favorite: boolean;
  play_count: number;
  resume_position_seconds: number;
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
  favorite: boolean;
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
export interface Folder {
  path: string;
  name: string;
  song_count: number;
  duration_seconds: number;
  cover_song_id: number;
}
export interface Lyrics {
  song_id: number;
  source: string;
  lyrics: string;
  fetched: boolean;
}
export interface LyricCandidate {
  id: string;
  source: string;
  title: string;
  artist: string;
}
export interface User {
  id: number;
  username: string;
  nickname: string;
  avatar_data_url: string;
  role: "admin" | "user";
  created_at: string;
  updated_at: string;
}
export interface AuthStatus {
  initialized: boolean;
  registration_enabled: boolean;
  user?: User;
}

export interface MCPTokenStatus {
  configured: boolean;
  hint: string;
  token?: string;
}
export interface HealthInfo {
  status: string;
  version: string;
  full_version: string;
  commit: string;
  build_time: string;
  go_version: string;
  library: string;
  audio_backend: string;
  metadata_backend: string;
  transcode_backend: string;
}
export interface WebFont {
  name: string;
  family: string;
  url: string;
  size: number;
}
export interface Settings {
  language: Language;
  theme: Theme;
  sleep_timer_mins: number;
  library_path: string;
  netease_fallback: boolean;
  registration_enabled: boolean;
  web_font_family: string;
  web_font_url: string;
}
export interface ScanStatus {
  running: boolean;
  current_dir: string;
  current_path: string;
  scanned: number;
  added: number;
  updated: number;
  skipped: number;
  errors: string[];
  started_at?: string;
  finished_at?: string;
}
export interface ScanResult {
  scanned: number;
  added: number;
  updated: number;
  skipped: number;
  errors: string[];
  current_dir: string;
}
