import type { Album, PlaybackSourceType, Song } from "../types";
import type { OfflineCacheUsage, OfflineSongEntry } from "../features/offline/cache";

export type View =
  | "home"
  | "history"
  | "favorites"
  | "library"
  | "my"
  | "radio"
  | "playlists"
  | "albums"
  | "artists"
  | "collection"
  | "shares"
  | "settings"
  | "about";

export const MOBILE_PLAYBACK_VIEWS = new Set<View>([
  "home",
  "history",
  "favorites",
  "library",
  "my",
  "radio",
  "playlists",
  "albums",
  "artists",
  "collection",
  "settings",
  "about",
]);

export type PlayMode = "sequence" | "shuffle" | "repeat-one" | "order" | "single-play";
export type ResumeMode = "resume" | "restart";
export type PlaybackStartMode = "resume" | "restart";
export type PlaybackSourceInput = { type: PlaybackSourceType; source_id: number };
export type PlaySongOptions = {
  startMode?: PlaybackStartMode;
  source?: PlaybackSourceInput;
  keepPlaybackSource?: boolean;
};
export type StreamMode = "auto" | "adaptive";
export type RecentHomeTab = "played" | "added";
export type DailyDiscoveryView = "songs" | "albums" | "artists";

export type PageSizing = {
  songs: number;
  cards: number;
};

export type ThemeLabel =
  | "deepSpace"
  | "amberFilm"
  | "neonCoral"
  | "arcticAurora"
  | "carbonVolt"
  | "appleDark"
  | "spotifyDark"
  | "neteaseDark"
  | "winampDark"
  | "foobarDark"
  | "smartisanClassic"
  | "milkPorcelain"
  | "oatLatte"
  | "mintSoda"
  | "sakuraWashi"
  | "duskAmber"
  | "appleLight"
  | "spotifyLight"
  | "neteaseLight"
  | "winampLight"
  | "foobarLight";

export type ThemeMode = "dark" | "light";
export type SettingsTab = "account" | "playback" | "library" | "services" | "system" | "users" | "plugins";
export type LibraryTab = "songs" | "offline" | "folders" | "network" | "radio" | "manage";

export type Collection = {
  type: "playlist" | "album" | "artist";
  id?: number;
  title: string;
  subtitle: string;
  loading?: boolean;
  error?: string;
  favorite?: boolean;
  songs: Song[];
  albums?: Album[];
  coverUrl?: string;
  artistId?: number;
  artistName?: string;
};

export type OfflineCacheControls = {
  cachedSongIds: Set<number>;
  cachingSongIds: Set<number>;
  entries: OfflineSongEntry[];
  usage: OfflineCacheUsage;
  clearing: boolean;
  removingKeys: Set<string>;
  onCacheSong: (song: Song) => void;
  onCacheSongs: (songs: Song[]) => void;
  onRemoveSong: (entry: OfflineSongEntry) => void;
  onClearAll: () => void;
};
