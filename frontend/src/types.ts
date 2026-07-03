export type Theme =
  | "deep-space"
  | "amber-film"
  | "neon-coral"
  | "arctic-aurora"
  | "carbon-volt"
  | "apple-dark"
  | "spotify-dark"
  | "netease-dark"
  | "winamp-dark"
  | "foobar-dark"
  | "smartisan-classic"
  | "milk-porcelain"
  | "oat-latte"
  | "mint-soda"
  | "sakura-washi"
  | "dusk-amber"
  | "apple-light"
  | "spotify-light"
  | "netease-light"
  | "winamp-light"
  | "foobar-light";
export type Language = "zh-CN" | "en-US";

export interface Song {
  id: number;
  title: string;
  artist_id: number;
  artist: string;
  album_id: number;
  album: string;
  path: string;
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
  last_played_at?: string | null;
  resume_position_seconds: number;
  has_lyrics: boolean;
  lyrics_source: string;
  cover_version?: number;
  created_at?: string;
  updated_at?: string;
}
export interface SongPage {
  items: Song[];
  total: number;
  limit: number;
  offset: number;
  page: number;
}

export interface Album {
  id: number;
  title: string;
  artist_id: number;
  artist: string;
  album_artist: string;
  year: number;
  favorite: boolean;
  song_count: number;
  cover_version?: number;
}
export interface AlbumPage {
  items: Album[];
  total: number;
  limit: number;
  offset: number;
  page: number;
}

export interface Artist {
  id: number;
  name: string;
  initial: string;
  favorite: boolean;
  song_count: number;
  album_count: number;
}
export interface ArtistPage {
  items: Artist[];
  total: number;
  limit: number;
  offset: number;
  page: number;
  initials: string[];
}
export interface Playlist {
  id: number;
  name: string;
  description: string;
  cover_theme: string;
  favorite: boolean;
  song_count: number;
}
export interface PlaylistPage {
  items: Playlist[];
  total: number;
  limit: number;
  offset: number;
  page: number;
}

