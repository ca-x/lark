import type { Theme } from "./types";
import type { ThemeLabel, ThemeMode, PageSizing, LibraryTab } from "./types/app";

export const ADAPTIVE_STREAM_QUALITY = 128;
export const AUTO_DOWNGRADE_STALL_MS = 1200;
export const RADIO_STATION_LIMIT = 30;
export const HOME_RECENT_LIMIT = 12;
export const DEFAULT_LIBRARY_PAGE_SIZE = 36;
export const DEFAULT_GRID_PAGE_SIZE = 24;
export const MIN_PAGE_SIZE = 10;
export const MAX_LIBRARY_PAGE_SIZE = 80;
export const MAX_GRID_PAGE_SIZE = 72;
export const STARTUP_FOLDER_LIMIT = 80;
export const MAX_PLAYBACK_QUEUE_SIZE = 500;
export const RESUME_SOURCE_QUEUE_LIMIT = 50;
export const FAVORITES_FETCH_LIMIT = 500;
export const COLLECTION_DETAIL_SONG_LIMIT = MAX_PLAYBACK_QUEUE_SIZE;
export const OFFLINE_STATUS_POLL_MS = 1400;
export const OFFLINE_STATUS_MAX_POLLS = 120;
export const SONG_ROW_HEIGHT = 64;
export const VIRTUAL_TABLE_THRESHOLD = 220;
export const VIRTUAL_OVERSCAN = 8;
export const COLLECTION_LOAD_TIMEOUT_MS = 12_000;
export const LIBRARY_SOURCE_TAB_KEY = "lark.library-source-tab";
export const HOME_PLAYER_STYLE_KEY = "lark.home-player-style";
export const MOBILE_HOME_PLAYER_STYLE_KEY = "lark.mobile-home-player-style";
export const ARTIST_ALBUM_DISPLAY_STYLE_KEY = "lark.artist-album-display-style";
export const PERSISTENT_QUEUE_KEY = "lark.persistent-queue-enabled";
export const AUTO_CACHE_PLAYED_KEY = "lark.auto-cache-played-enabled";
export const AUTH_REDIRECT_KEY = "lark.auth.redirect";

export const defaultLibraryTab: LibraryTab = "songs";

export const themes: { id: Theme; label: ThemeLabel; mode: ThemeMode }[] = [
  { id: "deep-space", label: "deepSpace", mode: "dark" },
  { id: "amber-film", label: "amberFilm", mode: "dark" },
  { id: "neon-coral", label: "neonCoral", mode: "dark" },
  { id: "arctic-aurora", label: "arcticAurora", mode: "dark" },
  { id: "carbon-volt", label: "carbonVolt", mode: "dark" },
  { id: "apple-dark", label: "appleDark", mode: "dark" },
  { id: "spotify-dark", label: "spotifyDark", mode: "dark" },
  { id: "netease-dark", label: "neteaseDark", mode: "dark" },
  { id: "winamp-dark", label: "winampDark", mode: "dark" },
  { id: "foobar-dark", label: "foobarDark", mode: "dark" },
  { id: "smartisan-classic", label: "smartisanClassic", mode: "light" },
  { id: "milk-porcelain", label: "milkPorcelain", mode: "light" },
  { id: "oat-latte", label: "oatLatte", mode: "light" },
  { id: "mint-soda", label: "mintSoda", mode: "light" },
  { id: "sakura-washi", label: "sakuraWashi", mode: "light" },
  { id: "dusk-amber", label: "duskAmber", mode: "light" },
  { id: "apple-light", label: "appleLight", mode: "light" },
  { id: "spotify-light", label: "spotifyLight", mode: "light" },
  { id: "netease-light", label: "neteaseLight", mode: "light" },
  { id: "winamp-light", label: "winampLight", mode: "light" },
  { id: "foobar-light", label: "foobarLight", mode: "light" },
];

export const themeAliases: Record<string, Theme> = {
  spotify: "spotify-dark",
  apple: "apple-dark",
  vinyl: "amber-film",
  roon: "deep-space",
  netease: "netease-dark",
  winamp: "winamp-dark",
  foobar: "foobar-dark",
  midnight: "deep-space",
  smartisan: "smartisan-classic",
  hammer: "smartisan-classic",
  tnt: "smartisan-classic",
  paper: "amber-film",
  porcelain: "milk-porcelain",
  latte: "oat-latte",
  mint: "mint-soda",
  sakura: "sakura-washi",
  amber: "dusk-amber",
};

export const TRANSCODE_QUALITY_PRESETS = [
  { kbps: 128, label: "128 kbps" },
  { kbps: 192, label: "192 kbps" },
  { kbps: 256, label: "256 kbps" },
  { kbps: 320, label: "320 kbps" },
];

export const emptyOfflineUsage = {
  bytes: 0,
  entries: 0,
  audio_entries: 0,
};

export function clampPageSize(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function measurePageSizing(container: HTMLElement): PageSizing {
  const width = container.clientWidth || window.innerWidth;
  const height = container.clientHeight || window.innerHeight;
  const narrow = width <= 720;
  const contentHeight = Math.max(320, height - (narrow ? 156 : 116));
  const songRows = clampPageSize(
    Math.floor(contentHeight / SONG_ROW_HEIGHT),
    MIN_PAGE_SIZE,
    MAX_LIBRARY_PAGE_SIZE,
  );
  const cardMinWidth = narrow ? 150 : 172;
  const cardGap = narrow ? 10 : 16;
  const columns = Math.max(1, Math.floor((width + cardGap) / (cardMinWidth + cardGap)));
  const columnWidth = Math.max(
    cardMinWidth,
    (width - cardGap * Math.max(0, columns - 1)) / columns,
  );
  const cardHeight = narrow ? 218 : columnWidth + 72;
  const rows = Math.max(1, Math.floor(contentHeight / cardHeight));
  const maxFullRows = Math.max(1, Math.floor(MAX_GRID_PAGE_SIZE / columns));
  const minFullRows = Math.max(1, Math.ceil(MIN_PAGE_SIZE / columns));
  const cardRows = clampPageSize(rows, minFullRows, maxFullRows);
  const cards = columns * cardRows;
  return { songs: songRows, cards };
}
