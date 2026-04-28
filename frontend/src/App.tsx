import type { ChangeEvent, ReactNode, UIEvent } from "react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Disc,
  GearSix,
  Info,
  ArrowLeft,
  ArrowUp,
  CaretDown,
  CaretRight,
  ChatText,
  FolderSimple,
  Heart,
  HeartStraight,
  House,
  MagnifyingGlass,
  MusicNotes,
  Pause,
  Play,
  Playlist as PlaylistIcon,
  Plus,
  CopySimple,
  Queue,
  Record,
  Repeat,
  RepeatOnce,
  Shuffle,
  SlidersHorizontal,
  SkipBack,
  SkipForward,
  SpeakerSimpleHigh,
  Timer,
  UploadSimple,
  UserCircle,
  SignOut,
  X,
} from "@phosphor-icons/react";
import WavesurferPlayer from "@wavesurfer/react";
import { api } from "./services/api";
import {
  hasClientMediaSession,
  setClientActionHandler,
  setClientMediaMetadata,
  setClientPlaybackState,
  setClientPositionState,
  setLazycatImmersive,
  syncLazycatChrome,
} from "./services/lazycat";
import type {
  Album,
  Artist,
  AuthStatus,
  Folder,
  FolderDirectory,
  HealthInfo,
  Language,
  LyricCandidate,
  Lyrics,
  MCPTokenStatus,
  Playlist,
  ScanStatus,
  Settings,
  Song,
  Theme,
  User,
  WebFont,
  LibraryDirectory,
  LibraryStats,
  NetworkSource,
  NetworkTrack,
  RadioSource,
  RadioStation,
} from "./types";
import { createT } from "./i18n";
import { RadioReceiver } from "./components/RadioPlayer";
import { LoadingStage } from "./components/LoadingStage";
import { LibraryRadioSources, RadioView } from "./components/RadioLibrary";
import { radioGroupName } from "./components/radio";
import { VinylTurntable } from "./components/VinylPlayer";
import { EqualizerPanel } from "./components/EqualizerPanel";
import { EQ_FREQUENCIES, EQ_STORAGE_KEY, TONE_STORAGE_KEY, clampEqGain, storedEqualizer, storedToneControls } from "./components/equalizer";

const defaultSettings: Settings = {
  language: "zh-CN",
  theme: "deep-space",
  sleep_timer_mins: 0,
  library_path: "",
  netease_fallback: true,
  registration_enabled: false,
  web_font_url: "",
  web_font_family: "",
};

type View =
  | "home"
  | "favorites"
  | "library"
  | "radio"
  | "playlists"
  | "albums"
  | "artists"
  | "collection"
  | "settings"
  | "about";
type PlayMode = "sequence" | "shuffle" | "repeat-one";
type ResumeMode = "resume" | "restart";
type PlaybackStartMode = "resume" | "restart";
type StreamMode = "auto" | "adaptive";
const ADAPTIVE_STREAM_QUALITY = 128;
const AUTO_DOWNGRADE_STALL_MS = 1200;
const RADIO_STATION_LIMIT = 30;
const STARTUP_SONG_LIMIT = 300;
const STARTUP_ALBUM_LIMIT = 300;
const STARTUP_ARTIST_LIMIT = 300;
const STARTUP_PLAYLIST_LIMIT = 100;
const STARTUP_FOLDER_LIMIT = 80;
type ThemeLabel =
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
type ThemeMode = "dark" | "light";
type SettingsTab = "profile" | "users" | "site";
type LibraryTab = "songs" | "folders" | "network" | "radio";
type Collection = {
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
const themes: { id: Theme; label: ThemeLabel; mode: ThemeMode }[] = [
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
const themeAliases: Record<string, Theme> = {
  spotify: "spotify-dark",
  apple: "apple-dark",
  vinyl: "amber-film",
  roon: "deep-space",
  netease: "netease-dark",
  winamp: "winamp-dark",
  foobar: "foobar-dark",
  midnight: "deep-space",
  paper: "amber-film",
  porcelain: "milk-porcelain",
  latte: "oat-latte",
  mint: "mint-soda",
  sakura: "sakura-washi",
  amber: "dusk-amber",
};
const SONG_ROW_HEIGHT = 64;
const VIRTUAL_TABLE_THRESHOLD = 220;
const VIRTUAL_OVERSCAN = 8;
const CARD_GRID_BATCH = 72;
const COLLECTION_LOAD_TIMEOUT_MS = 12_000;
const LIBRARY_SOURCE_TAB_KEY = "lark.library-source-tab";
const AUTH_REDIRECT_KEY = "lark.auth.redirect";
const defaultLibraryTab: LibraryTab = "songs";

function normalizeLibraryTab(value?: string | null): LibraryTab {
  return value === "folders" || value === "network" || value === "radio" || value === "songs"
    ? value
    : defaultLibraryTab;
}

function storedLibraryTab(): LibraryTab {
  try {
    return normalizeLibraryTab(window.localStorage.getItem(LIBRARY_SOURCE_TAB_KEY));
  } catch {
    return defaultLibraryTab;
  }
}

function rememberLibraryTab(tab: LibraryTab) {
  try {
    window.localStorage.setItem(LIBRARY_SOURCE_TAB_KEY, tab);
  } catch {
    // localStorage can be unavailable in private/webview modes; local source remains default.
  }
}

function currentBrowserRoute() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function safeAuthRedirect(value: string | null) {
  if (!value || value.startsWith("/login")) return "/";
  return value.startsWith("/") ? value : "/";
}

function rememberAuthRedirect(value: string) {
  try {
    window.sessionStorage.setItem(AUTH_REDIRECT_KEY, value);
  } catch {
    // Session storage can be unavailable in private/webview modes.
  }
}

function takeAuthRedirect() {
  try {
    const redirect = window.sessionStorage.getItem(AUTH_REDIRECT_KEY);
    window.sessionStorage.removeItem(AUTH_REDIRECT_KEY);
    return safeAuthRedirect(redirect);
  } catch {
    return "/";
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs = COLLECTION_LOAD_TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error("request-timeout"));
    }, timeoutMs);
    promise
      .then(resolve, reject)
      .finally(() => window.clearTimeout(timer));
  });
}

function friendlyLoadError(error: unknown, t: ReturnType<typeof createT>) {
  if (error instanceof Error && error.message === "request-timeout") {
    return t("loadTimeout");
  }
  return t("loadFailed");
}

function normalizeTheme(theme: string): Theme {
  return themes.some((item) => item.id === theme)
    ? (theme as Theme)
    : (themeAliases[theme] ?? "deep-space");
}

function randomQueueIndex(length: number, currentIndex: number) {
  if (length <= 1) return 0;
  let nextIndex = Math.floor(Math.random() * length);
  if (nextIndex === currentIndex) nextIndex = (nextIndex + 1) % length;
  return nextIndex;
}