export interface SmartPlaylist {
  id: string;
  name: string;
  description: string;
  kind: string;
  enabled: boolean;
}
export interface Share {
  token: string;
  type: "song" | "album" | "artist" | "playlist" | string;
  id: number;
  title: string;
  url: string;
  created_by?: number;
  created_at: string;
  expires_at?: string;
}
export interface ShareList {
  shares: Share[];
}
export interface PublicShare {
  share: Share;
  songs: Song[];
}
export interface Folder {
  path: string;
  name: string;
  song_count: number;
  duration_seconds: number;
  cover_song_id: number;
}
export interface FolderBreadcrumb {
  path: string;
  name: string;
}
export interface FolderDirectory {
  path: string;
  name: string;
  parent_path: string;
  breadcrumbs: FolderBreadcrumb[];
  folders: Folder[];
  songs: Song[];
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
export interface MetadataCandidate {
  id: string;
  source: string;
  title: string;
  artist: string;
  album?: string;
  year?: number;
  cover?: string;
  release_date?: string;
  link?: string;
  path_groups?: number;
  song_count?: number;
}
export interface MetadataWritebackItem {
  song_id?: number;
  title?: string;
  path: string;
  status: "updated" | "skipped" | "failed" | string;
  message?: string;
}
export interface MetadataWritebackResult {
  updated: number;
  skipped: number;
  failed: number;
  items: MetadataWritebackItem[];
  song?: Song;
  album?: Album;
  albums?: Album[];
  songs?: Song[];
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

export interface OfflineAudioStatus {
  song_id: number;
  quality: number;
  status: "ready" | "building" | "missing" | "failed" | string;
  audio_url?: string;
  cover_url?: string;
  size_bytes: number;
  etag?: string;
  error?: string;
  song?: Song;
}

export interface MCPTokenStatus {
  configured: boolean;
  hint: string;
  token?: string;
}
export interface SubsonicCredentialStatus {
  configured: boolean;
  username: string;
  hint: string;
  endpoint: string;
}
export interface UISoundSettings {
  enabled: boolean;
  volume: number;
}
export interface PlaybackHistorySettings {
  separate_by_device: boolean;
}
export type HomePlayerStyle = "vinyl" | "cassette" | "ipod" | "audio-scope" | "album-slide" | "smartisan-turntable" | "gramophone" | "running-kitten" | "mineradio-stage";
export type MobileHomePlayerStyle = "neon-console" | "indiewave" | "editorial-pulse" | "soft-vinyl" | "gramophone" | "stage-glass" | "blue-halo" | "smartisan-classic";
export type ArtistAlbumDisplayStyle = "classic" | "showcase";
export type LyricsDisplayStyle = "immersive" | "classic" | "folia-monet" | "folia-fume" | "folia-tilt" | "folia-cadenza";
export type TerminalShellTheme = "operator" | "dusk" | "phosphor" | "ashgray" | "embers";
export interface UserPreferences {
  home_player_style: HomePlayerStyle;
  mobile_home_player_style: MobileHomePlayerStyle;
  mineradio_stage_enabled: boolean;
  artist_album_display_style: ArtistAlbumDisplayStyle;
  lyrics_display_style: LyricsDisplayStyle;
  lyrics_drag_seek_enabled: boolean;
  terminal_shell_theme: TerminalShellTheme;
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

export type PlaybackSourceType = "album" | "artist" | "playlist";

export interface PlaybackSource {
  type: PlaybackSourceType;
  source_id: number;
  updated_at: string;
}

export interface PlaybackSourceStatus {
  source?: PlaybackSource | null;
}

export interface PlaybackQueue {
  song_ids: number[];
  current_id: number;
  source?: PlaybackSource | null;
  radio?: PlaybackRadioSession | null;
  updated_at: string;
}

export interface PlaybackQueueStatus {
  queue?: PlaybackQueue | null;
}

export interface PlaybackRadioSession {
  current: RadioStation;
  queue?: RadioStation[];
}

export interface PlaybackHistoryEntry {
  id: number;
  song: Song;
  played_at: string;
  updated_at: string;
  progress_seconds: number;
  duration_seconds: number;
  completed: boolean;
  device_type: string;
}

export interface LibraryStats {
  songs: number;
  albums: number;
  artists: number;
  playlists: number;
}

export interface LibraryDirectory {
  id: string;
  path: string;
  note: string;
  builtin: boolean;
  watch_enabled: boolean;
  watch_active: boolean;
  status: "online" | "missing" | "not_directory" | "unreadable" | "error" | string;
  last_error?: string;
  last_checked_at?: string;
  created_at: string;
  updated_at: string;
}

export interface LibrarySource {
  id: string;
  name: string;
  kind: "local" | "network" | string;
  status: string;
  description: string;
}

export interface RadioSource {
  id: string;
  name: string;
  url: string;
  source_url: string;
  group_name: string;
  stream_url: string;
  builtin: boolean;
  favorite: boolean;
}

export interface NetworkSource {
  id: string;
  provider: "navidrome" | "jellyfin" | "plex" | "spotify" | string;
  name: string;
  base_url: string;
  username: string;
  password?: string;
  token?: string;
  has_password: boolean;
  has_token: boolean;
  status: string;
  last_error?: string;
}

export interface NetworkTrack {
  id: string;
  source_id: string;
  provider: string;
  title: string;
  artist: string;
  album: string;
  duration_seconds: number;
  year: number;
  cover_url: string;
  stream_url: string;
}

export interface RadioStation {
  id: string;
  name: string;
  url: string;
  source_url: string;
  group_name: string;
  stream_url: string;
  country: string;
  tags: string;
  codec: string;
  bitrate: number;
  votes: number;
  homepage: string;
  favicon: string;
  favorite: boolean;
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
  diagnostics_enabled: boolean;
  dlna_cast_enabled: boolean;
  dlna_library_enabled: boolean;
  dlna_server_name: string;
  dlna_media_base_url: string;
  dlna_allowed_ips: string;
  dlna_interfaces: string;
  playback_source_ttl_hours: number;
  playback_history_retention_days: number;
  web_font_family: string;
  web_font_url: string;
  lyrics_auto_save_to_song_dir: boolean;
  lyrics_font_family: string;
  lyrics_font_url: string;
  lyrics_font_size: number;
  metadata_grouping: boolean;
  library_tag_writeback: boolean;
  library_path_metadata_assist: boolean;
  smart_playlists_enabled: boolean;
  sharing_enabled: boolean;
  subsonic_server_enabled: boolean;
  transcode_policy: "auto" | "raw" | "transcode" | string;
  transcode_quality_kbps: number;
}

export interface DLNADevice {
  id: string;
  name: string;
  protocol: "DLNA" | string;
  state: "available" | "connecting" | "playing" | "unavailable" | string;
  manufacturer?: string;
  model?: string;
  last_seen_at: string;
}

export interface DLNAStatus {
  cast_enabled: boolean;
  library_enabled: boolean;
  output: "local" | "dlna" | string;
  device_id?: string;
  device_name?: string;
  state: "idle" | "playing" | "paused" | "stopped" | string;
}

export interface ScrobblingSettings {
  enabled: boolean;
  provider: "listenbrainz" | "lastfm" | string;
  token_hint: string;
  has_token: boolean;
  submit_now: boolean;
  min_seconds: number;
  percent_gate: number;
}
export interface ScanStatus {
  running: boolean;
  canceled: boolean;
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
  canceled: boolean;
  errors: string[];
  current_dir: string;
}