function uniqueSongs(items: Song[]) {
  const seen = new Set<number>();
  return items.filter((item) => {
    if (!item || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function queueWithCurrent(base: Song[], current?: Song | null) {
  const unique = uniqueSongs(base);
  if (!current) return unique;
  return unique.some((item) => item.id === current.id) ? unique : [current, ...unique];
}

function coverUrl(song?: Song | null) {
  return song ? `/api/songs/${song.id}/cover` : undefined;
}
function radioPlaybackURL(streamURL: string) {
  const trimmed = streamURL.trim();
  if (!trimmed || trimmed.startsWith("/")) return trimmed;
  if (!/^https?:\/\//i.test(trimmed)) return trimmed;
  return `/api/radio/stream?url=${encodeURIComponent(trimmed)}`;
}

function radioRawURL(station: RadioStation) {
  const direct = station.stream_url?.trim();
  if (direct) return direct;
  const value = station.url?.trim();
  if (!value) return "";
  if (value.startsWith("/api/radio/stream")) {
    const parsed = new URL(value, window.location.origin);
    return parsed.searchParams.get("url") || value;
  }
  return value;
}

function radioStationToPlayable(station: RadioStation): RadioStation {
  const rawURL = radioRawURL(station);
  return {
    ...station,
    source_url: station.source_url || "",
    group_name: station.group_name || "",
    stream_url: rawURL,
    url: radioPlaybackURL(station.url),
    favorite: Boolean(station.favorite),
  };
}

function radioSourceToStation(source: RadioSource): RadioStation {
  return {
    id: source.id,
    name: source.name,
    url: source.stream_url || source.url,
    source_url: source.source_url || "",
    group_name: source.group_name || "",
    stream_url: source.url,
    country: "",
    tags: source.group_name || source.source_url || "",
    codec: "",
    bitrate: 0,
    votes: 0,
    homepage: "",
    favicon: "",
    favorite: Boolean(source.favorite),
  };
}

function sameRadioStation(left?: RadioStation | null, right?: RadioStation | null) {
  if (!left || !right) return false;
  if (left.id && right.id && left.id === right.id) return true;
  return radioRawURL(left) === radioRawURL(right);
}

function radioSourceLabel(station: RadioStation, fallback: string) {
  const stationName = station.name.trim().toLowerCase();
  const seen = new Set<string>();
  const candidates = [
    station.group_name,
    station.country,
    station.source_url,
    station.homepage,
    station.tags,
  ];
  for (const candidate of candidates) {
    const value = candidate?.trim();
    const key = value?.toLowerCase();
    if (!value || !key || key === stationName || seen.has(key)) continue;
    seen.add(key);
    return value;
  }
  return fallback;
}

function albumCoverUrl(album?: Album | null) {
  return album ? `/api/albums/${album.id}/cover` : undefined;
}
function artistCoverUrl(artist?: Artist | null) {
  return artist ? `/api/artists/${artist.id}/cover` : undefined;
}

function formatDownloadSpeed(kbps: number) {
  if (!Number.isFinite(kbps) || kbps <= 0) return "";
  const kibPerSecond = kbps / 8;
  if (kibPerSecond >= 1024) return `${(kibPerSecond / 1024).toFixed(1)} MB/s`;
  if (kibPerSecond >= 100) return `${Math.round(kibPerSecond)} KB/s`;
  return `${kibPerSecond.toFixed(1)} KB/s`;
}

function radioStreamBitrateKbps(station?: RadioStation | null) {
  if (!station) return 0;
  if (station.bitrate > 0) return station.bitrate;
  return station.url.startsWith("/api/radio/stream") ? 128 : 0;
}

function formatDuration(seconds: number) {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}`;
}

function formatBytes(bytes: number) {
  if (!bytes) return "—";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

function resumePosition(song?: Song | null) {
  const progress = song?.resume_position_seconds || 0;
  const duration = song?.duration_seconds || 0;
  if (progress < 5) return 0;
  if (duration > 0 && progress >= duration - 5) return 0;
  return progress;
}

function resumePreferenceKey(user?: User | null) {
  return `lark.resume-mode.${user?.id ?? "guest"}`;
}

function storedResumeMode(user?: User | null): ResumeMode {
  return window.localStorage.getItem(resumePreferenceKey(user)) === "restart"
    ? "restart"
    : "resume";
}

function prefersLowBandwidthStream() {
  const connection = (
    navigator as Navigator & {
      connection?: { effectiveType?: string; saveData?: boolean };
    }
  ).connection;
  if (!connection) return false;
  return (
    connection.saveData === true ||
    ["slow-2g", "2g", "3g"].includes(connection.effectiveType ?? "")
  );
}

function prefersLowMemoryVisuals() {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return Boolean(nav.deviceMemory && nav.deviceMemory <= 4);
}

function streamUrl(song?: Song | null, mode: StreamMode = "auto", start = 0) {
  if (!song) return undefined;
  const params = new URLSearchParams({
    mode: mode === "adaptive" ? "transcode" : "auto",
  });
  if (mode === "adaptive") {
    params.set("quality", String(ADAPTIVE_STREAM_QUALITY));
    params.set("cache", "1");
    if (start > 0) params.set("start", start.toFixed(2));
  }
  return `/api/songs/${song.id}/stream?${params.toString()}`;
}

function defaultStreamMode(song?: Song | null): StreamMode {
  if (!song) return prefersLowBandwidthStream() ? "adaptive" : "auto";
  const format = song.format.toLowerCase().replace(/^\./, "");
  if (prefersLowBandwidthStream()) return "adaptive";
  if (["flac", "wav", "aiff", "aif", "ape", "dsf", "dff", "dst"].includes(format))
    return "adaptive";
  if (song.bit_rate > 320_000 || song.size_bytes > 28 * 1024 * 1024)
    return "adaptive";
  return "auto";
}

type AudioOutputSnapshot = {
  deviceIds: Set<string>;
  labels: Set<string>;
  headphoneLabels: Set<string>;
  specificCount: number;
  totalCount: number;
};

const HEADPHONE_OUTPUT_PATTERN =
  /(headphone|headset|earphone|earbud|airpods?|beats|bluetooth|bt|buds|耳机|蓝牙|耳塞)/i;

function audioOutputSnapshot(devices: MediaDeviceInfo[]): AudioOutputSnapshot {
  const outputs = devices.filter((device) => device.kind === "audiooutput");
  const specificOutputs = outputs.filter(
    (device) => device.deviceId && !["default", "communications"].includes(device.deviceId),
  );
  const labels = new Set(
    specificOutputs
      .map((device) => device.label.trim().toLowerCase())
      .filter(Boolean),
  );
  const headphoneLabels = new Set(
    Array.from(labels).filter((label) => HEADPHONE_OUTPUT_PATTERN.test(label)),
  );
  return {
    deviceIds: new Set(specificOutputs.map((device) => device.deviceId)),
    labels,
    headphoneLabels,
    specificCount: specificOutputs.length,
    totalCount: outputs.length,
  };
}

function setHasLostItem(previous: Set<string>, next: Set<string>) {
  for (const item of previous) {
    if (!next.has(item)) return true;
  }
  return false;
}

function audioOutputDisconnected(previous: AudioOutputSnapshot, next: AudioOutputSnapshot) {
  if (previous.headphoneLabels.size > 0) {
    return setHasLostItem(previous.headphoneLabels, next.headphoneLabels);
  }
  if (previous.deviceIds.size > 0) {
    return setHasLostItem(previous.deviceIds, next.deviceIds);
  }
  return previous.totalCount > 2 && next.totalCount < previous.totalCount;
}

function sanitizeFontFamily(value?: string) {
  return (value || "")
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .replace(/[^\p{L}\p{N} _-]/gu, "")
    .trim();
}

function sanitizeUploadedFontURL(value?: string) {
  const url = (value || "").trim();
  return url.startsWith("/api/fonts/") ? url : "";
}

function fontFormat(url: string) {
  const clean = url.toLowerCase().split("?")[0];
  if (clean.endsWith(".woff2")) return "woff2";
  if (clean.endsWith(".woff")) return "woff";
  if (clean.endsWith(".otf")) return "opentype";
  return "truetype";
}

function albumsFromSongs(
  songs: Song[],
  fallbackArtistId = 0,
  fallbackArtistName = "",
) {
  const grouped = new Map<number, Album>();
  songs.forEach((song) => {
    if (!song.album_id) return;
    const existing = grouped.get(song.album_id);
    grouped.set(song.album_id, {
      id: song.album_id,
      title: song.album,
      artist_id: song.artist_id || fallbackArtistId,
      artist: song.artist || fallbackArtistName,
      album_artist: song.artist || fallbackArtistName,
      year: existing?.year || song.year || 0,
      favorite: false,
      song_count: (existing?.song_count ?? 0) + 1,
    });
  });
  return Array.from(grouped.values()).sort((a, b) =>
    a.title.localeCompare(b.title),
  );
}

function formatQuality(song: Song) {
  const year = song.year ? String(song.year) : "";
  const bits = song.bit_depth ? `${song.bit_depth}bit` : "";
  const rate = song.sample_rate
    ? `${(song.sample_rate / 1000).toFixed(song.sample_rate % 1000 ? 1 : 0)}kHz`
    : "";
  return (
    [year, song.format.toUpperCase(), bits, rate].filter(Boolean).join(" · ") ||
    song.mime
  );
}

type LyricLine = {
  at: number;
  text: string;
  key: string;
  groupKey: string;
  order: number;
};

function parseTimestamp(value: string) {
  const parts = value.split(":");
  if (parts.length < 2 || parts.length > 3) return null;
  const secondsPart = parts.pop() ?? "0";
  const seconds = Number(secondsPart.replace(":", "."));
  const minutes = Number(parts.pop() ?? "0");
  const hours = Number(parts.pop() ?? "0");
  if (![seconds, minutes, hours].every(Number.isFinite)) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

function parseLyricLines(lyrics?: string): LyricLine[] {
  if (!lyrics) return [];
  let offsetSeconds = 0;
  const parsed: LyricLine[] = [];
  const timestampPattern =
    /\[((?:\d{1,2}:)?\d{1,2}:\d{1,2}(?:[.:]\d{1,3})?)\]/g;

  lyrics.split("\n").forEach((rawLine, order) => {
    const line = rawLine.trim();
    if (!line) return;
    const offsetMatch = line.match(/^\[offset:([+-]?\d+)\]/i);
    if (offsetMatch) {
      offsetSeconds = Number(offsetMatch[1]) / 1000;
      return;
    }

    const matches = [...line.matchAll(timestampPattern)];
    const text = line
      .replace(timestampPattern, "")
      .replace(/^\[[^\]]+\]/, "")
      .trim();
    if (!text) return;

    if (!matches.length) {
      if (!/^\[[a-z]+:/i.test(line))
        parsed.push({
          at: -1,
          text,
          key: `u-${order}`,
          groupKey: `u-${order}`,
          order,
        });
      return;
    }

    matches.forEach((match, tagIndex) => {
      const at = parseTimestamp(match[1]);
      if (at == null) return;
      const adjusted = Math.max(0, at + offsetSeconds);
      const groupKey = adjusted.toFixed(3);
      parsed.push({
        at: adjusted,
        text,
        key: `${order}-${tagIndex}-${groupKey}`,
        groupKey,
        order,
      });
    });
  });

  const sorted = parsed.sort((a, b) => {
    if (a.at < 0 && b.at < 0) return a.order - b.order;
    if (a.at < 0) return 1;
    if (b.at < 0) return -1;
    return a.at - b.at || a.order - b.order;
  });
  const firstTimedIndex = sorted.findIndex((line) => line.at >= 0);
  const firstTimed = firstTimedIndex >= 0 ? sorted[firstTimedIndex] : null;
  if (firstTimed && firstTimed.at > 0) {
    sorted[firstTimedIndex] = {
      ...firstTimed,
      at: 0,
      groupKey: "0.000",
      key: `intro-${firstTimed.key}`,
    };
    sorted.sort((a, b) => {
      if (a.at < 0 && b.at < 0) return a.order - b.order;
      if (a.at < 0) return 1;
      if (b.at < 0) return -1;
      return a.at - b.at || a.order - b.order;
    });
  }
  return sorted;
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  const [route, setRoute] = useState(() => currentBrowserRoute());
  const [songs, setSongs] = useState<Song[]>([]);
  const [dailyMix, setDailyMix] = useState<Song[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [libraryDirectories, setLibraryDirectories] = useState<LibraryDirectory[]>([]);
  const [libraryStats, setLibraryStats] = useState<LibraryStats | null>(null);
  const [networkSources, setNetworkSources] = useState<NetworkSource[]>([]);
  const [radioSources, setRadioSources] = useState<RadioSource[]>([]);
  const [radioStations, setRadioStations] = useState<RadioStation[]>([]);
  const [radioFavorites, setRadioFavorites] = useState<RadioStation[]>([]);
  const [radioQueue, setRadioQueue] = useState<RadioStation[]>([]);
  const [, setRadioLoading] = useState(false);
  const [selectedRadioGroup, setSelectedRadioGroup] = useState("");
  const [currentRadio, setCurrentRadio] = useState<RadioStation | null>(null);
  const [currentNetworkTrack, setCurrentNetworkTrack] = useState<NetworkTrack | null>(null);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [artists, setArtists] = useState<Artist[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [queue, setQueue] = useState<Song[]>([]);
  const [collection, setCollection] = useState<Collection | null>(null);
  const [collectionBack, setCollectionBack] = useState<Collection | null>(null);
  const [current, setCurrent] = useState<Song | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playMode, setPlayMode] = useState<PlayMode>("sequence");
  const [view, setView] = useState<View>("home");
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("profile");
  const [query, setQuery] = useState("");
  const [albumArtistFilter, setAlbumArtistFilter] = useState(0);
  const [lyrics, setLyrics] = useState<Lyrics | null>(null);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [lyricCandidates, setLyricCandidates] = useState<LyricCandidate[]>([]);
  const [lyricCandidatesOpen, setLyricCandidatesOpen] = useState(false);
  const [lyricCandidatesLoading, setLyricCandidatesLoading] = useState(false);
  const [lyricsFullScreen, setLyricsFullScreen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [playlistDialogOpen, setPlaylistDialogOpen] = useState(false);
  const [playlistSubmitting, setPlaylistSubmitting] = useState(false);
  const [playlistPickerSong, setPlaylistPickerSong] = useState<Song | null>(null);
  const [playlistPendingSong, setPlaylistPendingSong] = useState<Song | null>(null);
  const [scanStatus, setScanStatus] = useState<ScanStatus | null>(null);
  const [sleepTimerMins, setSleepTimerMins] = useState(0);
  const [sleepLeft, setSleepLeft] = useState(0);
  const [resumeMode, setResumeMode] = useState<ResumeMode>("resume");
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [buffering, setBuffering] = useState(false);
  const [radioDownloadKbps, setRadioDownloadKbps] = useState(0);
  const [volume, setVolume] = useState(0.85);
  const initialEq = useMemo(storedEqualizer, []);
  const initialTone = useMemo(storedToneControls, []);
  const [eqEnabled, setEqEnabled] = useState(initialEq.enabled);
  const [eqBands, setEqBands] = useState<number[]>(initialEq.bands);
  const [eqPanelOpen, setEqPanelOpen] = useState(false);
  const [bassGain, setBassGain] = useState(initialTone.bass);
  const [trebleGain, setTrebleGain] = useState(initialTone.treble);
  const [streamMode, setStreamMode] = useState<StreamMode>(() =>
    prefersLowBandwidthStream() ? "adaptive" : "auto",
  );
  const [streamOffset, setStreamOffset] = useState(0);
  const [inlineLyrics, setInlineLyrics] = useState(false);
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const eqFiltersRef = useRef<BiquadFilterNode[]>([]);
  const bassFilterRef = useRef<BiquadFilterNode | null>(null);
  const trebleFilterRef = useRef<BiquadFilterNode | null>(null);
  const eqAudioNodeRef = useRef<HTMLAudioElement | null>(null);
  const setAudioNode = useCallback((node: HTMLAudioElement | null) => {
    audioRef.current = node;
    if (node) node.volume = volume;
    setAudioEl((currentNode) => (currentNode === node ? currentNode : node));
  }, [volume]);
  const lyricsScrollRef = useRef<HTMLDivElement | null>(null);
  const lyricFollowPausedUntil = useRef(0);
  const messageTimerRef = useRef<number | null>(null);
  const resumeSeekRef = useRef(0);
  const progressRef = useRef(0);
  const lastProgressPaintRef = useRef(0);
  const radioDownloadSampleRef = useRef({ at: 0, ahead: 0 });
  const durationRef = useRef(0);
  const collectionRequestRef = useRef(0);
  const lastProgressSyncRef = useRef({ songId: 0, at: 0, progress: 0 });
  const pendingAutoplayRef = useRef(false);
  const stallDowngradeTimerRef = useRef<number | null>(null);
  const currentRef = useRef<Song | null>(null);
  const currentRadioRef = useRef<RadioStation | null>(null);
  const currentNetworkTrackRef = useRef<NetworkTrack | null>(null);
  const queueRef = useRef<Song[]>([]);
  const playModeRef = useRef<PlayMode>("sequence");
  const playingRef = useRef(false);
  const streamModeRef = useRef<StreamMode>(streamMode);
  const streamOffsetRef = useRef(0);
  const resumeModeRef = useRef<ResumeMode>(resumeMode);
  const playbackStartModeRef = useRef<PlaybackStartMode>("resume");
  const audioOutputSnapshotRef = useRef<AudioOutputSnapshot | null>(null);
  currentRef.current = current;
  currentRadioRef.current = currentRadio;
  currentNetworkTrackRef.current = currentNetworkTrack;
  progressRef.current = progress;
  durationRef.current = duration || current?.duration_seconds || 0;
  queueRef.current = queue;
  playModeRef.current = playMode;
  playingRef.current = playing;
  streamModeRef.current = streamMode;
  streamOffsetRef.current = streamOffset;
  resumeModeRef.current = resumeMode;
  const t = useMemo(() => createT(settings.language), [settings.language]);
  const lyricLines = useMemo(() => parseLyricLines(lyrics?.lyrics), [lyrics]);
  const activeLyric = useMemo(() => {
    let activeIndex = -1;
    for (let i = 0; i < lyricLines.length; i += 1) {
      if (lyricLines[i].at >= 0 && lyricLines[i].at <= progress + 0.08)
        activeIndex = i;
      if (lyricLines[i].at > progress + 0.08) break;
    }
    if (activeIndex < 0) return "";
    const activeGroup = lyricLines[activeIndex].groupKey;
    while (
      activeIndex > 0 &&
      lyricLines[activeIndex - 1].groupKey === activeGroup
    )
      activeIndex -= 1;
    return lyricLines[activeIndex].key;
  }, [lyricLines, progress]);
  const activeLyricText = useMemo(() => {
    if (!current) return t("nowPlaying");
    if (!lyricLines.length) return lyricsLoading ? t("matchingLyrics") : t("noLyrics");
    const line = lyricLines.find((item) => item.key === activeLyric);
    if (!line) return lyricLines.find((item) => item.at >= 0)?.text || t("lyrics");
    return (
      lyricLines
        .filter((item) => item.groupKey === line.groupKey)
        .map((item) => item.text)
        .filter(Boolean)
        .join(" / ") || line.text
    );
  }, [activeLyric, current, lyricLines, lyricsLoading, t]);

  const updateVolume = useCallback((value: number) => {
    const next = Math.max(0, Math.min(1, value));
    setVolume(next);
    if (audioRef.current) audioRef.current.volume = next;
  }, []);

  const ensureEqualizerGraph = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return null;
    if (eqAudioNodeRef.current === audio && audioContextRef.current && eqFiltersRef.current.length) {
      return audioContextRef.current;
    }
    audioSourceRef.current?.disconnect();
    bassFilterRef.current?.disconnect();
    trebleFilterRef.current?.disconnect();
    eqFiltersRef.current.forEach((filter) => filter.disconnect());
    const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return null;
    const ctx = new AudioContextCtor();
    const source = ctx.createMediaElementSource(audio);
    const bass = ctx.createBiquadFilter();
    bass.type = "lowshelf";
    bass.frequency.value = 80;
    bass.gain.value = 0;
    const filters = EQ_FREQUENCIES.map((frequency) => {
      const filter = ctx.createBiquadFilter();
      filter.type = "peaking";
      filter.frequency.value = frequency;
      filter.Q.value = 1;
      filter.gain.value = 0;
      return filter;
    });
    const treble = ctx.createBiquadFilter();
    treble.type = "highshelf";
    treble.frequency.value = 8000;
    treble.gain.value = 0;
    source.connect(bass);
    bass.connect(filters[0]);
    filters.forEach((filter, index) => {
      const next = filters[index + 1] || treble;
      filter.connect(next);
    });
    treble.connect(ctx.destination);
    audioContextRef.current = ctx;
    audioSourceRef.current = source;
    bassFilterRef.current = bass;
    trebleFilterRef.current = treble;
    eqFiltersRef.current = filters;
    eqAudioNodeRef.current = audio;
    return ctx;
  }, []);

  const resumeEqualizer = useCallback(() => {
    const ctx = audioContextRef.current;
    if (ctx?.state === "suspended") void ctx.resume().catch(() => undefined);
  }, []);

  const resetEqualizer = useCallback(() => {
    setEqBands(EQ_FREQUENCIES.map(() => 0));
  }, []);

  const updateBassGain = useCallback((value: number) => {
    setBassGain(clampEqGain(value));
  }, []);

  const updateTrebleGain = useCallback((value: number) => {
    setTrebleGain(clampEqGain(value));
  }, []);

  const updateEqBand = useCallback((index: number, value: number) => {
    setEqBands((bands) => bands.map((band, bandIndex) => (bandIndex === index ? clampEqGain(value) : band)));
  }, []);

  useEffect(() => {
    void bootstrap();
  }, []);

  useEffect(() => {
    const syncRoute = () => setRoute(currentBrowserRoute());
    window.addEventListener("popstate", syncRoute);
    return () => window.removeEventListener("popstate", syncRoute);
  }, []);

  useEffect(() => {
    if (authLoading) return;
    const routePath = window.location.pathname;
    const needsAuthPage = !auth?.initialized || !auth.user;
    if (needsAuthPage) {
      if (routePath !== "/login") {
        const redirect = currentBrowserRoute();
        if (!redirect.startsWith("/login")) {
          rememberAuthRedirect(redirect);
        }
        window.history.replaceState(null, "", "/login");
        setRoute(currentBrowserRoute());
      }
      return;
    }
    if (routePath === "/login") {
      window.history.replaceState(null, "", takeAuthRedirect());
      setRoute(currentBrowserRoute());
    }
  }, [authLoading, auth?.initialized, auth?.user?.id, route]);

  useEffect(() => {
    window.localStorage.setItem(EQ_STORAGE_KEY, JSON.stringify({ enabled: eqEnabled, bands: eqBands }));
  }, [eqEnabled, eqBands]);

  useEffect(() => {
    window.localStorage.setItem(TONE_STORAGE_KEY, JSON.stringify({ bass: bassGain, treble: trebleGain }));
  }, [bassGain, trebleGain]);

  useEffect(() => {
    const toneActive = Math.abs(bassGain) >= 0.1 || Math.abs(trebleGain) >= 0.1;
    if (!eqEnabled && !toneActive) {
      eqFiltersRef.current.forEach((filter) => {
        filter.gain.value = 0;
      });
      if (bassFilterRef.current) bassFilterRef.current.gain.value = 0;
      if (trebleFilterRef.current) trebleFilterRef.current.gain.value = 0;
      return;
    }
    const ctx = ensureEqualizerGraph();
    eqFiltersRef.current.forEach((filter, index) => {
      filter.gain.value = eqEnabled ? clampEqGain(eqBands[index] ?? 0) : 0;
    });
    if (bassFilterRef.current) bassFilterRef.current.gain.value = clampEqGain(bassGain);
    if (trebleFilterRef.current) trebleFilterRef.current.gain.value = clampEqGain(trebleGain);
    if (playingRef.current && ctx?.state === "suspended") void ctx.resume().catch(() => undefined);
  }, [audioEl, eqEnabled, eqBands, bassGain, trebleGain, ensureEqualizerGraph]);

  useEffect(() => {
    return () => {
      audioSourceRef.current?.disconnect();
      bassFilterRef.current?.disconnect();
      trebleFilterRef.current?.disconnect();
      eqFiltersRef.current.forEach((filter) => filter.disconnect());
      void audioContextRef.current?.close().catch(() => undefined);
      audioContextRef.current = null;
      audioSourceRef.current = null;
      eqAudioNodeRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!auth?.user) return;
    const nextResumeMode = storedResumeMode(auth.user);
    resumeModeRef.current = nextResumeMode;
    setResumeMode(nextResumeMode);
  }, [auth?.user?.id]);
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.lang = settings.language;
    document.title = `${t("brand")} Music`;
    window.requestAnimationFrame(() => syncLazycatChrome(settings.theme));
    const fontFamily = sanitizeFontFamily(settings.web_font_family);
    const fontURL = sanitizeUploadedFontURL(settings.web_font_url);
    const fontStyleId = "lark-web-font";
    const existing = document.getElementById(fontStyleId) as HTMLStyleElement | null;
    if (fontFamily && fontURL) {
      const style = existing || document.createElement("style");
      style.id = fontStyleId;
      style.textContent = `@font-face{font-family:"${fontFamily}";src:url("${fontURL}") format("${fontFormat(fontURL)}");font-display:swap;}`;
      if (!existing) document.head.appendChild(style);
      document.documentElement.dataset.customFont = "true";
      document.documentElement.style.setProperty("--app-font", `"${fontFamily}", var(--font-cjk)`);
    } else {
      existing?.remove();
      delete document.documentElement.dataset.customFont;
      document.documentElement.style.setProperty(
        "--app-font",
        "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', var(--font-cjk)",
      );
    }
  }, [settings.theme, settings.language, settings.web_font_url, settings.web_font_family, t]);
  useEffect(() => {
    if (!current) return;
    const shouldResume =
      playbackStartModeRef.current === "resume" && resumeModeRef.current === "resume";
    const resume = shouldResume ? resumePosition(current) : 0;
    playbackStartModeRef.current = "restart";
    const nextMode = defaultStreamMode(current);
    resumeSeekRef.current = resume;
    setProgress(resume);
    setDuration(current.duration_seconds || 0);
    setBufferedEnd(0);
    setBuffering(false);
    setStreamOffset(nextMode === "adaptive" ? resume : 0);
    setStreamMode(nextMode);
    setLyrics(null);
    setLyricCandidates([]);
    setLyricCandidatesOpen(false);
    setLyricsLoading(true);
    void api
      .lyrics(current.id)
      .then(setLyrics)
      .catch(() => setLyrics(null))
      .finally(() => setLyricsLoading(false));
  }, [current?.id]);
  const requestAudioPlay = useCallback(() => {
    const audio = audioRef.current;
    const song = currentRef.current;
    const radio = currentRadioRef.current;
    const networkTrack = currentNetworkTrackRef.current;
    if (!audio || (!song && !radio && !networkTrack)) return;
    const requestedKey = song
      ? `song:${song.id}`
      : radio
        ? `radio:${radio.id || radio.url}`
        : `network:${networkTrack?.source_id}:${networkTrack?.id}`;
    pendingAutoplayRef.current = true;
    if (eqEnabled) resumeEqualizer();
    void audio.play().then(() => {
      const activeKey = currentRef.current
        ? `song:${currentRef.current.id}`
        : currentRadioRef.current
          ? `radio:${currentRadioRef.current.id || currentRadioRef.current.url}`
          : currentNetworkTrackRef.current
            ? `network:${currentNetworkTrackRef.current.source_id}:${currentNetworkTrackRef.current.id}`
            : "";
      if (activeKey !== requestedKey) return;
      if (!pendingAutoplayRef.current && !playingRef.current) return;
      pendingAutoplayRef.current = false;
      setPlaying(true);
    }).catch((error) => {
      const activeKey = currentRef.current
        ? `song:${currentRef.current.id}`
        : currentRadioRef.current
          ? `radio:${currentRadioRef.current.id || currentRadioRef.current.url}`
          : currentNetworkTrackRef.current
            ? `network:${currentNetworkTrackRef.current.source_id}:${currentNetworkTrackRef.current.id}`
            : "";
      if (activeKey !== requestedKey) return;
      const name = error instanceof DOMException ? error.name : "";
      if (name === "AbortError" || audio.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        pendingAutoplayRef.current = true;
        return;
      }
      pendingAutoplayRef.current = false;
      setPlaying(false);
      showMessage(t("playbackFailed"));
    });
  }, [eqEnabled, resumeEqualizer, t]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || (!current && !currentRadio && !currentNetworkTrack)) return;
    audio.pause();
    audio.currentTime = 0;
    audio.load();
    if (playingRef.current || pendingAutoplayRef.current) {
      pendingAutoplayRef.current = true;
      window.requestAnimationFrame(requestAudioPlay);
    }
  }, [current?.id, currentRadio?.id, currentRadio?.url, currentNetworkTrack?.id, currentNetworkTrack?.source_id, requestAudioPlay]);

  useEffect(() => {
    if (!audioRef.current) return;
    if (playing) requestAudioPlay();
    else {
      pendingAutoplayRef.current = false;
      audioRef.current.pause();
    }
  }, [playing, current?.id, currentRadio?.id, currentRadio?.url, currentNetworkTrack?.id, currentNetworkTrack?.source_id, requestAudioPlay]);
  useEffect(() => {
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.enumerateDevices) return;
    let cancelled = false;
    let deviceChangeTimer: number | null = null;

    const inspectAudioOutputs = async () => {
      try {
        const nextSnapshot = audioOutputSnapshot(await mediaDevices.enumerateDevices());
        const previousSnapshot = audioOutputSnapshotRef.current;
        if (
          previousSnapshot &&
          playingRef.current &&
          audioOutputDisconnected(previousSnapshot, nextSnapshot)
        ) {
          pendingAutoplayRef.current = false;
          setPlaying(false);
          audioRef.current?.pause();
          showMessage(t("audioOutputDisconnected"));
        }
        if (!cancelled) audioOutputSnapshotRef.current = nextSnapshot;
      } catch {
        if (!cancelled) audioOutputSnapshotRef.current = null;
      }
    };

    const onDeviceChange = () => {
      if (deviceChangeTimer != null) window.clearTimeout(deviceChangeTimer);
      deviceChangeTimer = window.setTimeout(() => {
        deviceChangeTimer = null;
        void inspectAudioOutputs();
      }, 350);
    };

    void inspectAudioOutputs();
    mediaDevices.addEventListener?.("devicechange", onDeviceChange);
    return () => {
      cancelled = true;
      if (deviceChangeTimer != null) window.clearTimeout(deviceChangeTimer);
      mediaDevices.removeEventListener?.("devicechange", onDeviceChange);
    };
  }, [t]);

  useEffect(() => {
    if (!playing || !navigator.mediaDevices?.enumerateDevices) return;
    void navigator.mediaDevices
      .enumerateDevices()
      .then((devices) => {
        audioOutputSnapshotRef.current = audioOutputSnapshot(devices);
      })
      .catch(() => {
        audioOutputSnapshotRef.current = null;
      });
  }, [playing, current?.id, currentRadio?.id]);
  useEffect(() => {
    if (!sleepTimerMins) {
      setSleepLeft(0);
      return;
    }
    const end = Date.now() + sleepTimerMins * 60_000;
    setSleepLeft(sleepTimerMins * 60);
    const timer = window.setInterval(() => {
      const left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      setSleepLeft(left);
      if (left === 0) {
        setPlaying(false);
        setSleepTimerMins(0);
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [sleepTimerMins]);

  useEffect(() => {
    setLazycatImmersive(lyricsFullScreen);
    return () => setLazycatImmersive(false);
  }, [lyricsFullScreen]);

  useEffect(() => {
    if (!hasClientMediaSession()) return;
    if (current) {
      const artwork = coverUrl(current);
      setClientMediaMetadata({
        title: current.title || t("nowPlaying"),
        artist: current.artist || t("artist"),
        album: current.album || t("album"),
        artwork: artwork
          ? [
              {
                src: new URL(artwork, window.location.origin).toString(),
                sizes: "512x512",
                type: "image/jpeg",
              },
            ]
          : [],
      });
    } else if (currentNetworkTrack) {
      setClientMediaMetadata({
        title: currentNetworkTrack.title || t("nowPlaying"),
        artist: currentNetworkTrack.artist || t("artist"),
        album: currentNetworkTrack.album || t("networkLibrary"),
        artwork: currentNetworkTrack.cover_url
          ? [
              {
                src: new URL(currentNetworkTrack.cover_url, window.location.origin).toString(),
                sizes: "512x512",
                type: "image/jpeg",
              },
            ]
          : [],
      });
    } else if (currentRadio) {
      setClientMediaMetadata({
        title: currentRadio.name || t("onlineRadio"),
        artist: currentRadio.country || t("onlineRadio"),
        album: t("onlineRadio"),
        artwork: [],
      });
    } else {
      setClientMediaMetadata(null);
    }
    const handlers: Partial<Record<MediaSessionAction, MediaSessionActionHandler>> = {
      play: () => setPlaying(true),
      pause: () => setPlaying(false),
      stop: () => setPlaying(false),
      previoustrack: () => next(-1),
      nexttrack: () => next(1),
      seekbackward: (details) =>
        seekTo(Math.max(0, progressRef.current - (details.seekOffset || 10))),
      seekforward: (details) =>
        seekTo(
          Math.min(
            durationRef.current || progressRef.current + 10,
            progressRef.current + (details.seekOffset || 10),
          ),
        ),
      seekto: (details) => {
        if (typeof details.seekTime === "number") seekTo(details.seekTime);
      },
    };
    Object.entries(handlers).forEach(([action, handler]) => {
      setClientActionHandler(action as MediaSessionAction, handler ?? null);
    });
    return () => {
      Object.keys(handlers).forEach((action) => {
        setClientActionHandler(action as MediaSessionAction, null);
      });
    };
  }, [current?.id, currentRadio?.id, currentRadio?.url, currentNetworkTrack?.id, currentNetworkTrack?.source_id, t]);

  useEffect(() => {
    if (!hasClientMediaSession()) return;
    const hasPlayable = Boolean(current || currentRadio || currentNetworkTrack);
    setClientPlaybackState(playing ? "playing" : hasPlayable ? "paused" : "none");
    if ((!current && !currentNetworkTrack) || !duration) return;
    setClientPositionState({
      duration,
      playbackRate: audioRef.current?.playbackRate || 1,
      position: Math.min(progress, duration),
    });
  }, [current?.id, currentRadio?.id, currentNetworkTrack?.id, currentNetworkTrack?.source_id, duration, playing, progress]);

  useEffect(() => {
    return () => {
      if (messageTimerRef.current != null) {
        window.clearTimeout(messageTimerRef.current);
      }
      if (stallDowngradeTimerRef.current != null) {
        window.clearTimeout(stallDowngradeTimerRef.current);
      }
    };
  }, []);

  function showMessage(text: string, duration = 3500) {
    if (messageTimerRef.current != null) {
      window.clearTimeout(messageTimerRef.current);
      messageTimerRef.current = null;
    }
    setMessage(text);
    if (duration > 0) {
      messageTimerRef.current = window.setTimeout(() => {
        setMessage("");
        messageTimerRef.current = null;
      }, duration);
    }
  }

  useEffect(() => {
    if (
      !lyricsFullScreen ||
      !activeLyric ||
      Date.now() < lyricFollowPausedUntil.current
    )
      return;
    const container = lyricsScrollRef.current;
    const active = container?.querySelector<HTMLElement>(
      `[data-lyric-key="${CSS.escape(activeLyric)}"]`,
    );
    if (!container || !active) return;
    const target =
      active.offsetTop - container.clientHeight / 2 + active.clientHeight / 2;
    container.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
  }, [activeLyric, lyricsFullScreen]);

  async function bootstrap() {
    setAuthLoading(true);
    setAuthError("");
    try {
      const status = await api.authStatus();
      setAuth(status);
      void api.health().then(setHealth).catch(() => undefined);
      if (status.initialized && status.user) {
        const nextResumeMode = storedResumeMode(status.user);
        resumeModeRef.current = nextResumeMode;
        setResumeMode(nextResumeMode);
        playbackStartModeRef.current = "resume";
        await loadAppData();
      }
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : String(error));
    } finally {
      setAuthLoading(false);
    }
  }

  async function loadAppData() {
    const loaded = await api.settings().catch(() => defaultSettings);
    setSettings({ ...loaded, theme: normalizeTheme(loaded.theme) });
    await refreshAll({ initializeQueue: true });
  }

  async function submitAuth(mode: "setup" | "login" | "register", username: string, password: string) {
    setAuthError("");
    try {
      if (mode === "setup") await api.setup(username, password);
      else if (mode === "register") await api.register(username, password);
      else await api.login(username, password);
      await bootstrap();
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : String(error));
    }
  }

  async function logout() {
    await api.logout().catch(() => undefined);
    setSongs([]);
    setDailyMix([]);
    setFolders([]);
    setNetworkSources([]);
    setRadioSources([]);
    setRadioStations([]);
    setCurrentRadio(null);
    setRadioQueue([]);
    setCurrentNetworkTrack(null);
    setAlbums([]);
    setArtists([]);
    setPlaylists([]);
    setQueue([]);
    setCurrent(null);
    setPlaying(false);
    await bootstrap();
  }

  async function updateProfile(nickname: string, avatarDataURL: string) {
    const user = await api.updateProfile(nickname, avatarDataURL);
    if (!user) return;
    setAuth((old) => (old ? { ...old, user } : old));
    showMessage(t("done"));
  }

  function syncPlaybackProgress(completed = false) {
    if (!current) return;
    const audio = audioRef.current;
    const currentProgress = audio ? streamOffsetRef.current + audio.currentTime : progress;
    const mediaDuration = audio?.duration;
    const currentDuration =
      Number.isFinite(mediaDuration) && mediaDuration && mediaDuration > 0
        ? mediaDuration
        : duration || current.duration_seconds || 0;
    const now = Date.now();
    const last = lastProgressSyncRef.current;
    if (
      !completed &&
      last.songId === current.id &&
      now - last.at < 8000 &&
      Math.abs(currentProgress - last.progress) < 8
    )
      return;
    lastProgressSyncRef.current = {
      songId: current.id,
      at: now,
      progress: currentProgress,
    };
    void api
      .saveProgress(current.id, currentProgress, currentDuration, completed)
      .catch(() => undefined);
  }

  function updateBuffered(media: HTMLAudioElement) {
    const ranges = media.buffered;
    if (!ranges.length) {
      setBufferedEnd(0);
      return;
    }
    const currentTime = media.currentTime;
    for (let i = 0; i < ranges.length; i += 1) {
      if (ranges.start(i) <= currentTime && currentTime <= ranges.end(i)) {
        setBufferedEnd(streamOffsetRef.current + ranges.end(i));
        return;
      }
    }
    setBufferedEnd(streamOffsetRef.current + ranges.end(ranges.length - 1));
  }

  function updateRadioDownloadSpeed(media: HTMLAudioElement) {
    const radio = currentRadioRef.current;
    if (!radio) {
      radioDownloadSampleRef.current = { at: 0, ahead: 0 };
      setRadioDownloadKbps(0);
      return;
    }
    const bitrate = radioStreamBitrateKbps(radio);
    if (bitrate <= 0) return;
    const ahead = bufferedAhead(media);
    const now = performance.now();
    const previous = radioDownloadSampleRef.current;
    radioDownloadSampleRef.current = { at: now, ahead };
    if (!previous.at) return;
    const elapsedSeconds = (now - previous.at) / 1000;
    if (elapsedSeconds < 0.75) return;
    const bufferGrowth = (ahead - previous.ahead) / elapsedSeconds;
    const estimated = Math.max(0, Math.min(10000, bitrate * (bufferGrowth + (playingRef.current ? 1 : 0))));
    setRadioDownloadKbps((currentValue) => currentValue > 0 ? currentValue * 0.65 + estimated * 0.35 : estimated);
  }

  function bufferedAhead(media: HTMLAudioElement) {
    const currentTime = media.currentTime;
    for (let i = 0; i < media.buffered.length; i += 1) {
      if (media.buffered.start(i) <= currentTime && currentTime <= media.buffered.end(i)) {
        return Math.max(0, media.buffered.end(i) - currentTime);
      }
    }
    return 0;
  }

  function clearStallDowngradeTimer() {
    if (stallDowngradeTimerRef.current == null) return;
    window.clearTimeout(stallDowngradeTimerRef.current);
    stallDowngradeTimerRef.current = null;
  }

  function handlePlaybackStall(media: HTMLAudioElement) {
    if (!(playingRef.current || pendingAutoplayRef.current)) return;
    setBuffering(true);
    if (streamModeRef.current === "adaptive" || stallDowngradeTimerRef.current != null)
      return;
    const stalledAt = media.currentTime || 0;
    stallDowngradeTimerRef.current = window.setTimeout(() => {
      stallDowngradeTimerRef.current = null;
      const audio = audioRef.current;
      if (!audio || !currentRef.current || streamModeRef.current === "adaptive") return;
      const barelyMoved = Math.abs((audio.currentTime || 0) - stalledAt) < 0.25;
      const lowBuffer = bufferedAhead(audio) < 2.5;
      if (
        (playingRef.current || pendingAutoplayRef.current) &&
        (audio.readyState < HTMLMediaElement.HAVE_FUTURE_DATA || barelyMoved || lowBuffer)
      ) {
        const resumeAt = streamOffsetRef.current + (audio.currentTime || progress);
        resumeSeekRef.current = resumeAt;
        pendingAutoplayRef.current = true;
        setStreamOffset(resumeAt);
        setStreamMode("adaptive");
        showMessage(t("networkRescue"));
      }
    }, AUTO_DOWNGRADE_STALL_MS);
  }

  async function refreshAll(options: { initializeQueue?: boolean } = {}) {
    const [songItems, albumItems, artistItems, playlistItems, dailyItems, folderItems, libraryStatsItem, libraryDirectoryItems, networkSourceItems, radioSourceItems, radioStationItems, radioFavoriteItems] =
      await Promise.all([
        api.songs(query, STARTUP_SONG_LIMIT),
        api.albums(STARTUP_ALBUM_LIMIT),
        api.artists(STARTUP_ARTIST_LIMIT),
        api.playlists(STARTUP_PLAYLIST_LIMIT),
        api.dailyMix(24).catch(() => []),
        api.folders(STARTUP_FOLDER_LIMIT).catch(() => []),
        api.libraryStats().catch(() => null),
        api.libraryDirectories().catch(() => []),
        api.networkSources().catch(() => []),
        api.radioSources().catch(() => []),
        api.topRadioStations(RADIO_STATION_LIMIT).catch(() => []),
        api.radioFavorites().catch(() => []),
      ]);
    setSongs(songItems);
    setDailyMix(dailyItems);
    setFolders(folderItems);
    setLibraryStats(libraryStatsItem);
    setLibraryDirectories(libraryDirectoryItems);
    setNetworkSources(networkSourceItems);
    setRadioSources(radioSourceItems);
    setRadioStations(radioStationItems.map(radioStationToPlayable));
    setRadioFavorites(radioFavoriteItems.map(radioStationToPlayable));
    setAlbums(albumItems);
    setArtists(artistItems);
    setPlaylists(playlistItems);
    setQueue((old) => {
      if (!options.initializeQueue && old.length > 0) return old;
      return dailyItems.length > 0 ? dailyItems : songItems;
    });
    const nextCurrent = current
      ? (songItems.find((item) => item.id === current.id) ?? null)
      : (songItems[0] ?? null);
    setStreamOffset(0);
    setStreamMode(defaultStreamMode(nextCurrent));
    if (options.initializeQueue) playbackStartModeRef.current = "resume";
    setCurrent(nextCurrent);
    setCollection((old) => {
      if (!old) return old;
      return {
        ...old,
        songs: old.songs
          .map((song) => songItems.find((item) => item.id === song.id))
          .filter((song): song is Song => Boolean(song)),
        albums: old.albums
          ?.map((album) => albumItems.find((item) => item.id === album.id))
          .filter((album): album is Album => Boolean(album)),
      };
    });
  }

  async function playSong(
    song: Song,
    list = songs,
    options: { startMode?: PlaybackStartMode } = {},
  ) {
    const sameSong = current?.id === song.id;
    if (current && !sameSong) {
      syncPlaybackProgress(false);
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.currentTime = 0;
      }
    }
    playbackStartModeRef.current = options.startMode ?? "restart";
    pendingAutoplayRef.current = true;
    setBuffering(true);
    setRadioDownloadKbps(0);
    radioDownloadSampleRef.current = { at: 0, ahead: 0 };
    setStreamOffset(0);
    setStreamMode(defaultStreamMode(song));
    setCurrentRadio(null);
    setRadioQueue([]);
    setCurrentNetworkTrack(null);
    setCurrent(song);
    setQueue(queueWithCurrent(list.length ? list : [song], song));
    setDuration((value) => value || song.duration_seconds || 0);
    if (sameSong && audioRef.current) {
      audioRef.current.currentTime = 0;
      setProgress(0);
      const mediaDuration = audioRef.current.duration;
      setDuration(
        Number.isFinite(mediaDuration) && mediaDuration > 0
          ? mediaDuration
          : song.duration_seconds || 0,
      );
      window.requestAnimationFrame(requestAudioPlay);
    }
    setPlaying(true);
    await api.markPlayed(song.id).catch(() => undefined);
  }

  function playRadio(station: RadioStation, list?: RadioStation[]) {
    if (!station?.url) return;
    if (current) syncPlaybackProgress(false);
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    pendingAutoplayRef.current = true;
    setBuffering(true);
    setRadioDownloadKbps(0);
    radioDownloadSampleRef.current = { at: 0, ahead: 0 };
    setCurrent(null);
    const playableStation = radioStationToPlayable(station);
    setCurrentRadio(playableStation);
    setRadioQueue((list?.length ? list : [station]).map(radioStationToPlayable));
    setCurrentNetworkTrack(null);
    setLyrics(null);
    setLyricCandidates([]);
    setProgress(0);
    setDuration(0);
    setBufferedEnd(0);
    setStreamOffset(0);
    setStreamMode("auto");
    setPlaying(true);
  }

  function playNetworkTrack(track: NetworkTrack) {
    if (!track?.stream_url) return;
    if (current) syncPlaybackProgress(false);
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    pendingAutoplayRef.current = true;
    setBuffering(true);
    setRadioDownloadKbps(0);
    radioDownloadSampleRef.current = { at: 0, ahead: 0 };
    setCurrent(null);
    setCurrentRadio(null);
    setRadioQueue([]);
    setCurrentNetworkTrack(track);
    setLyrics(null);
    setLyricCandidates([]);
    setProgress(0);
    setDuration(track.duration_seconds || 0);
    setBufferedEnd(0);
    setStreamOffset(0);
    setStreamMode("auto");
    setPlaying(true);
  }

  async function loadRadioStations(search = "") {
    setRadioLoading(true);
    try {
      const items = search.trim()
        ? await api.searchRadioStations(search, RADIO_STATION_LIMIT)
        : await api.topRadioStations(RADIO_STATION_LIMIT);
      setRadioStations(items.map(radioStationToPlayable));
    } catch {
      showMessage(t("loadFailed"));
    } finally {
      setRadioLoading(false);
    }
  }

  async function addRadioSource(name: string, url: string) {
    await api.addRadioSource(name, url);
    setRadioSources(await api.radioSources());
    showMessage(t("done"));
  }

  async function deleteRadioSource(id: string) {
    await api.deleteRadioSource(id);
    setRadioSources(await api.radioSources());
    showMessage(t("done"));
  }

  function next(delta: 1 | -1, ended = false) {
    if (currentRadioRef.current) {
      if (ended) {
        pendingAutoplayRef.current = false;
        setPlaying(false);
        return;
      }
      const activeRadio = currentRadioRef.current;
      const radioList = radioQueue.length ? radioQueue : radioStations.length ? radioStations : radioSources.map(radioSourceToStation);
      const currentIndex = radioList.findIndex((station) => station.url === activeRadio.url || station.id === activeRadio.id);
      if (radioList.length > 1) {
        const nextIndex = currentIndex >= 0
          ? (currentIndex + delta + radioList.length) % radioList.length
          : delta > 0
            ? 0
            : radioList.length - 1;
        playRadio(radioList[nextIndex]);
      }
      return;
    }
    if (currentNetworkTrackRef.current) {
      if (ended) {
        pendingAutoplayRef.current = false;
        setPlaying(false);
      }
      return;
    }
    const active = currentRef.current;
    const activeQueue = queueRef.current.length
      ? queueRef.current
      : active
        ? [active]
        : [];
    const mode = playModeRef.current;
    if (!active || activeQueue.length === 0) return;
    if (ended) syncPlaybackProgress(true);
    if (ended && mode === "repeat-one") {
      const audio = audioRef.current;
      if (audio) {
        audio.currentTime = 0;
        setStreamOffset(0);
        setProgress(0);
        const mediaDuration = audio.duration;
        setDuration(
          Number.isFinite(mediaDuration) && mediaDuration > 0
            ? mediaDuration
            : active.duration_seconds || 0,
        );
      }
      pendingAutoplayRef.current = true;
      setPlaying(true);
      requestAudioPlay();
      void api.markPlayed(active.id).catch(() => undefined);
      return;
    }
    if (ended && activeQueue.length < 2) {
      pendingAutoplayRef.current = false;
      setPlaying(false);
      setProgress(duration || active.duration_seconds || progress);
      return;
    }
    const idx = activeQueue.findIndex((song) => song.id === active.id);
    const baseIndex =
      idx >= 0 ? idx : delta > 0 ? -1 : activeQueue.length;
    const target =
      mode === "shuffle" && activeQueue.length > 1
        ? activeQueue[randomQueueIndex(activeQueue.length, Math.max(0, idx))]
        : activeQueue[(baseIndex + delta + activeQueue.length) % activeQueue.length];
    if (ended && target.id === active.id) {
      pendingAutoplayRef.current = false;
      setPlaying(false);
      setProgress(duration || active.duration_seconds || progress);
      return;
    }
    if (target.id === active.id && audioRef.current) {
      audioRef.current.currentTime = 0;
      setStreamOffset(0);
      setProgress(0);
      const mediaDuration = audioRef.current.duration;
      setDuration(
        Number.isFinite(mediaDuration) && mediaDuration > 0
          ? mediaDuration
          : target.duration_seconds || 0,
      );
      pendingAutoplayRef.current = true;
      setPlaying(true);
      requestAudioPlay();
      return;
    }
    void playSong(target, activeQueue);
  }

  function insertNextBatch(items: Song[]) {
    const requested = uniqueSongs(items.filter(Boolean));
    if (!requested.length) return;
    if (!current) {
      setQueue(requested);
      void playSong(requested[0], requested);
      showMessage(t("queueInserted"));
      return;
    }
    let inserted = 0;
    setQueue((old) => {
      const base = queueWithCurrent(old.length ? old : [current], current);
      const baseIDs = new Set(base.map((song) => song.id));
      const batch = requested.filter((song) => song.id !== current.id && !baseIDs.has(song.id));
      inserted = batch.length;
      if (!batch.length) return base;
      const idx = Math.max(0, base.findIndex((song) => song.id === current.id));
      return [...base.slice(0, idx + 1), ...batch, ...base.slice(idx + 1)];
    });
    if (inserted || requested.length) showMessage(t("queueInserted"));
  }

  function seekTo(seconds: number) {
    const audio = audioRef.current;
    const target = Math.max(0, Number(seconds) || 0);
    setProgress(target);
    if (streamModeRef.current === "adaptive") {
      setBuffering(true);
      pendingAutoplayRef.current = true;
      setStreamOffset(target);
      if (audio) {
        audio.pause();
        audio.currentTime = 0;
      }
      window.requestAnimationFrame(requestAudioPlay);
      syncPlaybackProgress(false);
      if (current && !playing) setPlaying(true);
      return;
    }
    if (!audio) return;
    try {
      if (typeof audio.fastSeek === "function") audio.fastSeek(target);
      else audio.currentTime = target;
    } catch {
      audio.currentTime = target;
    }
    syncPlaybackProgress(false);
    if (current && !playing) setPlaying(true);
  }

  async function openLyricCandidates() {
    if (!current) return;
    setLyricCandidatesOpen(true);
    setLyricCandidatesLoading(true);
    try {
      setLyricCandidates(await api.lyricCandidates(current.id));
    } finally {
      setLyricCandidatesLoading(false);
    }
  }

  async function selectLyricCandidate(candidate: LyricCandidate) {
    if (!current) return;
    setLyricsLoading(true);
    try {
      const selected = await api.selectLyrics(
        current.id,
        candidate.source,
        candidate.id,
      );
      setLyrics(selected);
      setLyricCandidatesOpen(false);
      setProgress(0);
    } finally {
      setLyricsLoading(false);
    }
  }

  function cyclePlayMode() {
    setPlayMode((mode) =>
      mode === "sequence"
        ? "shuffle"
        : mode === "shuffle"
          ? "repeat-one"
          : "sequence",
    );
  }

  async function scan() {
    showMessage(`${t("scanning")}...`, 0);
    let refreshBusy = false;
    let lastLibraryRefresh = 0;
    const refreshLibraryDuringScan = () => {
      const now = Date.now();
      if (refreshBusy || now - lastLibraryRefresh < 2000) return;
      refreshBusy = true;
      lastLibraryRefresh = now;
      void refreshAll().finally(() => {
        refreshBusy = false;
      });
    };
    const poll = window.setInterval(() => {
      void api
        .scanStatus()
        .then((status) => {
          setScanStatus(status);
          if (status.running) refreshLibraryDuringScan();
        })
        .catch(() => undefined);
    }, 500);
    try {
      refreshLibraryDuringScan();
      const result = await api.scan();
      const latest = await api.scanStatus().catch(() => null);
      setScanStatus(
        latest ?? {
          running: false,
          current_dir: result.current_dir,
          current_path: "",
          scanned: result.scanned,
          added: result.added,
          updated: result.updated,
          skipped: result.skipped,
          errors: result.errors,
        },
      );
      showMessage(
        `${t("done")}: +${result.added}, ↻${result.updated}, errors ${result.errors.length}`,
      );
      await refreshAll();
    } finally {
      window.clearInterval(poll);
    }
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    showMessage(`Uploading ${file.name}...`, 0);
    await api.upload(file);
    showMessage(t("done"));
    await refreshAll();
  }

  async function saveSettings(nextSettings: Settings) {
    setSettings(nextSettings);
    await api.saveSettings(nextSettings).catch(() => undefined);
  }

  function updateSongState(updated: Song) {
    setSongs((old) =>
      old.map((item) => (item.id === updated.id ? updated : item)),
    );
    setQueue((old) =>
      old.map((item) => (item.id === updated.id ? updated : item)),
    );
    setCollection((old) =>
      old
        ? {
            ...old,
            songs: old.songs.map((item) =>
              item.id === updated.id ? updated : item,
            ),
          }
        : old,
    );
    if (current?.id === updated.id) setCurrent(updated);
  }

  async function toggleFavorite(song: Song) {
    const updated = await api.favoriteSong(song.id);
    updateSongState(updated);
  }

  async function toggleAlbumFavorite(album: Album) {
    const updated = await api.favoriteAlbum(album.id);
    setAlbums((old) =>
      old.map((item) => (item.id === updated.id ? updated : item)),
    );
    setCollection((old) =>
      old?.type === "album" && old.id === updated.id
        ? {
            ...old,
            favorite: updated.favorite,
            subtitle: `${updated.artist} · ${old.songs.length} ${t("count")}`,
            artistId: updated.artist_id,
            artistName: updated.artist,
          }
        : old?.type === "artist"
          ? {
              ...old,
              albums: old.albums?.map((item) =>
                item.id === updated.id ? updated : item,
              ),
            }
          : old,
    );
  }

  async function toggleArtistFavorite(artistItem: Artist) {
    const updated = await api.favoriteArtist(artistItem.id);
    setArtists((old) =>
      old.map((item) => (item.id === updated.id ? updated : item)),
    );
    setCollection((old) =>
      old?.type === "artist" && old.id === updated.id
        ? { ...old, favorite: updated.favorite, title: updated.name }
        : old,
    );
  }

  async function toggleRadioFavorite(station: RadioStation) {
    const rawURL = radioRawURL(station);
    const payload = {
      ...station,
      url: rawURL,
      stream_url: rawURL,
    };
    const updated = radioStationToPlayable(await api.favoriteRadioStation(payload));
    const replaceStation = (item: RadioStation) =>
      sameRadioStation(item, updated) ? { ...item, favorite: updated.favorite } : item;
    setRadioStations((old) => old.map(replaceStation));
    setRadioQueue((old) => old.map(replaceStation));
    setRadioSources((old) =>
      old.map((source) =>
        source.id === updated.id || source.url === radioRawURL(updated)
          ? { ...source, favorite: updated.favorite }
          : source,
      ),
    );
    setRadioFavorites((old) => {
      const without = old.filter((item) => !sameRadioStation(item, updated));
      return updated.favorite ? [updated, ...without] : without;
    });
    setCurrentRadio((old) =>
      sameRadioStation(old, updated) ? { ...updated, url: old?.url || updated.url } : old,
    );
  }

  function createPlaylist() {
    setPlaylistDialogOpen(true);
  }

  async function submitCreatePlaylist(name: string, description: string) {
    setPlaylistSubmitting(true);
    try {
      const playlist = await api.createPlaylist(name, description, settings.theme);
      if (playlistPendingSong) {
        await api.addToPlaylist(playlist.id, playlistPendingSong.id);
        setPlaylistPendingSong(null);
      }
      setPlaylists(await api.playlists());
      setPlaylistDialogOpen(false);
      showMessage(t("done"));
      return playlist;
    } finally {
      setPlaylistSubmitting(false);
    }
  }

  async function addToPlaylist(song: Song) {
    const latest = await api.playlists();
    setPlaylists(latest);
    if (latest.length === 0) {
      setPlaylistPendingSong(song);
      createPlaylist();
      showMessage(t("createPlaylistFirst"));
      return;
    }
    setPlaylistPickerSong(song);
  }

  async function submitAddToPlaylist(playlistId: number) {
    if (!playlistPickerSong || !playlistId) return;
    await api.addToPlaylist(playlistId, playlistPickerSong.id);
    setPlaylistPickerSong(null);
    showMessage(t("done"));
    setPlaylists(await api.playlists());
  }

  function isSameCollection(left: Collection, right: Collection | null): right is Collection {
    return Boolean(right && left.type === right.type && left.id === right.id);
  }

  function collectionSubtitleForItems(target: Collection, items: Song[]) {
    if (target.type === "album") {
      return [
        target.artistName,
        items[0]?.year ? String(items[0].year) : "",
        `${items.length} ${t("count")}`,
      ].filter(Boolean).join(" · ");
    }
    return `${items.length} ${t("count")}`;
  }

  async function fetchCollectionSongs(target: Collection) {
    if (!target.id) return [];
    if (target.type === "playlist") return withTimeout(api.playlistSongs(target.id));
    if (target.type === "album") return withTimeout(api.albumSongs(target.id));
    return withTimeout(api.artistSongs(target.id));
  }

  async function resolveCollectionSongs(target: Collection) {
    if (target.songs.length) return target.songs;
    setCollection((old) =>
      isSameCollection(target, old)
        ? { ...old, loading: true, error: undefined }
        : old,
    );
    try {
      const items = await fetchCollectionSongs(target);
      setCollection((old) =>
        isSameCollection(target, old)
          ? {
              ...old,
              loading: false,
              error: undefined,
              songs: items,
              subtitle: collectionSubtitleForItems(old, items),
              coverUrl: old.coverUrl || (items[0] ? coverUrl(items[0]) : undefined),
              albums:
                old.type === "artist" && (!old.albums || !old.albums.length)
                  ? albumsFromSongs(items, old.artistId, old.artistName)
                  : old.albums,
            }
          : old,
      );
      return items;
    } catch (error) {
      const message = friendlyLoadError(error, t);
      setCollection((old) =>
        isSameCollection(target, old)
          ? { ...old, loading: false, error: message }
          : old,
      );
      showMessage(message);
      return [];
    }
  }

  async function playCollection(target: Collection) {
    const items = await resolveCollectionSongs(target);
    if (items[0]) void playSong(items[0], items);
  }

  async function insertCollectionNext(target: Collection) {
    const items = await resolveCollectionSongs(target);
    if (items.length) insertNextBatch(items);
  }

  function setCollectionLoadError(target: Collection, requestId: number, error: unknown) {
    if (requestId !== collectionRequestRef.current) return;
    const message = friendlyLoadError(error, t);
    setCollection((old) =>
      isSameCollection(target, old)
        ? {
            ...old,
            loading: false,
            error: message,
            subtitle: old.subtitle ? old.subtitle.replace(t("loading"), message) : message,
          }
        : old,
    );
    showMessage(message);
  }

  async function openPlaylist(playlist: Playlist) {
    setCollectionBack(null);
    const requestId = ++collectionRequestRef.current;
    const nextCollection: Collection = {
      type: "playlist",
      id: playlist.id,
      title: playlist.name,
      subtitle: t("loading"),
      loading: true,
      favorite: playlist.favorite,
      songs: [],
    };
    setCollection(nextCollection);
    setView("collection");
    try {
      const items = await withTimeout(api.playlistSongs(playlist.id));
      if (requestId !== collectionRequestRef.current) return;
      setCollection({
        type: "playlist",
        id: playlist.id,
        title: playlist.name,
        subtitle: `${items.length} ${t("count")}`,
        favorite: playlist.favorite,
        songs: items,
        coverUrl: items[0] ? coverUrl(items[0]) : undefined,
      });
    } catch (error) {
      setCollectionLoadError(nextCollection, requestId, error);
    }
  }

  async function openAlbum(album: Album, backTo: Collection | null = null) {
    setCollectionBack(backTo);
    const requestId = ++collectionRequestRef.current;
    const nextCollection: Collection = {
      type: "album",
      id: album.id,
      title: album.title,
      subtitle: [
        album.artist,
        album.year ? String(album.year) : "",
        t("loading"),
      ].filter(Boolean).join(" · "),
      loading: true,
      favorite: album.favorite,
      coverUrl: albumCoverUrl(album),
      artistId: album.artist_id,
      artistName: album.artist,
      songs: [],
    };
    setCollection(nextCollection);
    setView("collection");
    try {
      const items = await withTimeout(api.albumSongs(album.id), 20_000);
      const refreshedAlbums = await api.albums(STARTUP_ALBUM_LIMIT).catch(() => null);
      const refreshedAlbum = refreshedAlbums?.find((item) => item.id === album.id) ?? album;
      if (refreshedAlbums) setAlbums(refreshedAlbums);
      if (requestId !== collectionRequestRef.current) return;
      setCollection({
        type: "album",
        id: refreshedAlbum.id,
        title: refreshedAlbum.title,
        subtitle: [
          refreshedAlbum.artist,
          refreshedAlbum.year ? String(refreshedAlbum.year) : "",
          `${items.length} ${t("count")}`,
        ].filter(Boolean).join(" · "),
        favorite: refreshedAlbum.favorite,
        songs: items,
        coverUrl: albumCoverUrl(refreshedAlbum),
        artistId: refreshedAlbum.artist_id,
        artistName: refreshedAlbum.artist,
      });
    } catch (error) {
      setCollectionLoadError(nextCollection, requestId, error);
    }
  }

  async function openArtistById(id: number, fallbackName = "") {
    if (!id) return;
    setCollectionBack(null);
    const requestId = ++collectionRequestRef.current;
    const artist = artists.find((item) => item.id === id);
    const title = artist?.name || fallbackName || t("artists");
    const artistAlbums = albums.filter((album) => album.artist_id === id);
    const nextCollection: Collection = {
      type: "artist",
      id,
      title,
      subtitle: t("loading"),
      loading: true,
      favorite: artist?.favorite ?? false,
      songs: [],
      albums: artistAlbums,
      coverUrl: `/api/artists/${id}/cover`,
      artistId: id,
      artistName: title,
    };
    setCollection(nextCollection);
    setView("collection");
    try {
      const items = await withTimeout(api.artistSongs(id));
      if (requestId !== collectionRequestRef.current) return;
      const resolvedTitle =
        artist?.name || fallbackName || items[0]?.artist || t("artists");
      setCollection({
        type: "artist",
        id,
        title: resolvedTitle,
        subtitle: `${items.length} ${t("count")}`,
        favorite: artist?.favorite ?? false,
        songs: items,
        albums: artistAlbums.length
          ? artistAlbums
          : albumsFromSongs(items, id, resolvedTitle),
        coverUrl: `/api/artists/${id}/cover`,
        artistId: id,
        artistName: resolvedTitle,
      });
    } catch (error) {
      setCollectionLoadError(nextCollection, requestId, error);
    }
  }

  async function playAlbum(album: Album) {
    const items = await api.albumSongs(album.id);
    if (items[0]) void playSong(items[0], items);
  }

  async function playArtist(artist: Artist) {
    const items = await api.artistSongs(artist.id);
    if (items[0]) void playSong(items[0], items);
  }

  async function playPlaylist(playlist: Playlist) {
    const items = await api.playlistSongs(playlist.id);
    if (items[0]) void playSong(items[0], items);
  }

  async function playFolder(folder: Folder) {
    const items = await api.folderSongs(folder.path);
    if (items[0]) void playSong(items[0], items);
  }

  const nav = [
    { id: "home", label: t("home"), icon: <House /> },
    { id: "favorites", label: t("favorites"), icon: <Heart /> },
    { id: "library", label: t("library"), icon: <MusicNotes /> },
    { id: "playlists", label: t("playlists"), icon: <PlaylistIcon /> },
    { id: "albums", label: t("albums"), icon: <Disc /> },
    { id: "artists", label: t("artists"), icon: <Record /> },
    { id: "settings", label: t("settings"), icon: <GearSix /> },
    { id: "about", label: t("about"), icon: <Info /> },
  ] as const;
  const activeNav = (id: (typeof nav)[number]["id"]) =>
    view === id ||
    (view === "radio" && id === "library") ||
    (view === "collection" &&
      collection?.type === "playlist" &&
      id === "playlists") ||
    (view === "collection" &&
      collection?.type === "album" &&
      id === "albums") ||
    (view === "collection" &&
      collection?.type === "artist" &&
      id === "artists");
  const favoriteSongs = useMemo(
    () => songs.filter((song) => song.favorite),
    [songs],
  );
  const favoriteAlbums = useMemo(
    () => albums.filter((album) => album.favorite),
    [albums],
  );
  const favoriteArtists = useMemo(
    () => artists.filter((artist) => artist.favorite),
    [artists],
  );
  const heroSong = current ?? songs[0];
  const playModeLabel =
    playMode === "sequence"
      ? t("playModeSequence")
      : playMode === "shuffle"
        ? t("playModeShuffle")
        : t("playModeRepeatOne");
  const playableDuration = duration || current?.duration_seconds || currentNetworkTrack?.duration_seconds || 0;
  const playedPercent = playableDuration
    ? `${Math.min(100, Math.max(0, (progress / playableDuration) * 100))}%`
    : "0%";
  const bufferedPercent = playableDuration
    ? `${Math.min(100, Math.max(0, (bufferedEnd / playableDuration) * 100))}%`
    : "0%";
  const albumArtistOptions = useMemo(() => {
    const seen = new Map<number, string>();
    albums.forEach((album) => {
      if (album.artist_id) seen.set(album.artist_id, album.artist || t("artist"));
    });
    return Array.from(seen.entries()).sort((a, b) =>
      a[1].localeCompare(b[1], settings.language),
    );
  }, [albums, settings.language, t]);
  const visibleAlbums = albumArtistFilter
    ? albums.filter((album) => album.artist_id === albumArtistFilter)
    : albums;
  const screenTitle =
    collection && view === "collection"
      ? collection.title
      : (nav.find((item) => item.id === view)?.label ?? t("brand"));
  const topbarHasScreenTitle = !([
    "favorites",
    "library",
    "playlists",
    "albums",
    "artists",
    "collection",
  ] as View[]).includes(view);
  const currentAlbum =
    current && current.album_id
      ? albums.find((item) => item.id === current.album_id)
      : undefined;
  const currentArtwork = coverUrl(current) || currentNetworkTrack?.cover_url || "";
  const playerStyle = currentArtwork
    ? ({ "--cover-url": `url(${currentArtwork})` } as React.CSSProperties)
    : undefined;
  const currentStreamUrl = currentRadio?.url || currentNetworkTrack?.stream_url || streamUrl(current, streamMode, streamOffset);
  const nowTitle = current?.title ?? currentNetworkTrack?.title ?? currentRadio?.name ?? t("nowPlaying");
  const radioDownloadSpeed = radioDownloadKbps > 0 ? `${t("downloadSpeed")} ${formatDownloadSpeed(radioDownloadKbps)}` : "";
  const nowSubtitle = currentRadio
    ? [currentRadio.country, currentRadio.codec || currentRadio.tags, currentRadio.bitrate ? `${currentRadio.bitrate}kbps` : "", radioDownloadSpeed].filter(Boolean).join(" · ")
    : currentNetworkTrack
      ? [t("networkLibrary"), currentNetworkTrack.provider, currentNetworkTrack.artist, currentNetworkTrack.album].filter(Boolean).join(" · ")
    : "";
  const radioPanelStations = useMemo(() => {
    const base = radioQueue.length
      ? radioQueue
      : radioStations.length
        ? radioStations
        : radioSources.map(radioSourceToStation);
    const out: RadioStation[] = [];
    const seen = new Set<string>();
    const add = (station: RadioStation | null | undefined) => {
      if (!station?.url) return;
      const playable = radioStationToPlayable(station);
      const key = `${playable.id || "radio"}:${playable.url}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push(playable);
    };
    add(currentRadio);
    base.forEach(add);
    return out;
  }, [currentRadio, radioQueue, radioSources, radioStations]);
  const queuePanelMode = currentRadio ? "radio" : "songs";
  const seekStyle = {
    "--played": playedPercent,
    "--buffered": bufferedPercent,
  } as React.CSSProperties;

  if (authLoading) {
    return <AuthView mode="loading" settings={settings} error={authError} onSubmit={submitAuth} />;
  }
  if (!auth?.initialized) {
    return <AuthView mode="setup" settings={settings} error={authError} onSubmit={submitAuth} />;
  }
  if (!auth.user) {
    return (
      <AuthView
        mode="login"
        settings={settings}
        error={authError}
        registrationEnabled={auth.registration_enabled}
        onSubmit={submitAuth}
      />
    );
  }

  return (
    <div className={lyricsFullScreen ? "app-shell lyrics-mode" : "app-shell"}>
      <a className="skip-link" href="#main-content">
        {t("skipToContent")}
      </a>
      <aside className="sidebar">
        <div className="brand">
          <img src="/logo.png" alt={t("brand")} /> <span>{t("brand")}</span>
        </div>
        <nav aria-label="Primary">
          {nav.map((item) => (
            <button
              key={item.id}
              title={item.label}
              aria-label={item.label}
              className={activeNav(item.id) ? "active" : ""}
              onClick={() => {
                setLyricsFullScreen(false);
                setView(item.id);
                if (item.id === "library") void api.songs(query, STARTUP_SONG_LIMIT).then(setSongs);
              }}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <main id="main-content" className="main" tabIndex={-1}>
        {lyricsFullScreen ? (
          <FullLyrics
            song={current}
            lines={lyricLines}
            activeLyric={activeLyric}
            loading={lyricsLoading}
            t={t}
            scrollRef={lyricsScrollRef}
            onToggleView={() => setLyricsFullScreen(false)}
            onSeek={seekTo}
            candidates={lyricCandidates}
            candidatesOpen={lyricCandidatesOpen}
            candidatesLoading={lyricCandidatesLoading}
            onOpenCandidates={() => void openLyricCandidates()}
            onSelectCandidate={(candidate) => void selectLyricCandidate(candidate)}
            onCloseCandidates={() => setLyricCandidatesOpen(false)}
            onUserScroll={() => {
              lyricFollowPausedUntil.current = Date.now() + 2500;
            }}
            onOpenArtist={(song) => {
              setLyricsFullScreen(false);
              void openArtistById(song.artist_id, song.artist);
            }}
            onOpenAlbum={(song) => {
              const album = albums.find((item) => item.id === song.album_id);
              if (album) {
                setLyricsFullScreen(false);
                void openAlbum(album);
              }
            }}
            onFavoriteSong={(song) => void toggleFavorite(song)}
          />
        ) : (
          <>
            <header className="topbar">
              <div className={topbarHasScreenTitle ? "top-title" : "top-title compact"}>
                <span>{topbarHasScreenTitle ? t("brand") : t("playingFrom")}</span>
                {topbarHasScreenTitle ? <h1>{screenTitle}</h1> : null}
              </div>
              {view !== "radio" && view !== "library" ? (
                <label className="search">
                  <MagnifyingGlass />
                  <input
                    value={query}
                    placeholder={t("search")}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void api.songs(query, STARTUP_SONG_LIMIT).then(setSongs);
                    }}
                  />
                </label>
              ) : (
                <span className="topbar-search-spacer" aria-hidden="true" />
              )}
              {view !== "settings" ? (
                <UserMenu
                  user={auth.user}
                  t={t}
                  onOpenProfile={() => {
                    setLyricsFullScreen(false);
                    setSettingsTab("profile");
                    setView("settings");
                  }}
                  onLogout={() => void logout()}
                />
              ) : null}
            </header>
            {message && <div className="message">{message}</div>}

            {view === "home" && (
              <HomeView
                songs={songs}
                dailyMix={dailyMix}
                albums={albums}
                artists={artists}
                playlists={playlists}
                stats={libraryStats}
                currentRadio={currentRadio}
                heroSong={heroSong}
                current={current}
                playing={playing}
                progress={progress}
                duration={playableDuration}
                volume={volume}
                bassGain={bassGain}
                trebleGain={trebleGain}
                playMode={playMode}
                playModeLabel={playModeLabel}
                t={t}
                onPlay={playSong}
                onTogglePlayback={() => setPlaying((value) => !value)}
                onPrevious={() => next(-1)}
                onNext={() => next(1)}
                onVolume={updateVolume}
                onBass={updateBassGain}
                onTreble={updateTrebleGain}
                onResetTone={() => { updateBassGain(0); updateTrebleGain(0); }}
                onCyclePlayMode={cyclePlayMode}
                onSeek={seekTo}
                onPlayAlbum={playAlbum}
                onOpenAlbum={openAlbum}
                onPlayArtist={playArtist}
                onOpenArtist={openArtistById}
                onPlayPlaylist={playPlaylist}
                onOpenPlaylist={openPlaylist}
              />
            )}

            {view === "favorites" && (
              <FavoritesView
                songs={favoriteSongs}
                albums={favoriteAlbums}
                artists={favoriteArtists}
                radios={radioFavorites}
                current={current}
                t={t}
                theme={settings.theme}
                onPlay={playSong}
                onFavoriteSong={toggleFavorite}
                onAdd={addToPlaylist}
                onInsertNext={(items) => insertNextBatch(items)}
                onOpenAlbum={(album) => void openAlbum(album)}
                onPlayAlbum={(album) => void playAlbum(album)}
                onFavoriteAlbum={(album) => void toggleAlbumFavorite(album)}
                onOpenArtist={(artist) => void openArtistById(artist.id, artist.name)}
                onPlayArtist={(artist) => void playArtist(artist)}
                onFavoriteArtist={(artist) => void toggleArtistFavorite(artist)}
                onPlayRadio={(station) => playRadio(station, radioFavorites)}
                onFavoriteRadio={(station) => void toggleRadioFavorite(station)}
              />
            )}

            {view === "library" && (
              <LibraryView
                songs={songs}
                folders={folders}
                networkSources={networkSources}
                radioSources={radioSources}
                current={current}
                t={t}
                onPlay={playSong}
                onFavorite={toggleFavorite}
                onAdd={addToPlaylist}
                onInsertNext={(items) => insertNextBatch(items)}
                onOpenAlbum={(song) => {
                  const album = albums.find((item) => item.id === song.album_id);
                  if (album) void openAlbum(album);
                }}
                onOpenArtist={(song) =>
                  void openArtistById(song.artist_id, song.artist)
                }
                onScan={() => void scan()}
                onUpload={upload}
                onPlayFolder={playFolder}
                onOpenRadio={(source) => {
                  setView("radio");
                  if (source) setSelectedRadioGroup(radioGroupName(source));
                  if (!radioStations.length) void loadRadioStations();
                }}
                onPlayRadio={(source, groupSources) => {
                  const queue = (groupSources?.length ? groupSources : [source]).map(radioSourceToStation);
                  setSelectedRadioGroup(radioGroupName(source));
                  playRadio(radioSourceToStation(source), queue);
                }}
                onNetworkSourcesChange={setNetworkSources}
                onPlayNetworkTrack={playNetworkTrack}
                scanStatus={scanStatus}
              />
            )}
            {view === "radio" && (
              <RadioView
                t={t}
                sources={radioSources}
                selectedGroup={selectedRadioGroup}
                setSelectedGroup={setSelectedRadioGroup}
                currentRadio={currentRadio}
                playing={playing}
                onPlaySource={(source, groupSources) => {
                  const queue = (groupSources?.length ? groupSources : [source]).map(radioSourceToStation);
                  setSelectedRadioGroup(radioGroupName(source));
                  playRadio(radioSourceToStation(source), queue);
                }}
                onAddSource={(name, url) => void addRadioSource(name, url)}
                onDeleteSource={(id) => void deleteRadioSource(id)}
              />
            )}
            {view === "collection" && collection && (
              <CollectionView
                collection={collection}
                current={current}
                t={t}
                backLabel={
                  collection.type === "album" && collectionBack
                    ? collectionBack.title
                    : undefined
                }
                onBack={() => {
                  if (collection.type === "album" && collectionBack) {
                    setCollection(collectionBack);
                    setCollectionBack(null);
                    setView("collection");
                    return;
                  }
                  setCollectionBack(null);
                  setView(
                    collection.type === "playlist"
                      ? "playlists"
                      : collection.type === "album"
                        ? "albums"
                        : "artists",
                  );
                }}
                onPlayAll={() => void playCollection(collection)}
                onPlay={playSong}
                onFavorite={toggleFavorite}
                onAdd={addToPlaylist}
                onInsertNext={(items) => insertNextBatch(items)}
                onInsertCollection={() => void insertCollectionNext(collection)}
                onFavoriteCollection={
                  collection.type === "album"
                    ? () => {
                        const album = albums.find((item) => item.id === collection.id);
                        if (album) void toggleAlbumFavorite(album);
                      }
                    : collection.type === "artist"
                      ? () => {
                          const artist = artists.find((item) => item.id === collection.id);
                          if (artist) void toggleArtistFavorite(artist);
                        }
                      : undefined
                }
                onOpenAlbum={(song) => {
                  const album = albums.find((item) => item.id === song.album_id);
                  if (album) {
                    void openAlbum(album, collection.type === "artist" ? collection : null);
                  }
                }}
                onOpenArtist={(song) =>
                  void openArtistById(song.artist_id, song.artist)
                }
                onOpenAlbumCard={(album) =>
                  void openAlbum(album, collection.type === "artist" ? collection : null)
                }
                onPlayAlbumCard={(album) => void playAlbum(album)}
                onOpenCollectionArtist={
                  collection.artistId
                    ? () =>
                        void openArtistById(
                          collection.artistId!,
                          collection.artistName,
                        )
                    : undefined
                }
              />
            )}
            {view === "playlists" && (
              <CardGrid
                t={t}
                title={t("playlists")}
                action={
                  <button onClick={createPlaylist}>
                    <Plus /> {t("createPlaylist")}
                  </button>
                }
                items={playlists.map((p) => ({
                  id: p.id,
                  title: p.name,
                  subtitle: `${p.song_count} ${t("count")}`,
                  theme: p.cover_theme,
                  onClick: () => void openPlaylist(p),
                  onPlay: () => void playPlaylist(p),
                }))}
              />
            )}
            {view === "albums" && (
              <CardGrid
                t={t}
                title={t("albums")}
                variant="album"
                action={
                  <label className="filter-pill">
                    <span>{t("filterByArtist")}</span>
                    <select
                      value={albumArtistFilter}
                      onChange={(event) => setAlbumArtistFilter(Number(event.target.value))}
                    >
                      <option value={0}>{t("allArtists")}</option>
                      {albumArtistOptions.map(([id, name]) => (
                        <option key={id} value={id}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </label>
                }
                items={visibleAlbums.map((a) => ({
                  id: a.id,
                  title: a.title,
                  subtitle: [a.year ? String(a.year) : "", `${a.song_count} ${t("count")}`]
                    .filter(Boolean)
                    .join(" · "),
                  meta: a.artist,
                  theme: settings.theme,
                  coverUrl: albumCoverUrl(a),
                  favorite: a.favorite,
                  onClick: () => void openAlbum(a),
                  onMetaClick: a.artist_id
                    ? () => void openArtistById(a.artist_id, a.artist)
                    : undefined,
                  onPlay: () => void playAlbum(a),
                  onFavorite: () => void toggleAlbumFavorite(a),
                }))}
              />
            )}
            {view === "artists" && (
              <CardGrid
                t={t}
                title={t("artists")}
                variant="artist"
                items={artists.map((a) => ({
                  id: a.id,
                  title: a.name,
                  subtitle: `${a.song_count} ${t("count")} · ${a.album_count} ${t("album")}`,
                  theme: settings.theme,
                  coverUrl: artistCoverUrl(a),
                  favorite: a.favorite,
                  onClick: () => void openArtistById(a.id, a.name),
                  onPlay: () => void playArtist(a),
                  onFavorite: () => void toggleArtistFavorite(a),
                }))}
              />
            )}
            {view === "settings" && (
              <SettingsPanel
                settings={settings}
                setSettings={(s) => void saveSettings(s)}
                libraryDirectories={libraryDirectories}
                onLibraryDirectoriesChange={setLibraryDirectories}
                user={auth.user}
                resumeMode={resumeMode}
                onResumeModeChange={(mode) => {
                  resumeModeRef.current = mode;
                  setResumeMode(mode);
                  window.localStorage.setItem(resumePreferenceKey(auth.user), mode);
                }}
                activeTab={settingsTab}
                onTabChange={setSettingsTab}
                onUpdateProfile={(nickname, avatar) => void updateProfile(nickname, avatar)}
                t={t}
              />
            )}
            {view === "about" && <AboutView health={health} settings={settings} t={t} />}
          </>
        )}
      </main>

      {playlistDialogOpen ? (
        <PlaylistDialog
          t={t}
          submitting={playlistSubmitting}
          onCancel={() => {
            setPlaylistDialogOpen(false);
            setPlaylistPendingSong(null);
          }}
          onSubmit={(name, description) =>
            void submitCreatePlaylist(name, description)
          }
        />
      ) : null}
      {playlistPickerSong ? (
        <AddToPlaylistDialog
          t={t}
          song={playlistPickerSong}
          playlists={playlists}
          onCancel={() => setPlaylistPickerSong(null)}
          onSubmit={(playlistId) => void submitAddToPlaylist(playlistId)}
          onCreate={() => {
            setPlaylistPendingSong(playlistPickerSong);
            setPlaylistPickerSong(null);
            createPlaylist();
          }}
        />
      ) : null}

      <footer className="player" style={playerStyle}>
        <PlayerMood
          theme={settings.theme}
          playing={playing}
          song={current}
          radio={currentRadio}
          audioEl={audioEl}
          streamSrc={currentStreamUrl}
          lowBandwidth={buffering}
          eqActive={eqEnabled}
          onOpenEqualizer={() => setEqPanelOpen((value) => !value)}
          equalizerLabel={t("equalizer")}
        />
        <div className="now">
          <button
            className={currentRadio ? "cover-button radio-cover-button" : "cover-button"}
            title={currentRadio ? t("onlineRadio") : t("lyrics")}
            aria-label={currentRadio ? t("onlineRadio") : t("lyrics")}
            onClick={() => {
              if (currentRadio) {
                setView("radio");
                if (!radioStations.length) void loadRadioStations();
                return;
              }
              setLyricsFullScreen((value) => !value);
            }}
          >
            {currentRadio ? (
              <RadioMiniLogo station={currentRadio} playing={playing} />
            ) : currentNetworkTrack ? (
              <div
                className="mini-art"
                data-playing={playing ? "true" : "false"}
                data-has-cover={currentNetworkTrack.cover_url ? "true" : "false"}
                style={currentNetworkTrack.cover_url ? ({ "--cover-url": `url(${currentNetworkTrack.cover_url})` } as React.CSSProperties) : undefined}
              >
                {!currentNetworkTrack.cover_url ? <Record weight="fill" /> : null}
              </div>
            ) : (
              <MiniCover song={current} playing={playing} />
            )}
          </button>
          <div>
            <strong>{nowTitle}</strong>
            <span>
              {current ? (
                <>
                  {current.artist_id ? (
                    <button
                      className="now-meta-link"
                      onClick={() => void openArtistById(current.artist_id, current.artist)}
                    >
                      {current.artist}
                    </button>
                  ) : (
                    current.artist
                  )}
                  {" · "}
                  {currentAlbum ? (
                    <button
                      className="now-meta-link"
                      onClick={() => void openAlbum(currentAlbum)}
                    >
                      {current.album}
                    </button>
                  ) : (
                    current.album
                  )}
                  {" · "}
                  {formatQuality(current)}
                </>
              ) : currentRadio ? (
                <span className="radio-now-meta"><i />LIVE{nowSubtitle ? ` · ${nowSubtitle}` : ""}</span>
              ) : currentNetworkTrack ? (
                nowSubtitle
              ) : (
                "—"
              )}
            </span>
          </div>
          <span className="now-pulse" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <button
            className="player-favorite"
            disabled={!current && !currentRadio}
            onClick={() => {
              if (currentRadio) void toggleRadioFavorite(currentRadio);
              else if (current) void toggleFavorite(current);
            }}
          >
            <HeartStraight weight={(currentRadio?.favorite || current?.favorite) ? "fill" : "regular"} />
          </button>
        </div>
        <div className="transport">
          <div className="transport-controls">
            <span className="transport-spacer" aria-hidden="true" />
            <div className="playback-buttons">
              <button aria-label={t("previous")} onClick={() => next(-1)}>
                <SkipBack weight="fill" />
              </button>
              <button
                className="play"
                aria-label={playing ? t("pause") : t("play")}
                disabled={!current && !currentRadio && !currentNetworkTrack}
                onClick={() => setPlaying((v) => !v)}
              >
                {playing ? <Pause weight="fill" /> : <Play weight="fill" />}
              </button>
              <button aria-label={t("next")} onClick={() => next(1)}>
                <SkipForward weight="fill" />
              </button>
            </div>
            <span className="transport-spacer" aria-hidden="true" />
          </div>
          <input
            type="range"
            min="0"
            max={playableDuration || 0}
            step="0.01"
            value={Math.min(progress, playableDuration || progress || 0)}
            disabled={!playableDuration || Boolean(currentRadio)}
            style={seekStyle}
            onChange={(e) => {
              seekTo(Number(e.target.value));
            }}
          />
          <span className={inlineLyrics ? "inline-lyrics-line" : ""}>
            {buffering ? (
              <>
                <Timer /> {t("buffering")}
              </>
            ) : inlineLyrics ? (
              <>
                <ChatText weight="fill" /> {activeLyricText}
              </>
            ) : currentRadio ? (
              <>
                <Record weight="fill" /> {t("liveRadio")}
              </>
            ) : currentNetworkTrack ? (
              <>
                {formatDuration(progress)} / {formatDuration(playableDuration || currentNetworkTrack.duration_seconds)}
              </>
            ) : (
              <>
                {formatDuration(progress)} / {formatDuration(playableDuration)}
              </>
            )}
          </span>
        </div>
        <div className="volume">
          <button
            className={
              playMode === "sequence" ? "mode-button" : "mode-button active"
            }
            title={playModeLabel}
            aria-label={playModeLabel}
            onClick={cyclePlayMode}
          >
            {playMode === "shuffle" ? (
              <Shuffle />
            ) : playMode === "repeat-one" ? (
              <RepeatOnce />
            ) : (
              <Repeat />
            )}
          </button>
          <button
            className={inlineLyrics ? "lyric-toggle active" : "lyric-toggle"}
            title={t("inlineLyrics")}
            aria-label={t("inlineLyrics")}
            onClick={() => setInlineLyrics((value) => !value)}
          >
            <ChatText />
          </button>
          <button
            className={queueOpen ? "queue-toggle active" : "queue-toggle"}
            title={queuePanelMode === "radio" ? t("onlineRadio") : t("queue")}
            aria-label={queuePanelMode === "radio" ? t("onlineRadio") : t("queue")}
            onClick={() => setQueueOpen((value) => !value)}
          >
            <Queue />
          </button>
          <SleepTimerControl
            value={sleepTimerMins}
            left={sleepLeft}
            onChange={setSleepTimerMins}
            t={t}
          />
          <SpeakerSimpleHigh />
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            defaultValue="0.85"
            value={volume}
            onChange={(e) => {
              updateVolume(Number(e.target.value));
            }}
          />
        </div>
        <audio
          ref={setAudioNode}
          preload="metadata"
          data-song-id={current?.id ?? undefined}
          data-radio-id={currentRadio?.id ?? undefined}
          src={currentStreamUrl}
          onLoadedMetadata={(e) => {
            updateBuffered(e.currentTarget);
            updateRadioDownloadSpeed(e.currentTarget);
            const d = e.currentTarget.duration;
            const mediaDuration = Number.isFinite(d) && d > 0 ? d : 0;
            const libraryDuration = current?.duration_seconds || currentNetworkTrackRef.current?.duration_seconds || 0;
            setDuration(
              streamModeRef.current === "adaptive"
                ? libraryDuration || streamOffsetRef.current + mediaDuration
                : mediaDuration || libraryDuration,
            );
            if (resumeSeekRef.current > 0) {
              if (streamModeRef.current === "adaptive") {
                const target = resumeSeekRef.current;
                setStreamOffset(target);
                e.currentTarget.currentTime = 0;
                setProgress(target);
              } else {
                const target = Math.min(
                  resumeSeekRef.current,
                  mediaDuration > 0 ? Math.max(0, mediaDuration - 3) : resumeSeekRef.current,
                );
                e.currentTarget.currentTime = target;
                setProgress(target);
              }
              resumeSeekRef.current = 0;
            }
            if (playingRef.current || pendingAutoplayRef.current)
              requestAudioPlay();
          }}
          onDurationChange={(e) => {
            updateBuffered(e.currentTarget);
            updateRadioDownloadSpeed(e.currentTarget);
            const d = e.currentTarget.duration;
            const mediaDuration = Number.isFinite(d) && d > 0 ? d : 0;
            const libraryDuration = current?.duration_seconds || currentNetworkTrackRef.current?.duration_seconds || 0;
            setDuration(
              streamModeRef.current === "adaptive"
                ? libraryDuration || streamOffsetRef.current + mediaDuration
                : mediaDuration || libraryDuration,
            );
          }}
          onLoadedData={() => {
            clearStallDowngradeTimer();
            setBuffering(false);
            if (playingRef.current || pendingAutoplayRef.current)
              requestAudioPlay();
          }}
          onCanPlay={(event) => {
            clearStallDowngradeTimer();
            updateBuffered(event.currentTarget);
            updateRadioDownloadSpeed(event.currentTarget);
            setBuffering(false);
            if (playingRef.current || pendingAutoplayRef.current)
              requestAudioPlay();
          }}
          onPlaying={(event) => {
            clearStallDowngradeTimer();
            updateBuffered(event.currentTarget);
            updateRadioDownloadSpeed(event.currentTarget);
            setBuffering(false);
          }}
          onProgress={(event) => {
            updateBuffered(event.currentTarget);
            updateRadioDownloadSpeed(event.currentTarget);
          }}
          onTimeUpdate={(e) => {
            const nextProgress = streamOffsetRef.current + e.currentTarget.currentTime;
            progressRef.current = nextProgress;
            const now = performance.now();
            if (now - lastProgressPaintRef.current >= 250) {
              lastProgressPaintRef.current = now;
              setProgress(nextProgress);
            }
            updateBuffered(e.currentTarget);
            updateRadioDownloadSpeed(e.currentTarget);
            if (bufferedAhead(e.currentTarget) > 1.5) setBuffering(false);
            syncPlaybackProgress(false);
          }}
          onSeeking={(e) => {
            setProgress(streamOffsetRef.current + e.currentTarget.currentTime);
            updateBuffered(e.currentTarget);
          }}
          onWaiting={(event) => handlePlaybackStall(event.currentTarget)}
          onStalled={(event) => handlePlaybackStall(event.currentTarget)}
          onPause={() => syncPlaybackProgress(false)}
          onError={(event) => {
            clearStallDowngradeTimer();
            if (streamMode === "adaptive") {
              const mediaTime = event.currentTarget.currentTime || 0;
              const resumeAt =
                mediaTime > 0.05
                  ? streamOffsetRef.current + mediaTime
                  : progress;
              resumeSeekRef.current = resumeAt;
              pendingAutoplayRef.current = playingRef.current;
              setStreamOffset(0);
              setProgress(resumeAt);
              setStreamMode("auto");
              setBuffering(false);
              return;
            }
            pendingAutoplayRef.current = false;
            event.currentTarget.pause();
            setPlaying(false);
            setRadioDownloadKbps(0);
            radioDownloadSampleRef.current = { at: 0, ahead: 0 };
            setStreamOffset(0);
            setProgress(0);
            showMessage(t("playbackFailed"));
          }}
          onEnded={() => next(1, true)}
        />
      </footer>
      {queueOpen && (
        <div className="queue-layer queue-layer-root">
          <button
            className="queue-scrim"
            aria-label={t("close")}
            onClick={() => setQueueOpen(false)}
          />
          {queuePanelMode === "radio" ? (
            <RadioQueuePanel
              stations={radioPanelStations}
              currentRadio={currentRadio}
              playing={playing}
              t={t}
              onPlay={(station) => playRadio(station, radioPanelStations)}
              onClose={() => setQueueOpen(false)}
            />
          ) : (
            <QueuePanel
              queue={queue}
              current={current}
              t={t}
              onPlay={(song) => void playSong(song, queue)}
              onClose={() => setQueueOpen(false)}
            />
          )}
        </div>
      )}
      {eqPanelOpen ? (
        <div className="eq-layer">
          <button className="eq-scrim" type="button" aria-label={t("close")} onClick={() => setEqPanelOpen(false)} />
          <EqualizerPanel
            t={t}
            enabled={eqEnabled}
            bands={eqBands}
            onToggle={() => setEqEnabled((value) => !value)}
            onChange={updateEqBand}
            onReset={resetEqualizer}
            onApplyPreset={(presetBands) => setEqBands(presetBands)}
            onClose={() => setEqPanelOpen(false)}
          />
        </div>
      ) : null}
    </div>
  );
}

function AuthView({
  mode,
  settings,
  error,
  registrationEnabled = false,
  onSubmit,
}: {
  mode: "loading" | "setup" | "login";
  settings: Settings;
  error?: string;
  registrationEnabled?: boolean;
  onSubmit: (mode: "setup" | "login" | "register", username: string, password: string) => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [registerMode, setRegisterMode] = useState(false);
  const isSetup = mode === "setup";
  const action = isSetup ? "setup" : registerMode ? "register" : "login";
  const zh = settings.language === "zh-CN";
  const title =
    mode === "loading"
      ? zh
        ? "正在进入百灵"
        : "Opening Lark"
      : isSetup
        ? zh
          ? "初始化百灵"
          : "Initialize Lark"
        : registerMode
          ? zh
            ? "创建你的账号"
            : "Create your account"
          : zh
            ? "欢迎回来"
            : "Welcome back";
  const subtitle = isSetup
    ? zh
      ? "首次运行需要创建管理员账号，用于管理曲库、注册和系统设置。"
      : "Create the first administrator account to manage the library and system settings."
    : zh
      ? "登录后可同步你的歌单、喜欢、收藏与播放历史。"
      : "Sign in to keep playlists, likes, albums, and history separate.";

  if (mode === "loading") {
    return (
      <div className="auth-shell" data-theme={settings.theme}>
        <LoadingStage t={createT(settings.language)} />
      </div>
    );
  }

  return (
    <div className="auth-shell" data-theme={settings.theme}>
      <div className="auth-card">
        <div className="brand auth-brand">
          <img src="/logo.png" alt={zh ? "百灵" : "Lark"} />
          <span>{zh ? "百灵" : "Lark"}</span>
        </div>
        <div>
          <p>{zh ? "私人音乐库" : "Private music library"}</p>
          <h1>{title}</h1>
          <span>{subtitle}</span>
        </div>
        <form
            className="auth-form"
            onSubmit={(event) => {
              event.preventDefault();
              onSubmit(action, username, password);
            }}
          >
            <label>
              {zh ? "账号" : "Username"}
              <input
                value={username}
                autoComplete="username"
                minLength={2}
                required
                onChange={(event) => setUsername(event.target.value)}
              />
            </label>
            <label>
              {zh ? "密码" : "Password"}
              <input
                value={password}
                type="password"
                autoComplete={isSetup || registerMode ? "new-password" : "current-password"}
                minLength={6}
                required
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            {error ? <div className="auth-error">{error}</div> : null}
            <button className="primary" type="submit">
              {isSetup
                ? zh
                  ? "创建管理员"
                  : "Create admin"
                : registerMode
                  ? zh
                    ? "注册并进入"
                    : "Register"
                  : zh
                    ? "登录"
                    : "Sign in"}
            </button>
            {!isSetup && registrationEnabled ? (
              <button
                type="button"
                className="auth-link"
                onClick={() => setRegisterMode((value) => !value)}
              >
                {registerMode
                  ? zh
                    ? "已有账号？返回登录"
                    : "Already have an account? Sign in"
                  : zh
                    ? "没有账号？注册"
                    : "Need an account? Register"}
              </button>
            ) : null}
          </form>
      </div>
    </div>
  );
}

function useDialogLifecycle<T extends HTMLElement>(onClose: () => void) {
  const dialogRef = useRef<T | null>(null);
  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const focusSelector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const focusFirst = () => {
      const target = dialog?.querySelector<HTMLElement>("[autofocus]") ?? dialog?.querySelector<HTMLElement>(focusSelector);
      target?.focus();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusSelector)).filter((node) => !node.hasAttribute("disabled") && node.tabIndex !== -1);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.requestAnimationFrame(focusFirst);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, [onClose]);
  return dialogRef;
}

function PlaylistDialog({
  t,
  submitting,
  onCancel,
  onSubmit,
}: {
  t: ReturnType<typeof createT>;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (name: string, description: string) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const trimmedName = name.trim();
  const dialogRef = useDialogLifecycle<HTMLFormElement>(onCancel);
  return (
    <div className="modal-layer" role="presentation">
      <button
        className="modal-scrim"
        type="button"
        aria-label={t("close")}
        onClick={onCancel}
      />
      <form
        ref={dialogRef}
        className="modal-card playlist-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="playlist-dialog-title"
        onSubmit={(event) => {
          event.preventDefault();
          if (!trimmedName || submitting) return;
          onSubmit(trimmedName, description.trim());
        }}
      >
        <div>
          <p>{t("playlists")}</p>
          <h2 id="playlist-dialog-title">{t("createPlaylist")}</h2>
        </div>
        <label>
          {t("playlistName")}
          <input
            value={name}
            autoFocus
            required
            maxLength={80}
            placeholder={t("playlistName")}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          {t("playlistDescription")}
          <input
            value={description}
            maxLength={160}
            placeholder={t("playlistDescriptionOptional")}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <div className="modal-actions">
          <button type="button" onClick={onCancel} disabled={submitting}>
            {t("cancel")}
          </button>
          <button className="primary" type="submit" disabled={!trimmedName || submitting}>
            {submitting ? t("loading") : t("createPlaylist")}
          </button>
        </div>
      </form>
    </div>
  );
}

function AddToPlaylistDialog({
  t,
  song,
  playlists,
  onCancel,
  onSubmit,
  onCreate,
}: {
  t: ReturnType<typeof createT>;
  song: Song;
  playlists: Playlist[];
  onCancel: () => void;
  onSubmit: (playlistId: number) => void;
  onCreate: () => void;
}) {
  const [selected, setSelected] = useState(playlists[0]?.id ?? 0);
  const dialogRef = useDialogLifecycle<HTMLDivElement>(onCancel);
  return (
    <div className="modal-layer" role="presentation">
      <button className="modal-scrim" type="button" aria-label={t("close")} onClick={onCancel} />
      <div ref={dialogRef} className="modal-card playlist-picker" role="dialog" aria-modal="true" aria-labelledby="playlist-picker-title">
        <div className="modal-card-head">
          <div>
            <p>{t("addToPlaylist")}</p>
            <h2 id="playlist-picker-title">{song.title}</h2>
          </div>
          <button type="button" onClick={onCreate}><Plus /> {t("createPlaylist")}</button>
        </div>
        <div className="playlist-picker-list">
          {playlists.map((playlist) => (
            <button
              key={playlist.id}
              type="button"
              className={selected === playlist.id ? "active" : ""}
              onClick={() => setSelected(playlist.id)}
            >
              <strong>{playlist.name}</strong>
              <span>{playlist.song_count} {t("count")}</span>
            </button>
          ))}
        </div>
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>{t("cancel")}</button>
          <button className="primary" type="button" disabled={!selected} onClick={() => onSubmit(selected)}>
            {t("addToPlaylist")}
          </button>
        </div>
      </div>
    </div>
  );
}

function compactLibraryCount(value: number) {
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
  return new Intl.NumberFormat(undefined, {
    notation: safeValue >= 10000 ? "compact" : "standard",
    maximumFractionDigits: safeValue >= 10000 ? 1 : 0,
  }).format(safeValue);
}

function LibrarySummaryStats({
  t,
  stats,
}: {
  t: ReturnType<typeof createT>;
  stats: LibraryStats;
}) {
  const items = [
    { key: "songs", value: stats.songs, label: t("count") },
    { key: "albums", value: stats.albums, label: t("albums") },
    { key: "artists", value: stats.artists, label: t("artists") },
    { key: "playlists", value: stats.playlists, label: t("playlists") },
  ];
  return (
    <div className="library-summary-stats" aria-label={t("librarySummary")}>
      {items.map((item) => (
        <article className="library-summary-stat" key={item.key}>
          <strong title={String(item.value)}>{compactLibraryCount(item.value)}</strong>
          <span>{item.label}</span>
        </article>
      ))}
    </div>
  );
}

function HomeView({
  songs,
  dailyMix,
  albums,
  artists,
  playlists,
  stats,
  currentRadio,
  heroSong,
  current,
  playing,
  progress,
  duration,
  volume,
  bassGain,
  trebleGain,
  playMode,
  playModeLabel,
  t,
  onPlay,
  onTogglePlayback,
  onPrevious,
  onNext,
  onVolume,
  onBass,
  onTreble,
  onResetTone,
  onCyclePlayMode,
  onSeek,
  onPlayAlbum,
  onOpenAlbum,
  onPlayArtist,
  onOpenArtist,
  onPlayPlaylist,
  onOpenPlaylist,
}: {
  songs: Song[];
  dailyMix: Song[];
  albums: Album[];
  artists: Artist[];
  playlists: Playlist[];
  stats: LibraryStats | null;
  currentRadio: RadioStation | null;
  heroSong?: Song | null;
  current: Song | null;
  playing: boolean;
  progress: number;
  duration: number;
  volume: number;
  bassGain: number;
  trebleGain: number;
  playMode: PlayMode;
  playModeLabel: string;
  t: ReturnType<typeof createT>;
  onPlay: (song: Song, list?: Song[]) => void;
  onTogglePlayback: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onVolume: (value: number) => void;
  onBass: (value: number) => void;
  onTreble: (value: number) => void;
  onResetTone: () => void;
  onCyclePlayMode: () => void;
  onSeek: (seconds: number) => void;
  onPlayAlbum: (album: Album) => void;
  onOpenAlbum: (album: Album) => void;
  onPlayArtist: (artist: Artist) => void;
  onOpenArtist: (id: number, fallbackName?: string) => void;
  onPlayPlaylist: (playlist: Playlist) => void;
  onOpenPlaylist: (playlist: Playlist) => void;
}) {
  const latestSongs = songs.slice(0, 5);
  const dailySongs = dailyMix.length ? dailyMix.slice(0, 5) : songs.slice(0, 5);
  const featuredAlbums = albums.slice(0, 4);
  const featuredArtists = artists.slice(0, 4);
  const featuredPlaylists = playlists.slice(0, 3);
  const displaySong = current ?? heroSong ?? null;
  const heroActive = Boolean(current);
  const heroPlaying = playing && heroActive;
  const heroAlbum = displaySong
    ? albums.find((album) => album.id === displaySong.album_id)
    : undefined;
  return (
    <section className="home-view">
      <section className={currentRadio ? "hero radio-hero" : "hero"}>
        {currentRadio ? (
          <RadioReceiver
            title={currentRadio.name || t("onlineRadio")}
            subtitle={[t("onlineRadio"), currentRadio.country, currentRadio.codec || currentRadio.tags].filter(Boolean).join(" · ")}
            playing={playing}
            t={t}
            onPlay={() => undefined}
          />
        ) : (
          <VinylTurntable
            cover={coverUrl(displaySong)}
            playing={heroPlaying}
            progress={heroActive ? progress : 0}
            duration={heroActive ? duration : displaySong?.duration_seconds || 0}
            title={displaySong?.title}
            artist={displaySong?.artist}
            volume={volume}
            bassGain={bassGain}
            trebleGain={trebleGain}
            playMode={playMode}
            playModeLabel={playModeLabel}
            resetToneLabel={t("resetEqualizer")}
            onToggle={heroActive ? onTogglePlayback : displaySong ? () => onPlay(displaySong) : undefined}
            onPrevious={heroActive ? onPrevious : undefined}
            onNext={heroActive ? onNext : undefined}
            onVolume={onVolume}
            onBass={onBass}
            onTreble={onTreble}
            onResetTone={onResetTone}
            onCyclePlayMode={onCyclePlayMode}
            onSeek={heroActive ? onSeek : undefined}
          />
        )}
        <div>
          <p>{currentRadio ? t("liveRadio") : heroPlaying ? t("nowPlaying") : t("jumpBackIn")}</p>
          <h1>{currentRadio?.name ?? displaySong?.title ?? `${t("brand")} Music`}</h1>
          {currentRadio ? (
            <h2 className="home-hero-meta">
              {[currentRadio.country, currentRadio.codec, currentRadio.bitrate ? `${currentRadio.bitrate}kbps` : ""].filter(Boolean).join(" · ") || t("onlineRadio")}
            </h2>
          ) : displaySong ? (
            <h2 className="home-hero-meta">
              <button
                type="button"
                className="hero-meta-link"
                onClick={() => onOpenArtist(displaySong.artist_id, displaySong.artist)}
              >
                {displaySong.artist}
              </button>
              <span aria-hidden="true"> · </span>
              {heroAlbum ? (
                <button
                  type="button"
                  className="hero-meta-link"
                  onClick={() => onOpenAlbum(heroAlbum)}
                >
                  {displaySong.album}
                </button>
              ) : (
                <span>{displaySong.album}</span>
              )}
            </h2>
          ) : (
            <h2>{t("noSongs")}</h2>
          )}
          <div className="hero-actions">
            <button
              className="primary"
              disabled={!displaySong || Boolean(currentRadio)}
              onClick={() => displaySong && (heroActive ? onTogglePlayback() : onPlay(displaySong))}
            >
              {currentRadio ? <Record weight="fill" /> : heroPlaying ? <Pause weight="fill" /> : <Play weight="fill" />}
              {currentRadio ? t("liveRadio") : heroPlaying ? t("nowPlaying") : t("play")}
            </button>
          </div>
        </div>
      </section>

      <div className="home-dashboard">
        <section className="summary-panel">
          <div className="section-head compact">
            <h2>{t("librarySummary")}</h2>
          </div>
          <LibrarySummaryStats
            t={t}
            stats={stats ?? {
              songs: songs.length,
              albums: albums.length,
              artists: artists.length,
              playlists: playlists.length,
            }}
          />
        </section>

        <section className="quick-panel">
          <div className="section-head compact">
            <div>
              <h2>{t("latestSongs")}</h2>
              <p className="section-subtitle">{t("latestSongsHint")}</p>
            </div>
            {latestSongs[0] ? (
              <button onClick={() => onPlay(latestSongs[0], songs)}>
                <Play weight="fill" /> {t("playAll")}
              </button>
            ) : null}
          </div>
          <div className="quick-song-list">
            {latestSongs.length ? (
              latestSongs.map((song) => (
                <button
                  key={song.id}
                  className={song.id === current?.id ? "active" : ""}
                  onClick={() => onPlay(song, songs)}
                >
                  <MiniCover
                    song={song}
                    playing={playing && song.id === current?.id}
                  />
                  <span>
                    <strong>{song.title}</strong>
                    <small>
                      {song.artist} · {formatDuration(song.duration_seconds)}
                    </small>
                  </span>
                  <Play weight="fill" />
                </button>
              ))
            ) : (
              <div className="empty mini-empty">{t("noSongs")}</div>
            )}
          </div>
        </section>
      </div>

      {dailySongs.length ? (
        <section className="daily-mix-grid">
          <div className="quick-panel daily-mix-panel">
            <div className="section-head compact">
              <div>
                <h2>{t("dailyMix")}</h2>
                <p className="section-subtitle">{t("dailyMixHint")}</p>
              </div>
              <button onClick={() => onPlay(dailySongs[0], dailyMix.length ? dailyMix : songs)}>
                <Play weight="fill" /> {t("playAll")}
              </button>
            </div>
            <div className="quick-song-list">
              {dailySongs.map((song) => (
                <button
                  key={song.id}
                  className={song.id === current?.id ? "active" : ""}
                  onClick={() => onPlay(song, dailyMix.length ? dailyMix : songs)}
                >
                  <MiniCover
                    song={song}
                    playing={playing && song.id === current?.id}
                  />
                  <span>
                    <strong>{song.title}</strong>
                    <small>{song.artist} · {song.album}</small>
                  </span>
                  <Play weight="fill" />
                </button>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {featuredAlbums.length ||
      featuredArtists.length ||
      featuredPlaylists.length ? (
        <section className="quick-shelves">
          {featuredAlbums.length ? (
            <div>
              <div className="section-head compact">
                <h2>{t("albums")}</h2>
              </div>
              <div className="mini-cards">
                {featuredAlbums.map((album) => (
                  <article key={album.id} className="mini-card">
                    <button
                      className="mini-card-cover"
                      style={
                        {
                          "--cover-url": `url(${albumCoverUrl(album)})`,
                        } as React.CSSProperties
                      }
                      onClick={() => onOpenAlbum(album)}
                    >
                      <LazyCoverImage src={albumCoverUrl(album)} />
                      <Record weight="fill" />
                    </button>
                    <strong>{album.title}</strong>
                    <button
                      className="artist-link"
                      onClick={() =>
                        album.artist_id &&
                        onOpenArtist(album.artist_id, album.artist)
                      }
                    >
                      {album.artist}
                    </button>
                    <button
                      className="mini-play"
                      onClick={() => onPlayAlbum(album)}
                    >
                      <Play weight="fill" />
                    </button>
                  </article>
                ))}
              </div>
            </div>
          ) : null}
          {featuredArtists.length ? (
            <div>
              <div className="section-head compact">
                <h2>{t("artists")}</h2>
              </div>
              <div className="mini-cards">
                {featuredArtists.map((artist) => (
                  <article key={artist.id} className="mini-card artist-mini">
                    <button
                      className="mini-card-cover"
                      style={
                        {
                          "--cover-url": `url(${artistCoverUrl(artist)})`,
                        } as React.CSSProperties
                      }
                      onClick={() => onOpenArtist(artist.id, artist.name)}
                    >
                      <LazyCoverImage src={artistCoverUrl(artist)} />
                      <Record weight="fill" />
                    </button>
                    <strong>{artist.name}</strong>
                    <span>
                      {artist.song_count} {t("count")}
                    </span>
                    <button
                      className="mini-play"
                      onClick={() => onPlayArtist(artist)}
                    >
                      <Play weight="fill" />
                    </button>
                  </article>
                ))}
              </div>
            </div>
          ) : null}
          {featuredPlaylists.length ? (
            <div>
              <div className="section-head compact">
                <h2>{t("playlists")}</h2>
              </div>
              <div className="mini-cards">
                {featuredPlaylists.map((playlist) => (
                  <article key={playlist.id} className="mini-card">
                    <button
                      className="mini-card-cover"
                      onClick={() => onOpenPlaylist(playlist)}
                    >
                      <Record weight="fill" />
                    </button>
                    <strong>{playlist.name}</strong>
                    <span>
                      {playlist.song_count} {t("count")}
                    </span>
                    <button
                      className="mini-play"
                      onClick={() => onPlayPlaylist(playlist)}
                    >
                      <Play weight="fill" />
                    </button>
                  </article>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}

function MiniCover({
  song,
  playing,
}: {
  song?: Song | null;
  playing: boolean;
}) {
  const url = coverUrl(song);
  const style = url
    ? ({ "--cover-url": `url(${url})` } as React.CSSProperties)
    : undefined;
  return (
    <div
      className="mini-art"
      data-playing={playing ? "true" : "false"}
      data-has-cover={url ? "true" : "false"}
      style={style}
    >
      {!url ? <Record weight="fill" /> : null}
    </div>
  );
}

function RadioMiniLogo({ station, playing }: { station: RadioStation; playing: boolean }) {
  const style = station.favicon ? ({ "--cover-url": `url(${station.favicon})` } as React.CSSProperties) : undefined;
  return (
    <div className="mini-art radio-mini-art" data-playing={playing ? "true" : "false"} data-has-cover={station.favicon ? "true" : "false"} style={style}>
      {!station.favicon ? <Record weight="fill" /> : null}
      <span aria-hidden="true" />
    </div>
  );
}

function FavoritesView({
  songs,
  albums,
  artists,
  radios,
  current,
  t,
  theme,
  onPlay,
  onFavoriteSong,
  onAdd,
  onInsertNext,
  onOpenAlbum,
  onPlayAlbum,
  onFavoriteAlbum,
  onOpenArtist,
  onPlayArtist,
  onFavoriteArtist,
  onPlayRadio,
  onFavoriteRadio,
}: {
  songs: Song[];
  albums: Album[];
  artists: Artist[];
  radios: RadioStation[];
  current: Song | null;
  t: ReturnType<typeof createT>;
  theme: Theme;
  onPlay: (song: Song, list: Song[]) => void;
  onFavoriteSong: (song: Song) => void;
  onAdd: (song: Song) => void;
  onInsertNext: (songs: Song[]) => void;
  onOpenAlbum: (album: Album) => void;
  onPlayAlbum: (album: Album) => void;
  onFavoriteAlbum: (album: Album) => void;
  onOpenArtist: (artist: Artist) => void;
  onPlayArtist: (artist: Artist) => void;
  onFavoriteArtist: (artist: Artist) => void;
  onPlayRadio: (station: RadioStation) => void;
  onFavoriteRadio: (station: RadioStation) => void;
}) {
  const [tab, setTab] = useState<"songs" | "albums" | "artists" | "radios">("songs");
  const hasAny = songs.length || albums.length || artists.length || radios.length;
  return (
    <section className="favorites-view">
      <div className="section-head">
        <div>
          <h2>{t("favorites")}</h2>
          <p className="section-subtitle">{t("favoritesHint")}</p>
        </div>
      </div>
      <div className="collection-tabs">
        <button
          className={tab === "songs" ? "active" : ""}
          onClick={() => setTab("songs")}
        >
          {t("songs")} · {songs.length}
        </button>
        <button
          className={tab === "albums" ? "active" : ""}
          onClick={() => setTab("albums")}
        >
          {t("albums")} · {albums.length}
        </button>
        <button
          className={tab === "artists" ? "active" : ""}
          onClick={() => setTab("artists")}
        >
          {t("artists")} · {artists.length}
        </button>
        <button
          className={tab === "radios" ? "active" : ""}
          onClick={() => setTab("radios")}
        >
          {t("onlineRadio")} · {radios.length}
        </button>
      </div>
      {!hasAny ? (
        <div className="empty">{t("emptyFavorites")}</div>
      ) : tab === "songs" ? (
        <SongTable
          songs={songs}
          current={current}
          t={t}
          onPlay={onPlay}
          onFavorite={onFavoriteSong}
          onAdd={onAdd}
          onInsertNext={(song) => onInsertNext([song])}
        />
      ) : tab === "albums" ? (
        <CardGrid
          t={t}
          title={t("albums")}
          variant="album"
          items={albums.map((album) => ({
            id: album.id,
            title: album.title,
            subtitle: [album.year ? String(album.year) : "", `${album.song_count} ${t("count")}`]
              .filter(Boolean)
              .join(" · "),
            meta: album.artist,
            theme,
            coverUrl: albumCoverUrl(album),
            favorite: album.favorite,
            onClick: () => onOpenAlbum(album),
            onPlay: () => onPlayAlbum(album),
            onFavorite: () => onFavoriteAlbum(album),
          }))}
        />
      ) : tab === "artists" ? (
        <CardGrid
          t={t}
          title={t("artists")}
          variant="artist"
          items={artists.map((artist) => ({
            id: artist.id,
            title: artist.name,
            subtitle: `${artist.song_count} ${t("count")} · ${artist.album_count} ${t("album")}`,
            theme,
            coverUrl: artistCoverUrl(artist),
            favorite: artist.favorite,
            onClick: () => onOpenArtist(artist),
            onPlay: () => onPlayArtist(artist),
            onFavorite: () => onFavoriteArtist(artist),
          }))}
        />
      ) : (
        <CardGrid
          t={t}
          title={t("onlineRadio")}
          variant="radio"
          items={radios.map((station) => ({
            id: station.id || radioRawURL(station),
            title: station.name || t("onlineRadio"),
            subtitle: radioSourceLabel(station, t("liveRadio")),
            theme,
            coverUrl: station.favicon,
            favorite: station.favorite,
            onClick: () => onPlayRadio(station),
            onFavorite: () => onFavoriteRadio(station),
          }))}
        />
      )}
    </section>
  );
}


function VUMeter({ playing }: { playing: boolean }) {
  return (
    <div className="vu-meter" data-playing={playing ? "true" : "false"} aria-hidden="true">
      {Array.from({ length: 10 }, (_, index) => (
        <span key={index} className="vu-bar" style={{ "--i": index, "--peak": `${Math.min(96, 32 + index * 7)}%` } as React.CSSProperties}>
          <i />
        </span>
      ))}
    </div>
  );
}

function PlayerMood({
  theme,
  playing,
  song,
  radio,
  audioEl,
  streamSrc,
  lowBandwidth,
  eqActive,
  onOpenEqualizer,
  equalizerLabel,
}: {
  theme: Theme;
  playing: boolean;
  song: Song | null;
  radio?: RadioStation | null;
  audioEl: HTMLAudioElement | null;
  streamSrc?: string;
  lowBandwidth: boolean;
  eqActive: boolean;
  onOpenEqualizer: () => void;
  equalizerLabel: string;
}) {
  const labels: Record<Theme, string> = {
    "deep-space": "HI-FI ORBIT",
    "amber-film": "VU TAPE",
    "neon-coral": "SPECTRUM",
    "arctic-aurora": "AURORA",
    "carbon-volt": "BPM 128",
    "apple-dark": "LOSSLESS",
    "spotify-dark": "LIVE",
    "netease-dark": "CLOUD",
    "winamp-dark": "CLASSIC",
    "foobar-dark": "BITRATE",
    "milk-porcelain": "MINIMAL",
    "oat-latte": "WAVEFORM",
    "mint-soda": "FRESH",
    "sakura-washi": "WASHI",
    "dusk-amber": "19:42",
    "apple-light": "LOSSLESS",
    "spotify-light": "LIVE",
    "netease-light": "CLOUD",
    "winamp-light": "CLASSIC",
    "foobar-light": "BITRATE",
  };
  const colors = waveThemeColors(theme);
  const waveformPeaks = useMemo(
    () => syntheticWaveformPeaks(song?.id ?? 0),
    [song?.id],
  );
  const [waveReady, setWaveReady] = useState(false);
  const [waveFailed, setWaveFailed] = useState(false);
  useEffect(() => {
    setWaveReady(false);
    setWaveFailed(false);
  }, [song?.id, radio?.id, radio?.url]);
  const canRenderWave = Boolean(song && audioEl && streamSrc && !waveFailed && !lowBandwidth && !prefersLowMemoryVisuals());
  if (radio) {
    return (
      <div className="player-mood player-waveform radio-waveform-mood loading" data-theme-key={theme} data-playing={playing ? "true" : "false"}>
        <span>LIVE</span>
        <button className={eqActive ? "wave-eq-button active" : "wave-eq-button"} type="button" title={equalizerLabel} aria-label={equalizerLabel} onClick={onOpenEqualizer}>
          <SlidersHorizontal />
        </button>
        <div className="wave-lane">
          <div className="wave-fallback">
            {Array.from({ length: 16 }, (_, index) => (
              <i key={index} style={{ "--i": index } as React.CSSProperties} />
            ))}
          </div>
          <div className="vu-meter compact-radio-vu" data-playing={playing ? "true" : "false"}>
            {Array.from({ length: 8 }, (_, index) => (
              <span key={index} className="vu-bar" style={{ "--i": index, "--peak": `${Math.min(90, 30 + index * 8)}%` } as React.CSSProperties}>
                <i />
              </span>
            ))}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div
      className={
        canRenderWave && waveReady
          ? "player-mood player-waveform"
          : "player-mood player-waveform loading"
      }
      data-theme-key={theme}
      data-playing={playing ? "true" : "false"}
    >
      <span>{labels[theme]}</span>
      <button className={eqActive ? "wave-eq-button active" : "wave-eq-button"} type="button" title={equalizerLabel} aria-label={equalizerLabel} onClick={onOpenEqualizer}>
        <SlidersHorizontal />
      </button>
      <div className="wave-lane">
        {(!canRenderWave || !waveReady) && (
          <div className="wave-fallback">
            {Array.from({ length: 16 }, (_, index) => (
              <i key={index} style={{ "--i": index } as React.CSSProperties} />
            ))}
          </div>
        )}
        {canRenderWave && audioEl ? (
          <WavesurferPlayer
            key={song?.id ?? "empty"}
            media={audioEl}
            peaks={waveformPeaks}
            duration={Math.max(1, song?.duration_seconds || audioEl.duration || 1)}
            height={42}
            fillParent
            hideScrollbar
            waveColor={colors.wave}
            progressColor={colors.progress}
            cursorColor={colors.cursor}
            cursorWidth={2}
            barWidth={2}
            barGap={2}
            barRadius={999}
            normalize
            interact
            dragToSeek
            onReady={() => setWaveReady(true)}
            onError={() => {
              setWaveReady(false);
              setWaveFailed(true);
            }}
          />
        ) : null}
        <VUMeter playing={playing && !lowBandwidth} />
      </div>
      <em>{lowBandwidth || waveFailed ? "METER" : theme === "carbon-volt" ? "74%" : playing ? "LIVE" : "IDLE"}</em>
    </div>
  );
}

function waveThemeColors(theme: Theme) {
  const map: Record<Theme, { wave: string; progress: string; cursor: string }> = {
    "deep-space": { wave: "rgba(139,143,216,.38)", progress: "#7c7ed4", cursor: "#bbbfe8" },
    "amber-film": { wave: "rgba(168,124,48,.38)", progress: "#c09030", cursor: "#eddcaa" },
    "neon-coral": { wave: "rgba(192,80,112,.35)", progress: "#d45080", cursor: "#f5d0e0" },
    "arctic-aurora": { wave: "rgba(58,144,184,.35)", progress: "#3a9ac8", cursor: "#c8e8f5" },
    "carbon-volt": { wave: "rgba(53,160,80,.32)", progress: "#35a850", cursor: "#b8f0c8" },
    "apple-dark": { wave: "rgba(252,60,68,.34)", progress: "#FC3C44", cursor: "#FFFFFF" },
    "spotify-dark": { wave: "rgba(29,185,84,.34)", progress: "#1DB954", cursor: "#FFFFFF" },
    "netease-dark": { wave: "rgba(194,12,12,.34)", progress: "#C20C0C", cursor: "#FFFFFF" },
    "winamp-dark": { wave: "rgba(0,255,0,.32)", progress: "#00FF00", cursor: "#FFFF00" },
    "foobar-dark": { wave: "rgba(0,122,204,.34)", progress: "#007ACC", cursor: "#D4D4D4" },
    "milk-porcelain": { wave: "rgba(154,149,142,.35)", progress: "#2c2a27", cursor: "#7a7670" },
    "oat-latte": { wave: "rgba(158,125,94,.35)", progress: "#3d2b1f", cursor: "#c4894a" },
    "mint-soda": { wave: "rgba(106,158,131,.35)", progress: "#1f8c5e", cursor: "#5aad84" },
    "sakura-washi": { wave: "rgba(158,104,120,.34)", progress: "#b04060", cursor: "#e8b0c0" },
    "dusk-amber": { wave: "rgba(158,112,64,.34)", progress: "#c46020", cursor: "#f0b050" },
    "apple-light": { wave: "rgba(252,60,68,.30)", progress: "#FC3C44", cursor: "#E0343B" },
    "spotify-light": { wave: "rgba(29,185,84,.30)", progress: "#1DB954", cursor: "#169C45" },
    "netease-light": { wave: "rgba(194,12,12,.30)", progress: "#C20C0C", cursor: "#A00A0A" },
    "winamp-light": { wave: "rgba(32,144,192,.30)", progress: "#2090C0", cursor: "#005080" },
    "foobar-light": { wave: "rgba(0,122,204,.30)", progress: "#007ACC", cursor: "#005FA3" },
  };
  return map[theme];
}

function syntheticWaveformPeaks(seed: number) {
  let value = Math.max(1, seed || 1);
  const next = () => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  };
  const peaks = Array.from({ length: 192 }, (_, index) => {
    const phase = index / 192;
    const envelope =
      0.2 +
      0.58 * Math.sin(Math.PI * phase) +
      0.18 * Math.sin(Math.PI * phase * 7 + seed * 0.03);
    return Math.max(0.08, Math.min(1, envelope * (0.72 + next() * 0.5)));
  });
  return [peaks];
}

function collectionLabel(
  type: Collection["type"],
  t: ReturnType<typeof createT>,
) {
  if (type === "playlist") return t("playlists");
  if (type === "album") return t("albums");
  return t("artists");
}

function CollectionView({
  collection,
  current,
  t,
  backLabel,
  onBack,
  onPlayAll,
  onPlay,
  onFavorite,
  onAdd,
  onInsertNext,
  onInsertCollection,
  onFavoriteCollection,
  onOpenAlbum,
  onOpenAlbumCard,
  onPlayAlbumCard,
  onOpenArtist,
  onOpenCollectionArtist,
}: {
  collection: Collection;
  current: Song | null;
  t: ReturnType<typeof createT>;
  backLabel?: string;
  onBack: () => void;
  onPlayAll: () => void;
  onPlay: (song: Song, list: Song[]) => void;
  onFavorite: (song: Song) => void;
  onAdd: (song: Song) => void;
  onInsertNext: (songs: Song[]) => void;
  onInsertCollection: () => void;
  onFavoriteCollection?: () => void;
  onOpenAlbum?: (song: Song) => void;
  onOpenAlbumCard?: (album: Album) => void;
  onPlayAlbumCard?: (album: Album) => void;
  onOpenArtist: (song: Song) => void;
  onOpenCollectionArtist?: () => void;
}) {
  const label = collectionLabel(collection.type, t);
  const resolvedBackLabel = backLabel || label;
  const hasResolvableSongs = collection.songs.length > 0 || Boolean(collection.id);
  const [artistView, setArtistView] = useState<"songs" | "albums">("songs");
  const artistAlbums = useMemo(
    () =>
      collection.albums?.length
        ? collection.albums
        : albumsFromSongs(collection.songs, collection.artistId, collection.artistName),
    [collection],
  );
  return (
    <section className="collection-view">
      <button
        className="back-button"
        onClick={onBack}
        aria-label={`${t("backTo")} ${resolvedBackLabel}`}
        title={`${t("backTo")} ${resolvedBackLabel}`}
      >
        <ArrowLeft aria-hidden="true" />
        <span>{resolvedBackLabel}</span>
      </button>
      <div className="collection-hero">
        <CollectionCover collection={collection} />
        <div>
          <p>{label}</p>
          <div className="collection-title-row">
            <h1>{collection.title}</h1>
          </div>
          {onOpenCollectionArtist ? (
            <button
              className="artist-link hero-artist"
              onClick={onOpenCollectionArtist}
            >
              {collection.subtitle}
            </button>
          ) : (
            <span>{collection.subtitle}</span>
          )}
          <div className="collection-actions">
            <button
              className="primary"
              disabled={!hasResolvableSongs}
              onClick={onPlayAll}
            >
              <Play weight="fill" /> {t("playAll")}
            </button>
            <button
              disabled={!hasResolvableSongs}
              onClick={onInsertCollection}
            >
              <SkipForward /> {t("insertNext")}
            </button>
            {onFavoriteCollection ? (
              <button
                className={collection.favorite ? "active" : ""}
                onClick={onFavoriteCollection}
                aria-label={t("favorites")}
              >
                <Heart weight={collection.favorite ? "fill" : "regular"} /> {t("favorites")}
              </button>
            ) : null}
          </div>
        </div>
      </div>
      {collection.type === "artist" ? (
        <div className="collection-tabs">
          <button
            className={artistView === "songs" ? "active" : ""}
            onClick={() => setArtistView("songs")}
          >
            {t("songs")}
          </button>
          <button
            className={artistView === "albums" ? "active" : ""}
            onClick={() => setArtistView("albums")}
          >
            {t("albums")}
          </button>
        </div>
      ) : null}
      {collection.loading ? (
        <div className="collection-inline-status" role="status">
          {t("loadingContent")}
        </div>
      ) : null}
      {collection.error ? (
        <div className="collection-inline-status error" role="alert">
          {collection.error}
        </div>
      ) : null}
      {collection.type === "artist" && artistView === "albums" ? (
        artistAlbums.length ? (
          <div className="artist-album-grid">
            {artistAlbums.map((album) => (
              <article key={album.id} className="artist-album-card">
                <button
                  className="cover plain-cover"
                  aria-label={`${t("play")} ${album.title}`}
                  onClick={() => onPlayAlbumCard?.(album)}
                >
                  <LazyCoverImage src={albumCoverUrl(album)} />
                  <Record weight="fill" />
                  <span className="card-play" aria-hidden="true">
                    <Play weight="fill" />
                  </span>
                </button>
                <button
                  className="artist-album-title"
                  onClick={() => onOpenAlbumCard?.(album)}
                >
                  {album.title}
                </button>
                <span>
                  {[album.year ? String(album.year) : "", `${album.song_count} ${t("count")}`]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </article>
            ))}
          </div>
        ) : collection.loading ? (
          <div className="empty collection-loading">{t("loading")}</div>
        ) : (
          <div className="empty collection-loading">{t("emptyCollection")}</div>
        )
      ) : collection.songs.length ? (
        <SongTable
          songs={collection.songs}
          current={current}
          t={t}
          onPlay={onPlay}
          onFavorite={onFavorite}
          onAdd={onAdd}
          onInsertNext={(song) => onInsertNext([song])}
          onOpenAlbum={onOpenAlbum}
          onOpenArtist={onOpenArtist}
        />
      ) : collection.loading ? (
        <div className="empty collection-loading">{t("loading")}</div>
      ) : (
        <div className="empty collection-loading">{collection.error || t("emptyCollection")}</div>
      )}
    </section>
  );
}


function CollectionCover({ collection }: { collection: Collection }) {
  const firstSong = collection.songs[0];
  const resolvedCover = collection.coverUrl || coverUrl(firstSong);
  const isMediaCover = collection.type !== "playlist";
  const style = !isMediaCover && resolvedCover
    ? ({ "--cover-url": `url(${resolvedCover})` } as React.CSSProperties)
    : undefined;
  return (
    <div
      className={`cover collection-cover ${isMediaCover ? "plain-cover pure-media-cover" : ""}`}
      style={style}
    >
      {isMediaCover && resolvedCover ? <LazyCoverImage src={resolvedCover} /> : null}
      <Record weight="fill" />
    </div>
  );
}

function LibraryView({
  songs,
  folders,
  networkSources,
  radioSources,
  current,
  t,
  onPlay,
  onFavorite,
  onAdd,
  onInsertNext,
  onOpenAlbum,
  onOpenArtist,
  onScan,
  onUpload,
  onPlayFolder,
  onOpenRadio,
  onPlayRadio,
  onNetworkSourcesChange,
  onPlayNetworkTrack,
  scanStatus,
}: {
  songs: Song[];
  folders: Folder[];
  networkSources: NetworkSource[];
  radioSources: RadioSource[];
  current: Song | null;
  t: ReturnType<typeof createT>;
  onPlay: (song: Song, list: Song[]) => void;
  onFavorite: (song: Song) => void;
  onAdd: (song: Song) => void;
  onInsertNext: (songs: Song[]) => void;
  onOpenAlbum: (song: Song) => void;
  onOpenArtist: (song: Song) => void;
  onScan: () => void;
  onUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  onPlayFolder: (folder: Folder) => void;
  onOpenRadio: (source?: RadioSource) => void;
  onPlayRadio: (source: RadioSource, groupSources?: RadioSource[]) => void;
  onNetworkSourcesChange: (sources: NetworkSource[]) => void;
  onPlayNetworkTrack: (track: NetworkTrack) => void;
  scanStatus: ScanStatus | null;
}) {
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [tab, setTabState] = useState<LibraryTab>(() => storedLibraryTab());
  const setTab = (nextTab: LibraryTab) => {
    setTabState(nextTab);
    rememberLibraryTab(nextTab);
  };
  const selectedSongs = songs.filter((song) => selected.has(song.id));
  const toggleSelected = (song: Song) => {
    setSelected((old) => {
      const next = new Set(old);
      if (next.has(song.id)) next.delete(song.id);
      else next.add(song.id);
      return next;
    });
  };
  const insertSelected = () => {
    onInsertNext(selectedSongs);
    setSelected(new Set());
  };
  return (
    <section className="library-view">
      <div className="section-head library-actions">
        <h2>{t("library")}</h2>
        <div>
          {tab === "songs" && selectedSongs.length ? (
            <div className="selection-actions">
              <span>
                {selectedSongs.length} {t("selected")}
              </span>
              <button onClick={insertSelected}>
                <SkipForward /> {t("insertNext")}
              </button>
              <button onClick={() => setSelected(new Set())}>
                {t("clearSelection")}
              </button>
            </div>
          ) : null}
          <button onClick={onScan}>
            <MagnifyingGlass /> {t("scan")}
          </button>
          <label className="upload">
            <UploadSimple /> {t("upload")}
            <input
              type="file"
              accept="audio/*,.flac,.dsf,.dff,.dst,.ape"
              onChange={(event) => onUpload(event)}
            />
          </label>
        </div>
      </div>
      {scanStatus ? <ScanProgress status={scanStatus} t={t} /> : null}
      <div className="collection-tabs library-tabs">
        <button
          className={tab === "songs" ? "active" : ""}
          onClick={() => setTab("songs")}
        >
          {t("localLibrary")} · {songs.length}
        </button>
        <button
          className={tab === "folders" ? "active" : ""}
          onClick={() => setTab("folders")}
        >
          {t("folderBrowser")} · {folders.length}
        </button>
        <button
          className={tab === "network" ? "active" : ""}
          onClick={() => setTab("network")}
        >
          {t("networkLibrary")} · {networkSources.length}
        </button>
        <button
          className={tab === "radio" ? "active" : ""}
          onClick={() => setTab("radio")}
        >
          {t("onlineRadio")} · {radioSources.length}
        </button>
      </div>
      {tab === "network" ? (
        <NetworkLibrarySources
          configuredSources={networkSources}
          t={t}
          onSourcesChange={onNetworkSourcesChange}
          onPlayTrack={onPlayNetworkTrack}
        />
      ) : tab === "radio" ? (
        <LibraryRadioSources sources={radioSources} t={t} onOpenRadio={onOpenRadio} onPlayRadio={onPlayRadio} />
      ) : tab === "folders" ? (
        <FolderBrowser
          current={current}
          t={t}
          onPlay={onPlay}
          onFavorite={onFavorite}
          onAdd={onAdd}
          onInsertNext={onInsertNext}
          onOpenAlbum={onOpenAlbum}
          onOpenArtist={onOpenArtist}
          onPlayFolder={onPlayFolder}
        />
      ) : songs.length ? (
        <SongTable
          songs={songs}
          current={current}
          t={t}
          onPlay={onPlay}
          onFavorite={onFavorite}
          onAdd={onAdd}
          onInsertNext={(song) => onInsertNext([song])}
          onOpenAlbum={onOpenAlbum}
          onOpenArtist={onOpenArtist}
          selectedIds={selected}
          onToggleSelected={toggleSelected}
        />
      ) : (
        <EmptyLibrary t={t} onScan={onScan} onUpload={onUpload} scanStatus={scanStatus} />
      )}
    </section>
  );
}

function NetworkLibrarySources({
  configuredSources,
  t,
  onSourcesChange,
  onPlayTrack,
}: {
  configuredSources: NetworkSource[];
  t: ReturnType<typeof createT>;
  onSourcesChange: (sources: NetworkSource[]) => void;
  onPlayTrack: (track: NetworkTrack) => void;
}) {
  const [provider, setProvider] = useState("navidrome");
  const [name, setName] = useState("");
  const [baseURL, setBaseURL] = useState("");
  const [username, setUsername] = useState("");
  const [secret, setSecret] = useState("");
  const [query, setQuery] = useState("");
  const [activeSourceId, setActiveSourceId] = useState("");
  const [results, setResults] = useState<NetworkTrack[]>([]);
  const [showSourceForm, setShowSourceForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const activeSource = configuredSources.find((source) => source.id === activeSourceId) ?? configuredSources[0];
  const refreshSources = async () => onSourcesChange(await api.networkSources());
  const saveSource = async () => {
    setError("");
    try {
      const saved = await api.saveNetworkSource({
        provider,
        name,
        base_url: baseURL,
        username,
        ...(provider === "plex" || (provider === "jellyfin" && !username) ? { token: secret } : { password: secret }),
      });
      const next = await api.networkSources();
      onSourcesChange(next);
      setActiveSourceId(saved.id);
      setName("");
      setBaseURL("");
      setUsername("");
      setSecret("");
      setShowSourceForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  const testSource = async (source: NetworkSource) => {
    setError("");
    try {
      await api.testNetworkSource(source.id);
      await refreshSources();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      await refreshSources().catch(() => undefined);
    }
  };
  const deleteSource = async (source: NetworkSource) => {
    setError("");
    try {
      await api.deleteNetworkSource(source.id);
      const next = await api.networkSources();
      onSourcesChange(next);
      if (activeSourceId === source.id) setActiveSourceId("");
      setResults([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  const search = async () => {
    if (!activeSource || !query.trim()) return;
    setLoading(true);
    setError("");
    try {
      setResults(await api.searchNetworkTracks(activeSource.id, query.trim(), 40));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setResults([]);
    } finally {
      setLoading(false);
    }
  };
  const providerNeedsToken = provider === "plex" || (provider === "jellyfin" && !username.trim());
  const sourceForm = (
    <div className="radio-source-form">
      <strong>{t("addNetworkSource")}</strong>
      <select value={provider} onChange={(event) => setProvider(event.target.value)}>
        <option value="navidrome">Navidrome / Subsonic</option>
        <option value="jellyfin">Jellyfin</option>
        <option value="plex">Plex</option>
      </select>
      <input value={name} placeholder={t("sourceName")} onChange={(event) => setName(event.target.value)} />
      <input value={baseURL} placeholder="https://music.example.com" onChange={(event) => setBaseURL(event.target.value)} />
      {provider !== "plex" ? (
        <input value={username} placeholder={t("username")} onChange={(event) => setUsername(event.target.value)} />
      ) : null}
      <input
        value={secret}
        type="password"
        placeholder={providerNeedsToken ? t("token") : t("password")}
        onChange={(event) => setSecret(event.target.value)}
      />
      <div className="source-form-actions">
        <button onClick={saveSource} disabled={!baseURL.trim()}>
          <Plus /> {t("addNetworkSource")}
        </button>
        <button type="button" onClick={() => setShowSourceForm(false)}>
          {t("cancel")}
        </button>
      </div>
    </div>
  );
  if (!configuredSources.length && !showSourceForm) {
    return (
      <div className="network-library-panel">
        <div className="network-empty-setup">
          <button className="primary" type="button" onClick={() => setShowSourceForm(true)}>
            <Plus /> {t("addNetworkSource")}
          </button>
        </div>
      </div>
    );
  }
  if (!configuredSources.length) {
    return (
      <div className="network-library-panel">
        <aside className="network-config-panel network-add-only">
          {sourceForm}
          {error ? <div className="message inline-error">{error}</div> : null}
        </aside>
      </div>
    );
  }
  return (
    <div className="network-library-panel">
      <div className="network-layout">
        <aside className="network-config-panel">
          <div className="section-head compact">
            <h3>{t("networkSources")}</h3>
            <button type="button" onClick={() => setShowSourceForm((shown) => !shown)}>
              <Plus /> {t("addNetworkSource")}
            </button>
          </div>
          <div className="radio-source-list">
            {configuredSources.map((source) => (
              <article key={source.id} className={activeSource?.id === source.id ? "radio-source-row active" : "radio-source-row"}>
                <button onClick={() => setActiveSourceId(source.id)}>
                  <MusicNotes weight="fill" />
                  <span>
                    <strong>{source.name}</strong>
                    <small>{source.provider} · {source.base_url}</small>
                  </span>
                </button>
                <button onClick={() => void testSource(source)}>{t("testConnection")}</button>
                <button className="icon-danger" aria-label={t("deleteSource")} onClick={() => void deleteSource(source)}>
                  <X />
                </button>
              </article>
            ))}
          </div>
          {showSourceForm ? sourceForm : null}
        </aside>

        <section className="network-search-panel">
          <div className="section-head compact">
            <div>
              <h3>{t("networkSearch")}</h3>
              <p className="section-subtitle">{activeSource ? `${activeSource.name} · ${activeSource.provider}` : t("selectNetworkSource")}</p>
            </div>
            <label className="search radio-search">
              <MagnifyingGlass />
              <input
                value={query}
                placeholder={t("search")}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void search();
                }}
              />
            </label>
            <button onClick={() => void search()} disabled={!activeSource || !query.trim() || loading}>
              <MagnifyingGlass /> {loading ? t("loading") : t("search")}
            </button>
          </div>
          {error ? <div className="message inline-error">{error}</div> : null}
          <div className="network-track-list" aria-busy={loading}>
            {results.map((track) => (
              <article key={`${track.source_id}-${track.id}`} className="network-track-row">
                <button className="station-play" onClick={() => onPlayTrack(track)}>
                  <Play weight="fill" />
                </button>
                <div className="network-track-cover" style={track.cover_url ? ({ "--cover-url": `url(${track.cover_url})` } as React.CSSProperties) : undefined}>
                  {!track.cover_url ? <Record weight="fill" /> : null}
                </div>
                <div>
                  <strong>{track.title}</strong>
                  <small>{[track.artist, track.album, track.year ? String(track.year) : "", formatDuration(track.duration_seconds)].filter(Boolean).join(" · ")}</small>
                </div>
              </article>
            ))}
            {!results.length && !loading ? <div className="empty">{t("networkSearchEmpty")}</div> : null}
          </div>
        </section>
      </div>
    </div>
  );
}

function FolderBrowser({
  current,
  t,
  onPlay,
  onFavorite,
  onAdd,
  onInsertNext,
  onOpenAlbum,
  onOpenArtist,
  onPlayFolder,
}: {
  current: Song | null;
  t: ReturnType<typeof createT>;
  onPlay: (song: Song, list: Song[]) => void;
  onFavorite: (song: Song) => void;
  onAdd: (song: Song) => void;
  onInsertNext: (songs: Song[]) => void;
  onOpenAlbum: (song: Song) => void;
  onOpenArtist: (song: Song) => void;
  onPlayFolder: (folder: Folder) => void;
}) {
  const [path, setPath] = useState(".");
  const [directory, setDirectory] = useState<FolderDirectory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void withTimeout(api.folderDirectory(path))
      .then((item) => {
        if (!cancelled) setDirectory(item);
      })
      .catch((err) => {
        if (!cancelled) setError(friendlyLoadError(err, t));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  const currentFolder: Folder | null = directory
    ? {
        path: directory.path,
        name: directory.name,
        song_count: directory.song_count,
        duration_seconds: directory.duration_seconds,
        cover_song_id: directory.cover_song_id,
      }
    : null;

  const insertFolderNext = async (folder: Folder) => {
    const items = await api.folderSongs(folder.path);
    if (items.length) onInsertNext(items);
  };

  return (
    <section className="folder-browser">
      <div className="folder-browser-head">
        <div>
          <p className="section-subtitle">{t("folderPlayHint")}</p>
          <div className="folder-breadcrumbs">
            {(directory?.breadcrumbs.length
              ? directory.breadcrumbs
              : [{ path: ".", name: t("folderBrowser") }]
            ).map((crumb, index, items) => (
              <span key={`${crumb.path}-${index}`}>
                <button
                  className={index === items.length - 1 ? "active" : ""}
                  onClick={() => setPath(crumb.path || ".")}
                >
                  {crumb.name}
                </button>
                {index < items.length - 1 ? <CaretRight aria-hidden="true" /> : null}
              </span>
            ))}
          </div>
        </div>
        <div className="folder-browser-actions">
          {directory?.parent_path ? (
            <button onClick={() => setPath(directory.parent_path)}>
              <ArrowUp /> {t("parentFolder")}
            </button>
          ) : null}
          <button
            disabled={!currentFolder || !currentFolder.song_count}
            onClick={() => currentFolder && onPlayFolder(currentFolder)}
          >
            <Play weight="fill" /> {t("playFolder")}
          </button>
          <button
            disabled={!currentFolder || !currentFolder.song_count}
            onClick={() => currentFolder && void insertFolderNext(currentFolder)}
          >
            <SkipForward /> {t("insertFolderNext")}
          </button>
        </div>
      </div>
      {loading ? <div className="collection-inline-status" role="status">{t("loadingContent")}</div> : null}
      {error ? <div className="collection-inline-status error" role="alert">{error}</div> : null}
      {directory ? (
        <>
          <div className="folder-browser-summary">
            <strong>{directory.name}</strong>
            <span>
              {directory.song_count} {t("count")} · {formatDuration(directory.duration_seconds)}
            </span>
          </div>
          {directory.folders.length ? (
            <div className="folder-tree-list">
              <h3>{t("subfolders")}</h3>
              {directory.folders.map((folder) => (
                <button
                  key={folder.path}
                  className="folder-tree-row"
                  onClick={() => setPath(folder.path)}
                >
                  <span className="folder-tree-icon">
                    <FolderSimple weight="fill" />
                  </span>
                  <span>
                    <strong>{folder.name}</strong>
                    <small>
                      {folder.song_count} {t("count")} · {formatDuration(folder.duration_seconds)}
                    </small>
                  </span>
                  <span className="folder-tree-actions">
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={t("playFolder")}
                      onClick={(event) => {
                        event.stopPropagation();
                        onPlayFolder(folder);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          event.stopPropagation();
                          onPlayFolder(folder);
                        }
                      }}
                    >
                      <Play weight="fill" />
                    </span>
                    <CaretRight />
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          <div className="folder-current-songs">
            <h3>{t("currentFolderSongs")}</h3>
            {directory.songs.length ? (
              <SongTable
                songs={directory.songs}
                current={current}
                t={t}
                onPlay={onPlay}
                onFavorite={onFavorite}
                onAdd={onAdd}
                onInsertNext={(song) => onInsertNext([song])}
                onOpenAlbum={onOpenAlbum}
                onOpenArtist={onOpenArtist}
              />
            ) : (
              <div className="empty mini-empty">{t("emptyCollection")}</div>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}

function FullLyrics({
  song,
  lines,
  activeLyric,
  loading,
  t,
  scrollRef,
  onToggleView,
  onSeek,
  candidates,
  candidatesOpen,
  candidatesLoading,
  onOpenCandidates,
  onSelectCandidate,
  onCloseCandidates,
  onUserScroll,
  onOpenArtist,
  onOpenAlbum,
  onFavoriteSong,
}: {
  song: Song | null;
  lines: ReturnType<typeof parseLyricLines>;
  activeLyric: string;
  loading: boolean;
  t: ReturnType<typeof createT>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onToggleView: () => void;
  onSeek: (seconds: number) => void;
  candidates: LyricCandidate[];
  candidatesOpen: boolean;
  candidatesLoading: boolean;
  onOpenCandidates: () => void;
  onSelectCandidate: (candidate: LyricCandidate) => void;
  onCloseCandidates: () => void;
  onUserScroll: () => void;
  onOpenArtist: (song: Song) => void;
  onOpenAlbum: (song: Song) => void;
  onFavoriteSong: (song: Song) => void;
}) {
  const [seekTargetKey, setSeekTargetKey] = useState("");
  const userScrollUntil = useRef(0);
  const seekTimer = useRef<number | null>(null);
  const lyricsTitle = song?.title ?? `${t("brand")} Music`;
  const backgroundStyle = coverUrl(song)
    ? ({ "--cover-url": `url(${coverUrl(song)})` } as React.CSSProperties)
    : undefined;
  useEffect(() => {
    return () => {
      if (seekTimer.current != null) window.clearTimeout(seekTimer.current);
    };
  }, []);
  const syncSeekTargetFromScroll = () => {
    const container = scrollRef.current;
    if (!container || Date.now() > userScrollUntil.current) return;
    const center = container.getBoundingClientRect().top + container.clientHeight / 2;
    const nodes = Array.from(
      container.querySelectorAll<HTMLElement>("[data-lyric-key]"),
    );
    let best: { key: string; at: number; distance: number } | null = null;
    for (const node of nodes) {
      const at = Number(node.dataset.lyricAt);
      if (!Number.isFinite(at) || at < 0) continue;
      const rect = node.getBoundingClientRect();
      const distance = Math.abs(rect.top + rect.height / 2 - center);
      if (!best || distance < best.distance) {
        best = { key: node.dataset.lyricKey || "", at, distance };
      }
    }
    if (!best) return;
    setSeekTargetKey(best.key);
    if (seekTimer.current != null) window.clearTimeout(seekTimer.current);
    seekTimer.current = window.setTimeout(() => {
      onSeek(best!.at);
      seekTimer.current = null;
    }, 220);
  };
  const markUserScroll = () => {
    userScrollUntil.current = Date.now() + 900;
    onUserScroll();
    window.requestAnimationFrame(syncSeekTargetFromScroll);
  };
  return (
    <section className="full-lyrics" style={backgroundStyle}>
      <VinylTurntable cover={coverUrl(song)} playing={false} title={song?.title} artist={song?.artist} decorative />
      <div className="full-lyrics-head">
        <button
          className="full-lyrics-cover-button"
          type="button"
          title={t("lyrics")}
          aria-label={t("lyrics")}
          onClick={onToggleView}
        >
          <MiniCover song={song} playing={false} />
        </button>
        <div>
          <p>{t("nowPlaying")}</p>
          <h1 className="lyrics-title-marquee" title={lyricsTitle}>
            <span>
              <span>{lyricsTitle}</span>
              <span aria-hidden="true">{lyricsTitle}</span>
            </span>
          </h1>
          {song ? (
            <div className="lyrics-meta-links">
              <button onClick={() => onOpenArtist(song)}>{song.artist}</button>
              <span>·</span>
              <button onClick={() => onOpenAlbum(song)}>{song.album}</button>
            </div>
          ) : (
            <span>—</span>
          )}
        </div>
        {song ? (
          <div className="lyrics-actions">
            <button
              className={song.favorite ? "lyrics-pick active" : "lyrics-pick"}
              onClick={() => onFavoriteSong(song)}
              aria-label={t("favorites")}
            >
              <Heart weight={song.favorite ? "fill" : "regular"} />
              {t("favorites")}
            </button>
            <button
              className="lyrics-pick icon-only"
              onClick={onOpenCandidates}
              title={t("chooseLyrics")}
              aria-label={t("chooseLyrics")}
            >
              <GearSix weight="bold" />
            </button>
          </div>
        ) : null}
      </div>
      {candidatesOpen ? (
        <div className="lyrics-candidates">
          <div>
            <strong>{t("chooseLyrics")}</strong>
            <button onClick={onCloseCandidates}>{t("close")}</button>
          </div>
          {candidatesLoading ? (
            <p>{t("matchingLyrics")}</p>
          ) : candidates.length ? (
            candidates.map((candidate, index) => (
              <button
                key={`${candidate.source}-${candidate.id}`}
                onClick={() => onSelectCandidate(candidate)}
              >
                <strong>{candidate.title}</strong>
                <span>{candidate.artist || t("artist")}</span>
                <em>
                  {t("candidate")} {index + 1}
                </em>
              </button>
            ))
          ) : (
            <p>{t("noLyricsTitle")}</p>
          )}
        </div>
      ) : null}
      <div
        className="full-lyrics-lines"
        ref={scrollRef}
        onScroll={syncSeekTargetFromScroll}
        onWheel={markUserScroll}
        onTouchMove={markUserScroll}
      >
        {lines.length ? (
          lines.map((line) => (
            <p
              key={line.key}
              data-lyric-key={line.key}
              data-lyric-at={line.at}
              className={[
                line.key === activeLyric ? "live" : "",
                line.key === seekTargetKey ? "seek-target" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => line.at >= 0 && onSeek(line.at)}
            >
              {line.text}
            </p>
          ))
        ) : (
          <div className="lyrics-empty">
            <strong>
              {loading ? t("matchingLyrics") : t("noLyricsTitle")}
            </strong>
            {!loading && <span>{t("noLyricsBody")}</span>}
          </div>
        )}
      </div>
    </section>
  );
}

function ScanProgress({
  status,
  t,
  compact = false,
}: {
  status: ScanStatus;
  t: ReturnType<typeof createT>;
  compact?: boolean;
}) {
  const currentName = status.current_path || status.current_dir || "—";
  return (
    <div className={compact ? "scan-progress compact" : "scan-progress"}>
      <div className="scan-progress-head">
        <strong>{status.running ? t("scanning") : t("done")}</strong>
        <span>{t("scanStats")}</span>
      </div>
      <div className="scan-progress-stats">
        <span>{status.scanned}</span>
        <span>{status.added}</span>
        <span>{status.updated}</span>
        <span>{status.skipped}</span>
      </div>
      <p>
        <b>{t("scanCurrentDir")}</b>
        <span>{status.current_dir || "—"}</span>
      </p>
      <p>
        <b>{t("scanCurrentFile")}</b>
        <span>{currentName}</span>
      </p>
      {status.errors?.length ? (
        <small>
          {t("error")}: {status.errors[status.errors.length - 1]}
        </small>
      ) : null}
    </div>
  );
}

function EmptyLibrary({
  t,
  onScan,
  onUpload,
  scanStatus,
}: {
  t: ReturnType<typeof createT>;
  onScan: () => void;
  onUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  scanStatus: ScanStatus | null;
}) {
  return (
    <section className="empty-library">
      <div className="disc-art">
        <Record weight="fill" />
      </div>
      <h2>{t("emptyTitle")}</h2>
      <p>{t("emptyBody")}</p>
      <div className="empty-actions">
        <button className="primary" onClick={onScan}>
          <MagnifyingGlass /> {t("scan")}
        </button>
        <label className="upload">
          <UploadSimple /> {t("upload")}
          <input
            type="file"
            accept="audio/*,.flac,.dsf,.dff,.dst,.ape"
            onChange={(event) => onUpload(event)}
          />
        </label>
      </div>
      <small>{t("scanHint")}</small>
      {scanStatus ? <ScanProgress status={scanStatus} t={t} compact /> : null}
    </section>
  );
}

function RadioQueuePanel({
  stations,
  currentRadio,
  playing,
  t,
  onPlay,
  onClose,
}: {
  stations: RadioStation[];
  currentRadio: RadioStation | null;
  playing: boolean;
  t: ReturnType<typeof createT>;
  onPlay: (station: RadioStation) => void;
  onClose: () => void;
}) {
  return (
    <div className="queue-panel radio-queue-panel">
      <div className="queue-head radio-queue-head">
        <strong>{t("onlineRadio")}</strong>
        <button onClick={onClose}>×</button>
      </div>
      <div className="queue-list radio-queue-list">
        {stations.map((station, index) => {
          const active = Boolean(currentRadio && (station.url === currentRadio.url || station.id === currentRadio.id));
          return (
            <button
              key={`${station.id || "radio"}-${station.url}-${index}`}
              className={active ? "active radio-queue-row" : "radio-queue-row"}
              aria-current={active ? "true" : undefined}
              onClick={() => onPlay(station)}
            >
              <span className="radio-queue-logo"><RadioMiniLogo station={station} playing={active && playing} /></span>
              <div>
                <strong>{station.name || t("onlineRadio")}</strong>
                <small>
                  {[station.country, station.codec || station.tags, station.bitrate ? `${station.bitrate}kbps` : ""]
                    .filter(Boolean)
                    .join(" · ") || t("liveRadio")}
                </small>
              </div>
              <em>{active && playing ? "LIVE" : t("play")}</em>
            </button>
          );
        })}
        {!stations.length ? <div className="empty">{t("emptyCollection")}</div> : null}
      </div>
    </div>
  );
}

function QueuePanel({
  queue,
  current,
  t,
  onPlay,
  onClose,
}: {
  queue: Song[];
  current: Song | null;
  t: ReturnType<typeof createT>;
  onPlay: (song: Song) => void;
  onClose: () => void;
}) {
  return (
    <div className="queue-panel">
      <div className="queue-head">
        <strong>{t("queue")}</strong>
        <button onClick={onClose}>×</button>
      </div>
      <div className="queue-list">
        {queue.map((song, index) => (
          <button
            key={`${song.id}-${index}`}
            className={song.id === current?.id ? "active" : ""}
            aria-current={song.id === current?.id ? "true" : undefined}
            onClick={() => onPlay(song)}
          >
            <span>{index + 1}</span>
            <div>
              <strong>{song.title}</strong>
              <small>{song.artist}</small>
            </div>
            <em>{formatDuration(song.duration_seconds)}</em>
          </button>
        ))}
      </div>
    </div>
  );
}

function SleepTimerControl({
  value,
  left,
  onChange,
  t,
}: {
  value: number;
  left: number;
  onChange: (value: number) => void;
  t: ReturnType<typeof createT>;
}) {
  const label = value
    ? `${Math.ceil(left / 60)} ${t("minutes")}`
    : t("sleepTimer");
  return (
    <label
      className={value ? "sleep-control active" : "sleep-control"}
      title={label}
      aria-label={label}
    >
      <Timer />
      {value ? <span className="sleep-countdown">{Math.ceil(left / 60)}</span> : null}
      <select
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      >
        <option value="0">{t("off")}</option>
        <option value="15">15 {t("minutes")}</option>
        <option value="30">30 {t("minutes")}</option>
        <option value="60">60 {t("minutes")}</option>
        <option value="90">90 {t("minutes")}</option>
      </select>
    </label>
  );
}

function UserAvatar({ user }: { user: User }) {
  const label = (user.nickname || user.username || "U").trim();
  const initial = label.slice(0, 1).toUpperCase();
  return user.avatar_data_url ? (
    <img className="user-avatar" src={user.avatar_data_url} alt={label} />
  ) : (
    <span className="user-avatar user-avatar-fallback" aria-label={label}>
      <span>{initial}</span>
    </span>
  );
}

function UserMenu({
  user,
  t,
  onOpenProfile,
  onLogout,
}: {
  user: User;
  t: ReturnType<typeof createT>;
  onOpenProfile: () => void;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const label = user.nickname || user.username;

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", closeOnOutside);
    return () => window.removeEventListener("pointerdown", closeOnOutside);
  }, [open]);

  return (
    <div className="user-menu" ref={menuRef}>
      <button
        type="button"
        className={open ? "user-menu-trigger active" : "user-menu-trigger"}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <UserAvatar user={user} />
        <span>{label}</span>
        <CaretDown weight="bold" />
      </button>
      {open ? (
        <div className="user-menu-popover" role="menu">
          <div className="user-menu-head">
            <UserAvatar user={user} />
            <div>
              <strong>{label}</strong>
              <span>@{user.username}</span>
            </div>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onOpenProfile();
            }}
          >
            <UserCircle /> {t("profileSettings")}
          </button>
          <button
            type="button"
            role="menuitem"
            className="danger"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
          >
            <SignOut /> {t("logout")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function MCPHelpDialog({
  t,
  endpoint,
  tokenExample,
  onClose,
}: {
  t: ReturnType<typeof createT>;
  endpoint: string;
  tokenExample: string;
  onClose: () => void;
}) {
  return (
    <div className="modal-layer mcp-help-layer" role="presentation">
      <button className="modal-scrim" type="button" aria-label={t("close")} onClick={onClose} />
      <div className="modal-card mcp-help-dialog" role="dialog" aria-modal="true" aria-labelledby="mcp-help-title">
        <div className="modal-card-head">
          <div>
            <p>{t("mcpAccess")}</p>
            <h2 id="mcp-help-title">{t("mcpHelpTitle")}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label={t("close")} title={t("close")}>
            <X weight="bold" />
          </button>
        </div>
        <p className="section-subtitle">{t("mcpHelpDescription")}</p>
        <div className="mcp-help-content">
          <section>
            <strong>{t("mcpEndpoint")}</strong>
            <code>{endpoint}</code>
          </section>
          <section>
            <strong>{t("mcpAuthorization")}</strong>
            <code>Authorization: Bearer {tokenExample}</code>
            <code>{endpoint}?token={encodeURIComponent(tokenExample)}</code>
            <span>{t("mcpAuthorizationHeader")}</span>
          </section>
          <section>
            <strong>{t("mcpAvailableTools")}</strong>
            <ul>
              <li>{t("mcpToolArtists")}</li>
              <li>{t("mcpToolAlbums")}</li>
              <li>{t("mcpToolSearch")}</li>
              <li>{t("mcpToolFavorites")}</li>
              <li>{t("mcpToolPlayback")}</li>
              <li>{t("mcpToolLyrics")}</li>
            </ul>
          </section>
          <p className="mcp-token-warning">{t("mcpHelpTokenNotice")}</p>
        </div>
      </div>
    </div>
  );
}

function SettingsPanel({
  settings,
  setSettings,
  libraryDirectories,
  onLibraryDirectoriesChange,
  user,
  resumeMode,
  onResumeModeChange,
  activeTab,
  onTabChange,
  onUpdateProfile,
  t,
}: {
  settings: Settings;
  setSettings: (settings: Settings) => void;
  libraryDirectories: LibraryDirectory[];
  onLibraryDirectoriesChange: (directories: LibraryDirectory[]) => void;
  user: User;
  resumeMode: ResumeMode;
  onResumeModeChange: (mode: ResumeMode) => void;
  activeTab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
  onUpdateProfile: (nickname: string, avatarDataURL: string) => void;
  t: ReturnType<typeof createT>;
}) {
  const darkThemes = themes.filter((theme) => theme.mode === "dark");
  const lightThemes = themes.filter((theme) => theme.mode === "light");
  const [users, setUsers] = useState<User[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [nickname, setNickname] = useState(user.nickname || user.username);
  const [avatarDataURL, setAvatarDataURL] = useState(user.avatar_data_url || "");
  const [webFontFamily, setWebFontFamily] = useState(settings.web_font_family || "");
  const [libraryPathInput, setLibraryPathInput] = useState("");
  const [libraryNoteInput, setLibraryNoteInput] = useState("");
  const [libraryDirError, setLibraryDirError] = useState("");
  const [fonts, setFonts] = useState<WebFont[]>([]);
  const [fontsLoading, setFontsLoading] = useState(false);
  const [fontUploading, setFontUploading] = useState(false);
  const [mcpToken, setMcpToken] = useState<MCPTokenStatus | null>(null);
  const [mcpLoading, setMcpLoading] = useState(false);
  const [mcpHelpOpen, setMcpHelpOpen] = useState(false);
  const [mcpCopied, setMcpCopied] = useState(false);
  const nicknameLabel = settings.language === "zh-CN" ? "昵称" : "Nickname";
  const avatarLabel = settings.language === "zh-CN" ? "头像" : "Avatar";
  const mcpEndpoint = `${window.location.origin}/api/mcp/sse`;
  const mcpTokenExample = mcpToken?.token || mcpToken?.hint || "lark_mcp_...";
  const tabs: { id: SettingsTab; label: string }[] = [
    { id: "profile", label: t("profileSettings") },
    { id: "users", label: t("userManagement") },
    { id: "site", label: t("siteSettings") },
  ];

  useEffect(() => {
    setNickname(user.nickname || user.username);
    setAvatarDataURL(user.avatar_data_url || "");
  }, [user]);

  useEffect(() => {
    setWebFontFamily(settings.web_font_family || "");
  }, [settings.web_font_family]);

  useEffect(() => {
    if (activeTab !== "site") return;
    setFontsLoading(true);
    void api
      .fonts()
      .then(setFonts)
      .catch(() => setFonts([]))
      .finally(() => setFontsLoading(false));
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== "users" || user.role !== "admin") return;
    setUsersLoading(true);
    void api
      .users()
      .then(setUsers)
      .catch(() => setUsers([]))
      .finally(() => setUsersLoading(false));
  }, [activeTab, user.role]);

  useEffect(() => {
    if (activeTab !== "profile") return;
    void api
      .mcpToken()
      .then(setMcpToken)
      .catch(() => setMcpToken(null));
  }, [activeTab]);

  async function generateMcpToken() {
    if (mcpLoading) return;
    setMcpLoading(true);
    setMcpCopied(false);
    try {
      setMcpToken(await api.generateMcpToken());
    } finally {
      setMcpLoading(false);
    }
  }

  async function deleteMcpToken() {
    if (mcpLoading) return;
    setMcpLoading(true);
    setMcpCopied(false);
    try {
      setMcpToken(await api.deleteMcpToken());
    } finally {
      setMcpLoading(false);
    }
  }

  async function copyMcpToken() {
    if (!mcpToken?.token) return;
    await navigator.clipboard.writeText(mcpToken.token);
    setMcpCopied(true);
  }

  async function uploadWebFont(file: File) {
    setFontUploading(true);
    try {
      const nextSettings = await api.uploadFont(file);
      setSettings(nextSettings);
      setWebFontFamily(nextSettings.web_font_family || "");
      setFonts(await api.fonts().catch(() => []));
    } finally {
      setFontUploading(false);
    }
  }

  function applyWebFont(font: WebFont) {
    setWebFontFamily(font.family);
    setSettings({
      ...settings,
      web_font_family: font.family,
      web_font_url: sanitizeUploadedFontURL(font.url),
    });
  }

  async function deleteWebFont(font: WebFont) {
    const nextSettings = await api.deleteFont(font.name);
    setSettings(nextSettings);
    setWebFontFamily(nextSettings.web_font_family || "");
    setFonts(await api.fonts().catch(() => []));
  }

  async function refreshLibraryDirectories() {
    onLibraryDirectoriesChange(await api.libraryDirectories().catch(() => []));
  }

  async function addLibraryDirectory() {
    if (!libraryPathInput.trim()) return;
    setLibraryDirError("");
    try {
      await api.addLibraryDirectory(libraryPathInput.trim(), libraryNoteInput.trim());
      setLibraryPathInput("");
      setLibraryNoteInput("");
      await refreshLibraryDirectories();
    } catch (err) {
      setLibraryDirError(err instanceof Error ? err.message : String(err));
    }
  }

  async function deleteLibraryDirectory(id: string) {
    setLibraryDirError("");
    try {
      await api.deleteLibraryDirectory(id);
      await refreshLibraryDirectories();
    } catch (err) {
      setLibraryDirError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <section className="settings-page">
      <div className="settings-tabs" role="tablist" aria-label={t("settings")}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            className={activeTab === tab.id ? "active" : ""}
            onClick={() => onTabChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "profile" && (
        <div className="settings-grid settings-tab-panel" role="tabpanel">
          <div className="profile-settings-card">
            <div className="profile-settings-head">
              <UserAvatar user={{ ...user, nickname, avatar_data_url: avatarDataURL }} />
              <div>
                <strong>{t("profileSettings")}</strong>
                <span>{user.username}</span>
              </div>
            </div>
            <label>
              {nicknameLabel}
              <input value={nickname} onChange={(e) => setNickname(e.target.value)} />
            </label>
            <label className="upload avatar-upload">
              {avatarLabel}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = () => setAvatarDataURL(String(reader.result || ""));
                  reader.readAsDataURL(file);
                }}
              />
            </label>
            <button onClick={() => onUpdateProfile(nickname, avatarDataURL)}>{t("save")}</button>
          </div>
          <div className="resume-settings-card settings-wide-row">
            <div>
              <strong>{t("playbackResumeSetting")}</strong>
              <span>{t("playbackResumeHint")}</span>
            </div>
            <div className="segmented-control" role="group" aria-label={t("playbackResumeSetting")}>
              <button
                type="button"
                className={resumeMode === "resume" ? "active" : ""}
                onClick={() => onResumeModeChange("resume")}
              >
                {t("resumeFromHistory")}
              </button>
              <button
                type="button"
                className={resumeMode === "restart" ? "active" : ""}
                onClick={() => onResumeModeChange("restart")}
              >
                {t("restartFromBeginning")}
              </button>
            </div>
          </div>
          <div className="mcp-card settings-wide-row">
            <div className="mcp-card-head">
              <div>
                <strong>{t("mcpToken")}</strong>
                <span>{t("mcpTokenHint")}</span>
              </div>
              <button type="button" onClick={() => setMcpHelpOpen(true)}>
                {t("mcpHelp")}
              </button>
            </div>
            <div className="mcp-status-row">
              <span className={mcpToken?.configured ? "status-pill active" : "status-pill"}>
                {mcpToken?.configured
                  ? `${t("mcpTokenConfigured")} ${mcpToken.hint || ""}`
                  : t("mcpTokenNotConfigured")}
              </span>
              <code>{mcpEndpoint}</code>
            </div>
            {mcpToken?.token ? (
              <div className="mcp-token-once" role="status">
                <span>{t("mcpTokenShownOnce")}</span>
                <code>{mcpToken.token}</code>
                <button
                  type="button"
                  className="icon-button copy-token-button"
                  onClick={() => void copyMcpToken()}
                  aria-label={mcpCopied ? t("copied") : t("copy")}
                  title={mcpCopied ? t("copied") : t("copy")}
                >
                  <CopySimple weight="bold" />
                  <span>{mcpCopied ? t("copied") : t("copy")}</span>
                </button>
              </div>
            ) : null}
            <div className="mcp-actions">
              <button type="button" className="primary" onClick={() => void generateMcpToken()} disabled={mcpLoading}>
                {mcpLoading ? t("loading") : t("generateMcpToken")}
              </button>
              <button type="button" onClick={() => void deleteMcpToken()} disabled={mcpLoading || !mcpToken?.configured}>
                {t("deleteMcpToken")}
              </button>
            </div>
          </div>
          {mcpHelpOpen ? (
            <MCPHelpDialog
              t={t}
              endpoint={mcpEndpoint}
              tokenExample={mcpTokenExample}
              onClose={() => setMcpHelpOpen(false)}
            />
          ) : null}
        </div>
      )}

      {activeTab === "users" && (
        <div className="settings-grid settings-tab-panel" role="tabpanel">
          {user.role === "admin" ? (
            <>
              <label className="switch-row settings-wide-row">
                <span>{t("allowRegistration")}</span>
                <input
                  type="checkbox"
                  checked={settings.registration_enabled}
                  onChange={(e) =>
                    setSettings({ ...settings, registration_enabled: e.target.checked })
                  }
                />
              </label>
              <div className="user-list settings-wide-row">
                <div className="user-list-head">
                  <strong>{t("userList")}</strong>
                  <span>{usersLoading ? t("loading") : `${users.length} ${t("users")}`}</span>
                </div>
                {users.map((item) => (
                  <div className="user-list-row" key={item.id}>
                    <UserAvatar user={item} />
                    <div>
                      <strong>{item.nickname || item.username}</strong>
                      <span>@{item.username}</span>
                    </div>
                    <em>{item.role === "admin" ? "Admin" : "User"}</em>
                    <small>{formatDateTime(item.created_at)}</small>
                  </div>
                ))}
                {!usersLoading && users.length === 0 ? (
                  <div className="settings-empty">{t("emptyCollection")}</div>
                ) : null}
              </div>
            </>
          ) : (
            <div className="settings-empty settings-wide-row">{t("adminOnly")}</div>
          )}
        </div>
      )}

      {activeTab === "site" && (
        <div className="settings-grid settings-tab-panel" role="tabpanel">
          <label>
            {t("language")}
            <select
              value={settings.language}
              onChange={(e) =>
                setSettings({ ...settings, language: e.target.value as Language })
              }
            >
              <option value="zh-CN">简体中文</option>
              <option value="en-US">English</option>
            </select>
          </label>
          <label>
            {t("theme")}
            <select
              value={settings.theme}
              onChange={(e) =>
                setSettings({ ...settings, theme: normalizeTheme(e.target.value) })
              }
            >
              <optgroup label={t("darkThemes")}>
                {darkThemes.map((theme) => (
                  <option key={theme.id} value={theme.id}>
                    {t(theme.label)}
                  </option>
                ))}
              </optgroup>
              <optgroup label={t("lightThemes")}>
                {lightThemes.map((theme) => (
                  <option key={theme.id} value={theme.id}>
                    {t(theme.label)}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
          <div className="font-settings-card settings-wide-row">
            <div>
              <strong>{t("webFontSettings")}</strong>
              <span>{t("webFontHint")}</span>
            </div>
            <label className="upload font-upload-control">
              <UploadSimple /> {fontUploading ? t("loading") : t("uploadWebFont")}
              <input
                type="file"
                accept=".woff2,.woff,.ttf,.otf,font/woff2,font/woff,font/ttf,font/otf"
                disabled={fontUploading}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.currentTarget.value = "";
                  if (file) void uploadWebFont(file);
                }}
              />
            </label>
            <label>
              {t("webFontFamily")}
              <input
                value={webFontFamily}
                placeholder="Lark Custom Font"
                onChange={(event) => setWebFontFamily(event.target.value)}
              />
            </label>
            <div className="font-current-row">
              <span>{t("currentFont")}</span>
              <strong style={{ fontFamily: settings.web_font_family ? `"${settings.web_font_family}", var(--font-cjk)` : undefined }}>
                {settings.web_font_family || t("defaultFont")}
              </strong>
            </div>
            <div className="font-actions">
              <button
                type="button"
                disabled={!settings.web_font_url}
                onClick={() =>
                  setSettings({
                    ...settings,
                    web_font_family: sanitizeFontFamily(webFontFamily),
                    web_font_url: sanitizeUploadedFontURL(settings.web_font_url),
                  })
                }
              >
                {t("saveFontSettings")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setWebFontFamily("");
                  setSettings({ ...settings, web_font_family: "", web_font_url: "" });
                }}
              >
                {t("useDefaultFont")}
              </button>
            </div>
            <div className="font-library" aria-busy={fontsLoading}>
              <div className="font-library-head">
                <strong>{t("fontLibrary")}</strong>
                <span>{fontsLoading ? t("loading") : `${fonts.length} ${t("fonts")}`}</span>
              </div>
              {fonts.length ? (
                <div className="font-picker-list">
                  {fonts.map((font) => {
                    const active = settings.web_font_url === font.url;
                    return (
                      <div key={font.name} className={active ? "font-picker-item active" : "font-picker-item"}>
                        <button
                          type="button"
                          className="font-sample"
                          style={{ fontFamily: `"${font.family}", var(--font-cjk)` }}
                          onClick={() => applyWebFont(font)}
                        >
                          <strong>{font.family}</strong>
                          <span>{font.name} · {formatBytes(font.size)}</span>
                        </button>
                        <div className="font-item-actions">
                          <button type="button" className={active ? "active" : ""} onClick={() => applyWebFont(font)}>
                            {active ? t("selectedFont") : t("applyFont")}
                          </button>
                          <button type="button" className="danger" onClick={() => void deleteWebFont(font)}>
                            {t("deleteFont")}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="settings-empty">{t("noFontsUploaded")}</div>
              )}
            </div>
          </div>
          <div className="library-dir-card settings-wide-row">
            <div className="library-dir-head">
              <div>
                <strong>{t("libraryDirectories")}</strong>
                <span>{t("libraryDirectoriesHint")}</span>
              </div>
              <span>{libraryDirectories.length} {t("folders")}</span>
            </div>
            <div className="library-dir-list">
              {libraryDirectories.map((dir) => (
                <div key={dir.id} className={dir.builtin ? "library-dir-row builtin" : "library-dir-row"}>
                  <div>
                    <strong>{dir.builtin ? t("envLibraryDirectory") : (dir.note || t("customLibraryDirectory"))}</strong>
                    <span>{dir.path}</span>
                  </div>
                  {dir.builtin ? <em>{t("readOnly")}</em> : <button type="button" className="danger" onClick={() => void deleteLibraryDirectory(dir.id)}>{t("remove")}</button>}
                </div>
              ))}
            </div>
            <div className="library-dir-form">
              <label>
                {t("customLibraryPath")}
                <input value={libraryPathInput} placeholder="/mnt/music" onChange={(event) => setLibraryPathInput(event.target.value)} />
              </label>
              <label>
                {t("libraryDirectoryNote")}
                <input value={libraryNoteInput} placeholder={t("libraryDirectoryNotePlaceholder")} onChange={(event) => setLibraryNoteInput(event.target.value)} />
              </label>
              <button type="button" onClick={() => void addLibraryDirectory()} disabled={!libraryPathInput.trim()}>
                <Plus /> {t("addLibraryDirectory")}
              </button>
            </div>
            {libraryDirError ? <div className="settings-empty error">{libraryDirError}</div> : null}
          </div>
        </div>
      )}
    </section>
  );
}

function AboutView({
  health,
  settings,
  t,
}: {
  health: HealthInfo | null;
  settings: Settings;
  t: ReturnType<typeof createT>;
}) {
  const rows: { label: string; value: ReactNode }[] = [
    { label: t("github"), value: <a href="https://github.com/ca-x/lark" target="_blank" rel="noreferrer">github.com/ca-x/lark</a> },
    { label: t("author"), value: settings.language === "zh-CN" ? "虫子樱桃" : "czyt" },
    { label: t("version"), value: health?.full_version || health?.version || "lark/dev" },
    {
      label: t("commit"),
      value:
        health?.commit && health.commit !== "unknown"
          ? health.commit.slice(0, 12)
          : "unknown",
    },
    { label: t("buildTime"), value: health?.build_time || "unknown" },
    { label: t("runtime"), value: health?.go_version || "unknown" },
    { label: t("libraryPath"), value: health?.library || settings.library_path || "—" },
    { label: t("audioBackend"), value: health?.audio_backend || "unknown" },
    { label: t("metadataBackend"), value: health?.metadata_backend || "unknown" },
    { label: t("transcodeBackend"), value: health?.transcode_backend || "unknown" },
  ];
  return (
    <section className="about-page">
      <div className="about-hero">
        <img src="/logo.png" alt={t("brand")} />
        <div>
          <p>{t("about")}</p>
          <h2>{t("brand")}</h2>
          <span>{t("aboutTagline")}</span>
        </div>
      </div>
      <div className="about-grid">
        {rows.map((row) => (
          <div className="about-row" key={row.label}>
            <span>{row.label}</span>
            <strong>{row.value}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}
function SongTable({
  songs,
  current,
  t,
  onPlay,
  onFavorite,
  onAdd,
  onInsertNext,
  onOpenAlbum,
  onOpenArtist,
  selectedIds,
  onToggleSelected,
}: {
  songs: Song[];
  current: Song | null;
  t: ReturnType<typeof createT>;
  onPlay: (song: Song, list: Song[]) => void;
  onFavorite: (song: Song) => void;
  onAdd: (song: Song) => void;
  onInsertNext?: (song: Song) => void;
  onOpenAlbum?: (song: Song) => void;
  onOpenArtist?: (song: Song) => void;
  selectedIds?: Set<number>;
  onToggleSelected?: (song: Song) => void;
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const pendingScrollTopRef = useRef(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(520);
  const virtual = songs.length > VIRTUAL_TABLE_THRESHOLD;
  useLayoutEffect(() => {
    if (!virtual || !scrollerRef.current) return;
    const node = scrollerRef.current;
    const update = () => setViewportHeight(node.clientHeight || 520);
    update();
    const resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(node);
    return () => resizeObserver.disconnect();
  }, [virtual]);
  useEffect(() => {
    return () => {
      if (scrollFrameRef.current != null)
        window.cancelAnimationFrame(scrollFrameRef.current);
    };
  }, []);
  const handleVirtualScroll = (event: UIEvent<HTMLDivElement>) => {
    pendingScrollTopRef.current = event.currentTarget.scrollTop;
    if (scrollFrameRef.current != null) return;
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      setScrollTop(pendingScrollTopRef.current);
    });
  };
  const windowed = useMemo(() => {
    if (!virtual) return { start: 0, items: songs };
    const start = Math.max(
      0,
      Math.floor(scrollTop / SONG_ROW_HEIGHT) - VIRTUAL_OVERSCAN,
    );
    const visible = Math.ceil(viewportHeight / SONG_ROW_HEIGHT);
    const end = Math.min(
      songs.length,
      start + visible + VIRTUAL_OVERSCAN * 2,
    );
    return { start, items: songs.slice(start, end) };
  }, [songs, scrollTop, viewportHeight, virtual]);
  const renderRow = (song: Song, absoluteIndex: number) => (
    <div
      key={song.id}
      className={current?.id === song.id ? "song-row active" : "song-row"}
      style={
        virtual
          ? ({
              top: absoluteIndex * SONG_ROW_HEIGHT,
            } as React.CSSProperties)
          : undefined
      }
      onDoubleClick={() => onPlay(song, songs)}
    >
      {onToggleSelected ? (
        <label
          className="row-check"
          aria-label={`${t("selected")} ${song.title}`}
        >
          <input
            type="checkbox"
            checked={selectedIds?.has(song.id) ?? false}
            onChange={() => onToggleSelected(song)}
          />
        </label>
      ) : (
        <span>{absoluteIndex + 1}</span>
      )}
      <button onClick={() => onPlay(song, songs)} aria-label={t("play")}>
        <Play weight="fill" />
      </button>
      <div>
        <strong>{song.title}</strong>
        {onOpenArtist && song.artist_id ? (
          <button className="artist-link" onClick={() => onOpenArtist(song)}>
            {song.artist}
          </button>
        ) : (
          <small>{song.artist}</small>
        )}
      </div>
      <div>
        {onOpenAlbum && song.album_id ? (
          <button className="artist-link" onClick={() => onOpenAlbum(song)}>
            {song.album}
          </button>
        ) : (
          song.album
        )}
      </div>
      <div>{formatQuality(song)}</div>
      <div>{formatDuration(song.duration_seconds)}</div>
      <button onClick={() => onFavorite(song)} aria-label={t("favorites")}>
        <Heart weight={song.favorite ? "fill" : "regular"} />
      </button>
      {onInsertNext ? (
        <button
          onClick={() => onInsertNext(song)}
          title={t("playNext")}
          aria-label={t("playNext")}
        >
          <SkipForward />
        </button>
      ) : null}
      <button onClick={() => onAdd(song)}>{t("addToPlaylist")}</button>
    </div>
  );
  if (!songs.length) return <div className="empty">{t("noSongs")}</div>;
  if (virtual) {
    return (
      <section
        className="song-table virtual"
        ref={scrollerRef}
        onScroll={handleVirtualScroll}
      >
        <div
          className="song-table-spacer"
          style={{ height: songs.length * SONG_ROW_HEIGHT }}
        >
          {windowed.items.map((song, offset) =>
            renderRow(song, windowed.start + offset),
          )}
        </div>
      </section>
    );
  }
  return (
    <section className="song-table">
      {songs.map((song, index) => renderRow(song, index))}
    </section>
  );
}

const LazyCoverImage = memo(function LazyCoverImage({ src }: { src?: string }) {
  const [failedSrc, setFailedSrc] = useState("");

  useEffect(() => {
    if (src !== failedSrc) setFailedSrc("");
  }, [failedSrc, src]);

  if (!src || failedSrc === src) return null;
  return (
    <img
      className="cover-image"
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      onLoad={(event) => {
        event.currentTarget.dataset.loaded = "true";
      }}
      onError={() => setFailedSrc(src)}
    />
  );
});

type CardGridItem = {
  id: number | string;
  title: string;
  subtitle: string;
  meta?: string;
  theme: string;
  coverUrl?: string;
  favorite?: boolean;
  onClick: () => void;
  onMetaClick?: () => void;
  onPlay?: () => void;
  onFavorite?: () => void;
};

type CardGridProps = {
  t: ReturnType<typeof createT>;
  title: string;
  variant?: "playlist" | "album" | "artist" | "radio";
  items: CardGridItem[];
  action?: React.ReactNode;
  actionKey?: string | number;
};

function cardGridItemsEqual(a: CardGridItem[], b: CardGridItem[]) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (
      left.id !== right.id ||
      left.title !== right.title ||
      left.subtitle !== right.subtitle ||
      left.meta !== right.meta ||
      left.theme !== right.theme ||
      left.coverUrl !== right.coverUrl ||
      left.favorite !== right.favorite ||
      Boolean(left.onPlay) !== Boolean(right.onPlay) ||
      Boolean(left.onFavorite) !== Boolean(right.onFavorite) ||
      Boolean(left.onMetaClick) !== Boolean(right.onMetaClick)
    ) {
      return false;
    }
  }
  return true;
}

function areCardGridPropsEqual(previous: CardGridProps, next: CardGridProps) {
  return (
    previous.title === next.title &&
    previous.variant === next.variant &&
    previous.actionKey === next.actionKey &&
    cardGridItemsEqual(previous.items, next.items)
  );
}

const CardGrid = memo(function CardGrid({
  t,
  title,
  items,
  action,
  variant = "playlist",
}: CardGridProps) {
  const [visibleCount, setVisibleCount] = useState(CARD_GRID_BATCH);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const visibleItems = items.slice(0, Math.min(visibleCount, items.length));
  const hasMore = visibleCount < items.length;

  useEffect(() => {
    setVisibleCount(CARD_GRID_BATCH);
  }, [items.length, title, variant]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore) return;
    if (!("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setVisibleCount((count) =>
          Math.min(items.length, count + CARD_GRID_BATCH),
        );
      },
      { rootMargin: "720px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, items.length, visibleCount]);

  return (
    <section>
      <div className="section-head">
        <h2>{title}</h2>
        {action}
      </div>
      {items.length ? (
        <div className="cards">
          {visibleItems.map((item) => {
            const useLazyCoverImage = variant !== "playlist" && item.coverUrl;
            return (
              <button
                className={`media-card ${item.theme} card-${variant}`}
                key={item.id}
                onClick={item.onClick}
              >
                <div
                  className={
                    variant === "playlist" ? "cover" : "cover plain-cover"
                  }
                  style={
                    variant === "playlist" && item.coverUrl
                      ? ({
                          "--cover-url": `url(${item.coverUrl})`,
                        } as React.CSSProperties)
                      : undefined
                  }
                >
                  {useLazyCoverImage ? (
                    <LazyCoverImage src={item.coverUrl} />
                  ) : null}
                  <Record weight="fill" />
                  {item.onPlay ? (
                    <span
                      className="card-play"
                      role="button"
                      tabIndex={0}
                      aria-label={t("play")}
                      onClick={(event) => {
                        event.stopPropagation();
                        item.onPlay?.();
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          event.stopPropagation();
                          item.onPlay?.();
                        }
                      }}
                    >
                      <Play weight="fill" />
                    </span>
                  ) : null}
                  {item.onFavorite ? (
                    <span
                      className={
                        item.favorite ? "card-favorite active" : "card-favorite"
                      }
                      role="button"
                      tabIndex={0}
                      aria-label={t("favorites")}
                      onClick={(event) => {
                        event.stopPropagation();
                        item.onFavorite?.();
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          event.stopPropagation();
                          item.onFavorite?.();
                        }
                      }}
                    >
                      <Heart weight={item.favorite ? "fill" : "regular"} />
                    </span>
                  ) : null}
                </div>
                <strong>{item.title}</strong>
                {item.meta ? (
                  <span className="card-meta">
                    <em
                      role="button"
                      tabIndex={0}
                      onClick={(event) => {
                        event.stopPropagation();
                        item.onMetaClick?.();
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          event.stopPropagation();
                          item.onMetaClick?.();
                        }
                      }}
                    >
                      {item.meta}
                    </em>
                    <small>{item.subtitle}</small>
                  </span>
                ) : (
                  <span>{item.subtitle}</span>
                )}
              </button>
            );
          })}
          {hasMore ? (
            <div className="card-sentinel" ref={sentinelRef}>
              <button
                type="button"
                onClick={() =>
                  setVisibleCount((count) =>
                    Math.min(items.length, count + CARD_GRID_BATCH),
                  )
                }
              >
                {t("loadMore")} · {visibleCount}/{items.length}
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="empty">{t("emptyCollection")}</div>
      )}
    </section>
  );
}, areCardGridPropsEqual);
