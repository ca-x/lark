import type { ChangeEvent, ReactNode, UIEvent } from "react";
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Calendar from "react-calendar";
import "react-calendar/dist/Calendar.css";
import {
  ArrowClockwise,
  CardsThree,
  ClockCounterClockwise,
  Disc,
  DotsThree,
  GearSix,
  Info,
  ArrowLeft,
  ArrowUp,
  CaretRight,
  ChatText,
  Cloud,
  FolderSimple,
  Heart,
  HeartStraight,
  House,
  MagnifyingGlass,
  MusicNotes,
  Pause,
  PencilSimple,
  Play,
  Playlist as PlaylistIcon,
  Plus,
  CopySimple,
  CheckCircle,
  CircleNotch,
  DownloadSimple,
  Minus,
  Queue,
  Record,
  Repeat,
  RepeatOnce,
  Screencast,
  ShareNetwork,
  Shuffle,
  SlidersHorizontal,
  SkipBack,
  SkipForward,
  SpeakerSimpleHigh,
  SquaresFour,
  Timer,
  UploadSimple,
  UserCircle,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import WavesurferPlayer from "@wavesurfer/react";
import { api, SESSION_CHANGED_EVENT, setExpectedSessionUserId } from "./services/api";
import {
  getCandidateCache,
  invalidateLyricCandidateCache,
  loadCandidateCache,
  reloadCandidateCache,
  lyricCandidateCacheKey,
} from "./services/candidateCache";
import { prependOptimisticPlaybackHistoryEntry, shouldLoadPlaybackHistory } from "./playbackHistory";
import {
  hasClientMediaSession,
  setClientActionHandler,
  setClientMediaMetadata,
  setClientPlaybackState,
  setClientPositionState,
  setLazycatImmersive,
  syncLazycatChrome,
} from "./services/lazycat";
import {
  audioOutputSnapshot,
  prepareAudioForBackgroundPlayback,
  resumeAudioContext,
  shouldHandleStallAsNetworkIssue,
  shouldPauseForAudioOutputDisconnect,
  shouldPreservePlaybackIntentOnMediaError,
  shouldReloadMediaOnForeground,
  shouldResumePlaybackOnForeground,
  type AudioOutputSnapshot,
} from "./services/playbackControl";
import { playUISound, previewUISound, setUISoundSettings } from "./services/uiSounds";
import {
  cacheOfflineSongAssets,
  clearOfflineCache,
  findOfflineSongEntry,
  offlineCacheUsage,
  offlineCachedSongIds,
  offlineSongEntries,
  readOfflineSongIndex,
  removeOfflineSongEntry,
  upsertOfflineSongEntry,
  type OfflineCacheUsage,
  OfflineLibraryPanel,
  type OfflineSongEntry,
  OfflineCacheButton,
  type OfflineCacheButtonState,
  OfflineSettingsCard,
  type OfflineSongIndex,
} from "./features/offline";
import type {
  Album,
  AlbumPage,
  Artist,
  ArtistAlbumDisplayStyle,
  ArtistPage,
  AuthStatus,
  DLNADevice,
  DLNAStatus,
  Folder,
  FolderDirectory,
  FolderMetadataCorrectionResult,
  HealthInfo,
  HomePlayerStyle,
  Language,
  LyricCandidate,
  LyricsDisplayStyle,
  Lyrics,
  MCPTokenStatus,
  MetadataWritebackResult,
  MobileHomePlayerStyle,
  Playlist,
  PlaylistPage,
  ScanStatus,
  Settings,
  Song,
  SongPage,
  SongSort,
  SongReview,
  LibraryReviewSummary,
  SubsonicCredentialStatus,
  TerminalShellTheme,
  Theme,
  UISoundSettings,
  PlaybackHistoryEntry,
  PlaybackHistorySettings,
  PlaybackQueueStatus,
  User,
  UserPreferences,
  WebFont,
  LibraryDirectory,
  LibraryStats,
  NetworkSource,
  NetworkTrack,
  RadioSource,
  RadioStation,
  ScrobblingSettings,
  SmartPlaylist,
} from "./types";
import { createT, libraryDirectoryStatusLabel, smartPlaylistLabel, type TKey } from "./i18n";
import { RadioReceiver } from "./components/RadioPlayer";
import { LibraryRadioSources, RadioView } from "./components/RadioLibrary";
import { radioGroupName } from "./components/radio";
import { ArtistAlbumBrowser } from "./components/ArtistAlbumBrowser";
import { MobileBottomNav } from "./components/mobile/MobileBottomNav";
import { MobileHomeSurface } from "./components/mobile/MobileHomeSurface";
import { MobileMiniPlayer } from "./components/mobile/MobileMiniPlayer";
import { MobilePlayerDock } from "./components/mobile/MobilePlayerDock";
import { MobileSoundPanel } from "./components/mobile/MobileSoundPanel";
import { AlbumSlidePlayer, CassetteDeck, GramophonePlayer, IpodPlayer, MineradioStagePlayer, NeuralCathedralPlayer, PaperShaderLayer, RunningKittenTurntable, SingularityPlayer, SmartisanTurntable, VinylTurntable, WalkmanPlayer } from "./components/player-themes";
import { PublicShareView } from "./components/PublicShareView";
import { ShareManagementView } from "./components/ShareManagementView";
import { ShareDialog, type ShareTarget } from "./components/ShareDialog";
import { DLNACastPanel } from "./components/DLNACastPanel";
import { EqualizerPanel } from "./components/EqualizerPanel";
import { EQ_FREQUENCIES, EQ_STORAGE_KEY, TONE_STORAGE_KEY, clampEqGain, storedEqualizer, storedToneControls } from "./components/equalizer";
import { SkeletonSongList } from "./components/Skeleton";
import { EmptyState } from "./components/EmptyState";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsNavigation } from "./components/settings/SettingsNavigation";
import { SettingsSearch } from "./components/settings/SettingsSearch";
import { PluginSettings } from "./components/PluginSettings";
import {
  fromSongloftPlayMode,
  toSongloftPlayMode,
  type SongloftPlayMode,
} from "./features/plugins/songloftPlayerMode";
import { queueBoundaryAction } from "./features/playback/playMode";
import type { SongloftHostCall, SongloftPlayerState } from "./components/PluginHost";
import { LibrarySortControl } from "./components/LibrarySortControl";
import { CardGrid } from "./components/CardGrid";
import { LazyCoverImage } from "./components/LazyCoverImage";
import { PaginationControls, type PageLike } from "./components/PaginationControls";
import { UserAvatar, UserMenu } from "./components/UserMenu";
import { TerminalShell } from "./components/terminal/TerminalShell";
import { AuthView } from "./components/AuthView";
import { AddToPlaylistDialog, PlaylistDialog } from "./components/PlaylistDialogs";
import { MetadataEditorDialog, type MetadataEditorTarget } from "./components/MetadataEditorDialog";
import { FolderMetadataCorrectionDialog } from "./components/FolderMetadataCorrectionDialog";
import { useMediaQuery } from "./hooks/useMediaQuery";
import { useScrollRestore } from "./hooks/useScrollRestore";
import { useKeyboardAware } from "./hooks/useKeyboardAware";
import { useDialogLifecycle } from "./hooks/useDialogLifecycle";
import type { View, PlayMode, ResumeMode, PlaybackStartMode, PlaybackSourceInput, PlaySongOptions, StreamMode, RecentHomeTab, DailyDiscoveryView, PageSizing, SettingsTab, LibraryTab, Collection, OfflineCacheControls } from "./types/app";
import { MOBILE_PLAYBACK_VIEWS } from "./types/app";
import {
  themes,
  AUTO_DOWNGRADE_STALL_MS, RADIO_STATION_LIMIT, HOME_RECENT_LIMIT, PLAYBACK_HISTORY_LIMIT,
  DEFAULT_LIBRARY_PAGE_SIZE, DEFAULT_GRID_PAGE_SIZE,
  MAX_GRID_PAGE_SIZE, STARTUP_FOLDER_LIMIT, MAX_PLAYBACK_QUEUE_SIZE, RESUME_SOURCE_QUEUE_LIMIT,
  FAVORITES_FETCH_LIMIT, COLLECTION_DETAIL_SONG_LIMIT, OFFLINE_STATUS_POLL_MS, OFFLINE_STATUS_MAX_POLLS,
  SONG_ROW_HEIGHT, VIRTUAL_TABLE_THRESHOLD, VIRTUAL_OVERSCAN, COLLECTION_LOAD_TIMEOUT_MS,
  LIBRARY_SOURCE_TAB_KEY, HOME_PLAYER_STYLE_KEY, MOBILE_HOME_PLAYER_STYLE_KEY,
  ARTIST_ALBUM_DISPLAY_STYLE_KEY, MINERADIO_STAGE_ENABLED_KEY, PERSISTENT_QUEUE_KEY, AUTO_CACHE_PLAYED_KEY, AUTH_REDIRECT_KEY,
  defaultLibraryTab, emptyOfflineUsage, measurePageSizing,
} from "./constants";
import {
  adjustedLyricTime,
  albumCoverUrl,
  albumsFromSongs,
  artistCoverUrl,
  compactLibraryCount,
  coverUrl,
  defaultStreamMode,
  fontFormat,
  formatBytes,
  formatDateTime,
  formatDownloadSpeed,
  formatDuration,
  formatQuality,
  friendlyLoadError,
  hasOnlineLyricsSource,
  isAbortError,
  loadWithTimeout,
  lyricsMatchConfidence,
  mergeAlbums,
  normalizeLyricsFontSize,
  normalizeTheme,
  parseLyricLines,
  prefersLowBandwidthStream,
  queueWithCurrent,
  radioRawURL,
  radioSourceLabel,
  radioSourceToStation,
  radioStationToPlayable,
  radioStreamBitrateKbps,
  readableErrorMessage,
  resumePosition,
  sameRadioStation,
  sanitizeFontFamily,
  sanitizeUploadedFontURL,
  shouldPreferOfflinePlayback,
  streamUrl,
  uniqueRadioStations,
  randomQueueIndex,
  uniqueSongs,
  wait,
  withTimeout,
} from "./utils/app";

const ARTIST_INITIALS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ#".split("");
const SLEEP_DURATION_PRESETS = [15, 30, 60, 90] as const;
const SLEEP_SONG_PRESETS = [1, 3, 5] as const;
const LYRIC_OFFSET_STEP_MS = [-500, -100, 100, 500] as const;
const MAX_LYRIC_OFFSET_MS = 10_000;
const LYRIC_ACTIVE_ANCHOR_RATIO = 0.38;
const LYRICS_DEPTH_PARTICLES = Array.from({ length: 36 }, (_, index) => index);
const LYRICS_DEPTH_RINGS = Array.from({ length: 4 }, (_, index) => index);
const LYRICS_DISPLAY_STYLE_OPTIONS: Array<{ value: LyricsDisplayStyle; labelKey: TKey }> = [
  { value: "immersive", labelKey: "lyricsDisplayImmersive" },
  { value: "folia-monet", labelKey: "lyricsDisplayFoliaMonet" },
  { value: "folia-fume", labelKey: "lyricsDisplayFoliaFume" },
  { value: "folia-tilt", labelKey: "lyricsDisplayFoliaTilt" },
  { value: "folia-cadenza", labelKey: "lyricsDisplayFoliaCadenza" },
  { value: "classic", labelKey: "lyricsDisplayClassic" },
];
const INTERFACE_MODE_KEY = "lark.interface-mode";
const TERMINAL_SHELL_THEME_KEY = "lark.shell-theme";

type SleepTimerMode = "off" | "time" | "songs" | "album";
type InterfaceMode = "standard" | "shell";
type AlbumBrowseQuery = {
  page: number;
  limit: number;
  artistID: number;
  artistName: string;
  favoritesOnly: boolean;
};
type ArtistBrowseQuery = {
  page: number;
  limit: number;
  initial: string;
  favoritesOnly: boolean;
};
type FavoriteOverride = {
  favorite: boolean;
  mutationEpoch: number;
};
type BrowseCommit<Query, Page> = {
  query: Query;
  data: Page;
};

function sameAlbumBrowseQuery(left: AlbumBrowseQuery, right: AlbumBrowseQuery) {
  return left.page === right.page &&
    left.limit === right.limit &&
    left.artistID === right.artistID &&
    left.favoritesOnly === right.favoritesOnly;
}

function sameArtistBrowseQuery(left: ArtistBrowseQuery, right: ArtistBrowseQuery) {
  return left.page === right.page &&
    left.limit === right.limit &&
    left.initial === right.initial &&
    left.favoritesOnly === right.favoritesOnly;
}

const defaultSettings: Settings = {
  language: "zh-CN",
  theme: "deep-space",
  sleep_timer_mins: 0,
  library_path: "",
  netease_fallback: true,
  registration_enabled: false,
  diagnostics_enabled: false,
  playback_source_ttl_hours: 24,
  playback_history_retention_days: 0,
  web_font_url: "",
  web_font_family: "",
  lyrics_auto_save_to_song_dir: false,
  lyrics_font_family: "",
  lyrics_font_url: "",
  lyrics_font_size: 0,
  metadata_grouping: false,
  library_tag_writeback: false,
  library_path_metadata_assist: false,
  smart_playlists_enabled: false,
  sharing_enabled: false,
  subsonic_server_enabled: false,
  dlna_cast_enabled: false,
  dlna_library_enabled: false,
  dlna_server_name: "Lark",
  dlna_media_base_url: "",
  dlna_allowed_ips: "",
  dlna_interfaces: "",
  no_dlna_option: false,
  transcode_policy: "auto",
  transcode_quality_kbps: 192,
};

const TRANSCODE_QUALITY_PRESETS = [
  { value: 96, labelKey: "bitratePreset96", hintKey: "bitratePreset96Hint" },
  { value: 128, labelKey: "bitratePreset128", hintKey: "bitratePreset128Hint" },
  { value: 192, labelKey: "bitratePreset192", hintKey: "bitratePreset192Hint" },
  { value: 256, labelKey: "bitratePreset256", hintKey: "bitratePreset256Hint" },
  { value: 320, labelKey: "bitratePreset320", hintKey: "bitratePreset320Hint" },
] as const;

function normalizeLibraryTab(value?: string | null): LibraryTab {
  return value === "folders" || value === "network" || value === "radio" || value === "offline" || value === "manage" || value === "songs"
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

function offlineUser(): User {
  const now = new Date(0).toISOString();
  return {
    id: -1,
    username: "offline",
    nickname: "Offline",
    avatar_data_url: "",
    role: "user",
    created_at: now,
    updated_at: now,
  };
}

function normalizeHomePlayerStyle(value?: string | null): HomePlayerStyle {
  if (value === "smartisan-turntable" || value === "smartisan" || value === "smartisan-classic") return "smartisan-turntable";
  return value === "cassette" ||
    value === "ipod" ||
    value === "audio-scope" ||
    value === "album-slide" ||
    value === "gramophone" ||
    value === "running-kitten" ||
    value === "mineradio-stage" ||
    value === "walkman" ||
    value === "singularity"
    ? value
    : "vinyl";
}

function storedHomePlayerStyle(): HomePlayerStyle {
  try {
    return normalizeHomePlayerStyle(window.localStorage.getItem(HOME_PLAYER_STYLE_KEY));
  } catch {
    return "vinyl";
  }
}

function rememberHomePlayerStyle(style: HomePlayerStyle) {
  try {
    window.localStorage.setItem(HOME_PLAYER_STYLE_KEY, style);
  } catch {
    // localStorage can be unavailable in private/webview modes; vinyl remains default.
  }
}

function storedMineradioStageEnabled() {
  try {
    return window.localStorage.getItem(MINERADIO_STAGE_ENABLED_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberMineradioStageEnabled(enabled: boolean) {
  try {
    window.localStorage.setItem(MINERADIO_STAGE_ENABLED_KEY, enabled ? "1" : "0");
  } catch {
    // localStorage can be unavailable in private/webview modes; the saved user preference remains authoritative.
  }
}

function normalizeMobileHomePlayerStyle(value?: string | null): MobileHomePlayerStyle {
  return value === "indiewave" ||
    value === "editorial-pulse" ||
    value === "soft-vinyl" ||
    value === "gramophone" ||
    value === "stage-glass" ||
    value === "blue-halo" ||
    value === "smartisan-classic"
    ? value
    : "neon-console";
}

function storedMobileHomePlayerStyle(): MobileHomePlayerStyle {
  try {
    return normalizeMobileHomePlayerStyle(window.localStorage.getItem(MOBILE_HOME_PLAYER_STYLE_KEY));
  } catch {
    return "neon-console";
  }
}

function rememberMobileHomePlayerStyle(style: MobileHomePlayerStyle) {
  try {
    window.localStorage.setItem(MOBILE_HOME_PLAYER_STYLE_KEY, style);
  } catch {
    // localStorage can be unavailable in private/webview modes; neon console remains default.
  }
}

function normalizeArtistAlbumDisplayStyle(value?: string | null): ArtistAlbumDisplayStyle {
  return value === "showcase" ? "showcase" : "classic";
}

function normalizeLyricsDisplayStyle(value?: string | null): LyricsDisplayStyle {
  switch (value) {
    case "classic":
    case "folia-monet":
    case "folia-fume":
    case "folia-tilt":
    case "folia-cadenza":
      return value;
    default:
      return "immersive";
  }
}

function normalizeTerminalShellTheme(value?: string | null): TerminalShellTheme {
  return value === "dusk" || value === "phosphor" || value === "ashgray" || value === "embers" ? value : "operator";
}

function normalizeLyricOffsetMs(value?: number | null) {
  const numeric = Math.round(Number(value) || 0);
  return Math.max(-MAX_LYRIC_OFFSET_MS, Math.min(MAX_LYRIC_OFFSET_MS, numeric));
}

function motionSeed(index: number, salt: number) {
  return Math.sin((index + 1) * 127.1 + salt * 311.7) * 0.5 + 0.5;
}

function normalizeUserPreferences(value?: Partial<UserPreferences> | null): UserPreferences {
  return {
    home_player_style: normalizeHomePlayerStyle(value?.home_player_style),
    mobile_home_player_style: normalizeMobileHomePlayerStyle(value?.mobile_home_player_style),
    mineradio_stage_enabled: value?.mineradio_stage_enabled ?? false,
    artist_album_display_style: normalizeArtistAlbumDisplayStyle(value?.artist_album_display_style),
    lyrics_display_style: normalizeLyricsDisplayStyle(value?.lyrics_display_style),
    lyrics_drag_seek_enabled: value?.lyrics_drag_seek_enabled ?? true,
    terminal_shell_theme: normalizeTerminalShellTheme(value?.terminal_shell_theme),
  };
}

function sameUserPreferences(left: UserPreferences | null, right: UserPreferences) {
  if (!left) return false;
  return left.home_player_style === right.home_player_style &&
    left.mobile_home_player_style === right.mobile_home_player_style &&
    left.mineradio_stage_enabled === right.mineradio_stage_enabled &&
    left.artist_album_display_style === right.artist_album_display_style &&
    left.lyrics_display_style === right.lyrics_display_style &&
    left.lyrics_drag_seek_enabled === right.lyrics_drag_seek_enabled &&
    left.terminal_shell_theme === right.terminal_shell_theme;
}

function storedTerminalShellTheme(): TerminalShellTheme {
  try {
    return normalizeTerminalShellTheme(window.localStorage.getItem(TERMINAL_SHELL_THEME_KEY));
  } catch {
    return "operator";
  }
}

function rememberTerminalShellTheme(theme: TerminalShellTheme) {
  try {
    window.localStorage.setItem(TERMINAL_SHELL_THEME_KEY, theme);
  } catch {
    // localStorage can be unavailable in private/webview modes; operator remains default.
  }
}

function artistAlbumDisplayStyleKey(user?: User | null) {
  return user ? `${ARTIST_ALBUM_DISPLAY_STYLE_KEY}.${user.id}` : ARTIST_ALBUM_DISPLAY_STYLE_KEY;
}

function storedArtistAlbumDisplayStyle(user?: User | null): ArtistAlbumDisplayStyle {
  try {
    return normalizeArtistAlbumDisplayStyle(window.localStorage.getItem(artistAlbumDisplayStyleKey(user)));
  } catch {
    return "classic";
  }
}

function rememberArtistAlbumDisplayStyle(style: ArtistAlbumDisplayStyle, user?: User | null) {
  try {
    window.localStorage.setItem(artistAlbumDisplayStyleKey(user), style);
  } catch {
    // localStorage can be unavailable in private/webview modes; classic remains default.
  }
}

function rememberLibraryTab(tab: LibraryTab) {
  try {
    window.localStorage.setItem(LIBRARY_SOURCE_TAB_KEY, tab);
  } catch {
    // localStorage can be unavailable in private/webview modes; local source remains default.
  }
}

function storedAutoCachePlayedEnabled() {
  try {
    return window.localStorage.getItem(AUTO_CACHE_PLAYED_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberAutoCachePlayedEnabled(enabled: boolean) {
  try {
    if (enabled) window.localStorage.setItem(AUTO_CACHE_PLAYED_KEY, "1");
    else window.localStorage.removeItem(AUTO_CACHE_PLAYED_KEY);
  } catch {
    // localStorage can be unavailable in private/webview modes.
  }
}

function storedPersistentQueueEnabled() {
  try {
    return window.localStorage.getItem(PERSISTENT_QUEUE_KEY) === "true";
  } catch {
    return false;
  }
}

function rememberPersistentQueueEnabled(enabled: boolean) {
  try {
    window.localStorage.setItem(PERSISTENT_QUEUE_KEY, enabled ? "true" : "false");
  } catch {
    // localStorage can be unavailable in private/webview modes.
  }
}

function storedInterfaceMode(): InterfaceMode {
  try {
    return window.localStorage.getItem(INTERFACE_MODE_KEY) === "shell" ? "shell" : "standard";
  } catch {
    return "standard";
  }
}

function rememberInterfaceMode(mode: InterfaceMode) {
  try {
    window.localStorage.setItem(INTERFACE_MODE_KEY, mode);
  } catch {
    // localStorage can be unavailable in private/webview modes; standard remains default.
  }
}

function currentBrowserRoute() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function publicShareTokenFromRoute(route = currentBrowserRoute()) {
  const path = route.split(/[?#]/, 1)[0];
  if (!path.startsWith("/share/")) return "";
  return decodeURIComponent(path.slice("/share/".length).replace(/\/+$/, ""));
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

function resumePreferenceKey(user?: User | null) {
  return `lark.resume-mode.${user?.id ?? "guest"}`;
}

function storedResumeMode(user?: User | null): ResumeMode {
  return window.localStorage.getItem(resumePreferenceKey(user)) === "restart"
    ? "restart"
    : "resume";
}

function prefersLowMemoryVisuals() {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return Boolean(nav.deviceMemory && nav.deviceMemory <= 4);
}

const QUALITY_CLASS = "song-quality";

function mergeArtists(current: Artist[], incoming: Artist[]) {
  if (!incoming.length) return current;
  const byID = new Map(current.map((item) => [item.id, item]));
  incoming.forEach((item) => byID.set(item.id, item));
  return Array.from(byID.values());
}

function FavoriteFilterToggle({
  active,
  count,
  t,
  onToggle,
}: {
  active: boolean;
  count?: number;
  t: ReturnType<typeof createT>;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="favorite-filter-toggle"
      data-active={active ? "true" : "false"}
      aria-pressed={active}
      aria-busy={active && count == null}
      onClick={onToggle}
    >
      <Heart weight={active ? "fill" : "regular"} aria-hidden="true" />
      <span>{t("favoritesOnly")}</span>
      {active ? <small aria-hidden={count == null}>{count ?? "…"}</small> : null}
    </button>
  );
}

function AlbumArtistFilter({
  t,
  selectedArtistId,
  selectedArtistName,
  onSelect,
  onClear,
}: {
  t: ReturnType<typeof createT>;
  selectedArtistId: number;
  selectedArtistName: string;
  onSelect: (artist: Artist) => void;
  onClear: () => void;
}) {
  const [draft, setDraft] = useState(selectedArtistName);
  const [suggestions, setSuggestions] = useState<Artist[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [composing, setComposing] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const trimmedDraft = draft.trim();

  useEffect(() => {
    setDraft(selectedArtistName);
    setSuggestions([]);
    setOpen(false);
    setActiveIndex(0);
  }, [selectedArtistId, selectedArtistName]);

  useEffect(() => {
    if (!open || composing || trimmedDraft.length < 1) {
      setSuggestions([]);
      setLoading(false);
      return;
    }

    let alive = true;
    setLoading(true);
    const timer = window.setTimeout(() => {
      api.searchArtists(trimmedDraft, 20)
        .then((items) => {
          if (!alive) return;
          const nextSuggestions = items.filter((item) => item.album_count > 0);
          setSuggestions(nextSuggestions);
          setActiveIndex(0);
        })
        .catch(() => {
          if (alive) setSuggestions([]);
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    }, 150);

    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [composing, open, trimmedDraft]);

  function selectSuggestion(artistItem: Artist) {
    setDraft(artistItem.name);
    setOpen(false);
    setSuggestions([]);
    onSelect(artistItem);
  }

  function clearFilter() {
    setDraft("");
    setOpen(false);
    setSuggestions([]);
    setActiveIndex(0);
    onClear();
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  return (
    <div className="artist-filter-combobox">
      <label>
        <span>{t("filterByArtist")}</span>
        <div className={selectedArtistId > 0 ? "is-selected" : undefined}>
          <MagnifyingGlass aria-hidden="true" />
          <input
            ref={inputRef}
            value={draft}
            placeholder={t("searchArtist")}
            role="combobox"
            aria-autocomplete="list"
            aria-haspopup="listbox"
            aria-label={t("filterByArtist")}
            aria-expanded={open && trimmedDraft.length > 0}
            aria-controls={open && trimmedDraft ? "album-artist-filter-options" : undefined}
            aria-activedescendant={
              open && !loading && suggestions[activeIndex]
                ? `album-artist-filter-option-${suggestions[activeIndex].id}`
                : undefined
            }
            autoComplete="off"
            onFocus={() => {
              if (trimmedDraft) setOpen(true);
            }}
            onChange={(event) => {
              setDraft(event.target.value);
              setOpen(true);
            }}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={(event) => {
              setComposing(false);
              setDraft(event.currentTarget.value);
              if (event.currentTarget.value.trim()) setOpen(true);
            }}
            onKeyDown={(event) => {
              const nativeEvent = event.nativeEvent as KeyboardEvent;
              if (nativeEvent.isComposing) return;
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setOpen(true);
                setActiveIndex((index) => Math.min(index + 1, Math.max(0, suggestions.length - 1)));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((index) => Math.max(0, index - 1));
              } else if (event.key === "Enter" && open && suggestions[activeIndex]) {
                event.preventDefault();
                selectSuggestion(suggestions[activeIndex]);
              } else if (event.key === "Escape") {
                setOpen(false);
              }
            }}
          />
          {draft ? (
            <button
              type="button"
              className="artist-filter-clear"
              onClick={clearFilter}
              aria-label={t("clearFilter")}
            >
              <X />
            </button>
          ) : null}
        </div>
      </label>
      {open && trimmedDraft ? (
        <div
          id="album-artist-filter-options"
          className="artist-filter-options"
          role="listbox"
          onMouseDown={(event) => event.preventDefault()}
        >
          {loading ? (
            <span>{t("loading")}</span>
          ) : suggestions.length ? (
            suggestions.map((artistItem, index) => (
              <button
                type="button"
                key={artistItem.id}
                id={`album-artist-filter-option-${artistItem.id}`}
                className={artistItem.id === selectedArtistId || index === activeIndex ? "active" : ""}
                role="option"
                aria-selected={artistItem.id === selectedArtistId}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => selectSuggestion(artistItem)}
              >
                <strong>{artistItem.name}</strong>
                <small>
                  {artistItem.album_count} {t("album")} · {artistItem.song_count} {t("count")}
                </small>
              </button>
            ))
          ) : (
            <span>{t("noResults")}</span>
          )}
        </div>
      ) : null}
    </div>
  );
}

function SongSearchBox({
  t,
  value,
  onSearch,
}: {
  t: ReturnType<typeof createT>;
  value: string;
  onSearch: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [suggestions, setSuggestions] = useState<Song[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [composing, setComposing] = useState(false);
  const trimmedDraft = draft.trim();
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setDraft(value);
    setSuggestions([]);
    setOpen(false);
    setActiveIndex(0);
  }, [value]);

  useEffect(() => {
    if (!open || composing || trimmedDraft.length < 1) {
      setSuggestions([]);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    const timer = window.setTimeout(() => {
      api.songs(trimmedDraft, 8)
        .then((items) => {
          if (!alive) return;
          setSuggestions(items);
          setActiveIndex(0);
        })
        .catch(() => {
          if (alive) setSuggestions([]);
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    }, 150);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [composing, open, trimmedDraft]);

  function commit(nextValue = draft) {
    const next = nextValue.trim();
    setDraft(next);
    setOpen(false);
    onSearch(next);
  }

  function selectSuggestion(song: Song) {
    commit(song.title);
  }

  function clearSearch() {
    setDraft("");
    setSuggestions([]);
    setOpen(false);
    onSearch("");
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  return (
    <div className="song-search-combobox">
      <label className="search">
        <MagnifyingGlass />
        <input
          ref={inputRef}
          value={draft}
          placeholder={t("search")}
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-label={t("search")}
          aria-expanded={open && trimmedDraft.length > 0}
          aria-controls={open && trimmedDraft ? "song-search-options" : undefined}
          aria-activedescendant={open && !loading && suggestions[activeIndex] ? `song-search-option-${suggestions[activeIndex].id}` : undefined}
          onFocus={() => {
            if (trimmedDraft) setOpen(true);
          }}
          onChange={(event) => {
            setDraft(event.target.value);
            setOpen(true);
          }}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={(event) => {
            setComposing(false);
            setDraft(event.currentTarget.value);
            if (event.currentTarget.value.trim()) setOpen(true);
          }}
          onKeyDown={(event) => {
            const nativeEvent = event.nativeEvent as KeyboardEvent;
            if (nativeEvent.isComposing) return;
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setOpen(true);
              setActiveIndex((index) => Math.min(index + 1, Math.max(0, suggestions.length - 1)));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((index) => Math.max(0, index - 1));
            } else if (event.key === "Enter") {
              event.preventDefault();
              if (open && suggestions[activeIndex]) selectSuggestion(suggestions[activeIndex]);
              else commit();
            } else if (event.key === "Escape") {
              setOpen(false);
            }
          }}
        />
        {draft ? (
          <button type="button" className="search-clear-button" onClick={clearSearch} aria-label={t("clearFilter")}>
            <X />
          </button>
        ) : null}
      </label>
      {open && trimmedDraft ? (
        <div
          id="song-search-options"
          className="song-search-options"
          role="listbox"
          onMouseDown={(event) => event.preventDefault()}
        >
          {loading ? (
            <span>{t("loading")}</span>
          ) : suggestions.length ? (
            suggestions.map((song, index) => (
              <button
                type="button"
                key={song.id}
                id={`song-search-option-${song.id}`}
                className={index === activeIndex ? "active" : ""}
                role="option"
                aria-selected={index === activeIndex}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => selectSuggestion(song)}
              >
                <strong>{song.title}</strong>
                <small>{[song.artist, song.album, formatDuration(song.duration_seconds)].filter(Boolean).join(" · ")}</small>
              </button>
            ))
          ) : (
            <span>{t("noResults")}</span>
          )}
        </div>
      ) : null}
    </div>
  );
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  const [offlineMode, setOfflineMode] = useState(false);
  const [networkReachable, setNetworkReachable] = useState(() => navigator.onLine);
  const [offlineIndex, setOfflineIndex] = useState<OfflineSongIndex>(() => readOfflineSongIndex());
  const [offlineCachingIds, setOfflineCachingIds] = useState<Set<number>>(() => new Set());
  const [offlineUsage, setOfflineUsage] = useState<OfflineCacheUsage>(emptyOfflineUsage);
  const [offlineClearing, setOfflineClearing] = useState(false);
  const [offlineRemovingKeys, setOfflineRemovingKeys] = useState<Set<string>>(() => new Set());
  const [autoCachePlayed, setAutoCachePlayed] = useState(storedAutoCachePlayedEnabled);
  const [route, setRoute] = useState(() => currentBrowserRoute());
  const [songs, setSongs] = useState<Song[]>([]);
  const [recentPlayedSongs, setRecentPlayedSongs] = useState<Song[]>([]);
  const [historyEntries, setHistoryEntries] = useState<PlaybackHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [recentAddedSongs, setRecentAddedSongs] = useState<Song[]>([]);
  const [dailyMix, setDailyMix] = useState<Song[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [libraryDirectories, setLibraryDirectories] = useState<LibraryDirectory[]>([]);
  const [libraryStats, setLibraryStats] = useState<LibraryStats | null>(null);
  const [favoriteSongs, setFavoriteSongs] = useState<Song[]>([]);
  const [favoriteAlbums, setFavoriteAlbums] = useState<Album[]>([]);
  const [favoriteArtists, setFavoriteArtists] = useState<Artist[]>([]);
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
  const [smartPlaylists, setSmartPlaylists] = useState<SmartPlaylist[]>([]);
  const [queue, setQueue] = useState<Song[]>([]);
  const playbackSessionSourceRef = useRef<PlaybackSourceInput | null>(null);
  const [collection, setCollection] = useState<Collection | null>(null);
  const [collectionBack, setCollectionBack] = useState<Collection | null>(null);
  const [current, setCurrent] = useState<Song | null>(null);
  const [playing, setPlaying] = useState(false);
  const [dlnaStatus, setDLNAStatus] = useState<DLNAStatus | null>(null);
  const [dlnaDevices, setDLNADevices] = useState<DLNADevice[]>([]);
  const [dlnaPanelOpen, setDLNAPanelOpen] = useState(false);
  const [dlnaLoading, setDLNALoading] = useState(false);
  const [dlnaError, setDLNAError] = useState("");
  const dlnaPlaybackCommandRef = useRef<Promise<void>>(Promise.resolve());
  const dlnaPlaybackPendingRef = useRef(0);
  const dlnaPlaybackDesiredStateRef = useRef<"playing" | "paused" | null>(null);
  const playbackOutputPlanRef = useRef<{
    output: "local" | "dlna";
    deviceID?: string;
    state: "playing" | "paused";
  }>({ output: "local", state: "paused" });
  const [playMode, setPlayMode] = useState<PlayMode>("sequence");
  const [view, setView] = useState<View>("home");
  const [interfaceMode, setInterfaceMode] = useState<InterfaceMode>(storedInterfaceMode);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("account");
  const [query, setQuery] = useState("");
  const [albumArtistFilter, setAlbumArtistFilter] = useState(0);
  const [albumArtistQuery, setAlbumArtistQuery] = useState("");
  const [albumFavoritesOnly, setAlbumFavoritesOnly] = useState(false);
  const [artistInitialFilter, setArtistInitialFilter] = useState("");
  const [artistFavoritesOnly, setArtistFavoritesOnly] = useState(false);
  const [lyrics, setLyrics] = useState<Lyrics | null>(null);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [lyricCandidates, setLyricCandidates] = useState<LyricCandidate[]>([]);
  const [lyricCandidatesOpen, setLyricCandidatesOpen] = useState(false);
  const [lyricCandidatesLoading, setLyricCandidatesLoading] = useState(false);
  const [lyricOffsetMs, setLyricOffsetMs] = useState(0);
  const [lyricsFullScreen, setLyricsFullScreen] = useState(false);
  const [metadataEditorTarget, setMetadataEditorTarget] = useState<MetadataEditorTarget | null>(null);
  const [queueOpen, setQueueOpen] = useState(false);
  const [mobilePlayerExpanded, setMobilePlayerExpanded] = useState(false);
  const mainRef = useRef<HTMLElement | null>(null);
  const [pageSizing, setPageSizing] = useState<PageSizing>({
    songs: DEFAULT_LIBRARY_PAGE_SIZE,
    cards: DEFAULT_GRID_PAGE_SIZE,
  });
  const gridPageSizeRef = useRef(DEFAULT_GRID_PAGE_SIZE);
  const [message, setMessage] = useState("");
  const [librarySongPage, setLibrarySongPage] = useState<SongPage | null>(null);
  const [libraryPage, setLibraryPage] = useState(1);
  const [libraryPageLoading, setLibraryPageLoading] = useState(false);
  const [librarySort, setLibrarySort] = useState<SongSort>("added_desc");
  const [libraryReview, setLibraryReview] = useState<SongReview>("");
  const [libraryReviewSummary, setLibraryReviewSummary] = useState<LibraryReviewSummary | null>(null);
  const [albumPageData, setAlbumPageData] = useState<AlbumPage | null>(null);
  const [, setAlbumPage] = useState(1);
  const [albumPageLoading, setAlbumPageLoading] = useState(false);
  const [shellAlbumPageData, setShellAlbumPageData] = useState<AlbumPage | null>(null);
  const [shellAlbumPageLoading, setShellAlbumPageLoading] = useState(false);
  const shellAlbumPageRequestRef = useRef(0);
  const albumPageRequestRef = useRef(0);
  const albumPageInFlightRef = useRef<number | null>(null);
  const albumArtistFilterRef = useRef(0);
  const albumArtistQueryRef = useRef("");
  const albumFavoritesOnlyRef = useRef(false);
  const albumBrowseIntentRef = useRef<AlbumBrowseQuery>({
    page: 1,
    limit: DEFAULT_GRID_PAGE_SIZE,
    artistID: 0,
    artistName: "",
    favoritesOnly: false,
  });
  const albumBrowseCommittedRef = useRef<BrowseCommit<AlbumBrowseQuery, AlbumPage> | null>(null);
  const albumFavoriteMutationRef = useRef(0);
  const albumFavoriteStateRef = useRef(new Map<number, FavoriteOverride>());
  const favoriteSessionRef = useRef(0);
  const albumFavoriteQueueRef = useRef(new Map<number, Promise<Album | null>>());
  const albumFavoriteRepeatRef = useRef(new Set<number>());
  const [artistPageData, setArtistPageData] = useState<ArtistPage | null>(null);
  const [, setArtistPage] = useState(1);
  const [artistPageLoading, setArtistPageLoading] = useState(false);
  const artistPageRequestRef = useRef(0);
  const artistPageInFlightRef = useRef<number | null>(null);
  const artistInitialFilterRef = useRef("");
  const artistFavoritesOnlyRef = useRef(false);
  const artistBrowseIntentRef = useRef<ArtistBrowseQuery>({
    page: 1,
    limit: DEFAULT_GRID_PAGE_SIZE,
    initial: "",
    favoritesOnly: false,
  });
  const artistBrowseCommittedRef = useRef<BrowseCommit<ArtistBrowseQuery, ArtistPage> | null>(null);
  const artistFavoriteMutationRef = useRef(0);
  const artistFavoriteStateRef = useRef(new Map<number, FavoriteOverride>());
  const artistFavoriteQueueRef = useRef(new Map<number, Promise<Artist | null>>());
  const artistFavoriteRepeatRef = useRef(new Set<number>());
  const [playlistPageData, setPlaylistPageData] = useState<PlaylistPage | null>(null);
  const [playlistPage, setPlaylistPage] = useState(1);
  const [playlistPageLoading, setPlaylistPageLoading] = useState(false);
  const [playlistDialogOpen, setPlaylistDialogOpen] = useState(false);
  const [playlistSubmitting, setPlaylistSubmitting] = useState(false);
  const [playlistPickerSong, setPlaylistPickerSong] = useState<Song | null>(null);
  const [playlistPendingSong, setPlaylistPendingSong] = useState<Song | null>(null);
  const [shareDialogTarget, setShareDialogTarget] = useState<ShareTarget | null>(null);
  const [scanStatus, setScanStatus] = useState<ScanStatus | null>(null);
  const [sleepTimerOpen, setSleepTimerOpen] = useState(false);
  const [sleepTimerMode, setSleepTimerMode] = useState<SleepTimerMode>("off");
  const [sleepTimerMins, setSleepTimerMins] = useState(0);
  const [sleepLeft, setSleepLeft] = useState(0);
  const [sleepSongsLeft, setSleepSongsLeft] = useState(0);
  const [sleepAlbumId, setSleepAlbumId] = useState(0);
  const [sleepAlbumTitle, setSleepAlbumTitle] = useState("");
  const [resumeMode, setResumeMode] = useState<ResumeMode>("resume");
  const [homePlayerStyle, setHomePlayerStyle] = useState<HomePlayerStyle>(storedHomePlayerStyle);
  const [mobileHomePlayerStyle, setMobileHomePlayerStyle] = useState<MobileHomePlayerStyle>(storedMobileHomePlayerStyle);
  const [mineradioStageEnabled, setMineradioStageEnabled] = useState(storedMineradioStageEnabled);
  const [artistAlbumDisplayStyle, setArtistAlbumDisplayStyle] = useState<ArtistAlbumDisplayStyle>(() => storedArtistAlbumDisplayStyle());
  const [lyricsDisplayStyle, setLyricsDisplayStyle] = useState<LyricsDisplayStyle>("immersive");
  const [lyricsDragSeekEnabled, setLyricsDragSeekEnabled] = useState(true);
  const [terminalShellTheme, setTerminalShellTheme] = useState<TerminalShellTheme>(storedTerminalShellTheme);
  const userPreferencesReadyRef = useRef(false);
  const lastSavedUserPreferencesRef = useRef<UserPreferences | null>(null);
  const userPreferencesSaveTimerRef = useRef<number | null>(null);
  const [persistentQueueEnabled, setPersistentQueueEnabled] = useState(storedPersistentQueueEnabled);
  const [queueSyncReady, setQueueSyncReady] = useState(false);
  const [scrobblingSettings, setScrobblingSettings] = useState<ScrobblingSettings | null>(null);
  const [uiSoundSettings, setUISoundSettingsState] = useState<UISoundSettings>({ enabled: false, volume: 0.85 });
  const [playbackHistorySettings, setPlaybackHistorySettings] = useState<PlaybackHistorySettings>({ separate_by_device: false });
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [buffering, setBuffering] = useState(false);
  const [radioDownloadKbps, setRadioDownloadKbps] = useState(0);
  const mobileViewport = useMediaQuery(
    "(max-width: 720px), (max-width: 960px) and (max-height: 500px) and (orientation: landscape)",
  );
  useScrollRestore(mainRef, view, mobileViewport);
  useKeyboardAware(mobileViewport);
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
  const toggleQueuePanel = useCallback(() => {
    setEqPanelOpen(false);
    setQueueOpen((value) => !value);
  }, []);
  const toggleEqualizerPanel = useCallback(() => {
    setQueueOpen(false);
    setEqPanelOpen((value) => !value);
  }, []);
  const lyricsScrollRef = useRef<HTMLDivElement | null>(null);
  const lyricFollowPausedUntil = useRef(0);
  const messageTimerRef = useRef<number | null>(null);
  const refreshGenerationRef = useRef(0);
  const resumeSeekRef = useRef(0);
  const progressRef = useRef(0);
  const lastProgressPaintRef = useRef(0);
  const radioDownloadSampleRef = useRef({ at: 0, ahead: 0 });
  const durationRef = useRef(0);
  const collectionRequestRef = useRef(0);
  const collectionAbortRef = useRef<AbortController | null>(null);
  const recentPlayedRefreshRef = useRef(0);
  const lastProgressSyncRef = useRef({ songId: 0, at: 0, progress: 0 });
  const pendingAutoplayRef = useRef(false);
  const stallDowngradeTimerRef = useRef<number | null>(null);
  const currentRef = useRef<Song | null>(null);
  const currentRadioRef = useRef<RadioStation | null>(null);
  const currentNetworkTrackRef = useRef<NetworkTrack | null>(null);
  const queueRef = useRef<Song[]>([]);
  const playModeRef = useRef<PlayMode>("sequence");
  const playingRef = useRef(false);
  const sleepTimerModeRef = useRef<SleepTimerMode>("off");
  const sleepSongsLeftRef = useRef(0);
  const sleepAlbumIdRef = useRef(0);
  const streamModeRef = useRef<StreamMode>(streamMode);
  const streamOffsetRef = useRef(0);
  const resumeModeRef = useRef<ResumeMode>(resumeMode);
  const offlineModeRef = useRef(false);
  const networkReachableRef = useRef(networkReachable);
  const autoCachePlayedRef = useRef(autoCachePlayed);
  const autoCacheTriggeredRef = useRef<Set<number>>(new Set());
  const offlineReconnectRef = useRef(false);
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
  sleepTimerModeRef.current = sleepTimerMode;
  sleepSongsLeftRef.current = sleepSongsLeft;
  sleepAlbumIdRef.current = sleepAlbumId;
  streamModeRef.current = streamMode;
  streamOffsetRef.current = streamOffset;
  resumeModeRef.current = resumeMode;
  offlineModeRef.current = offlineMode;
  networkReachableRef.current = networkReachable;
  autoCachePlayedRef.current = autoCachePlayed;
  const t = useMemo(() => createT(settings.language), [settings.language]);
  const dlnaOptionHidden = settings.no_dlna_option;
  const dlnaCastAvailable = settings.dlna_cast_enabled && !dlnaOptionHidden;
  const remoteDLNAActive = dlnaStatus?.output === "dlna" && Boolean(dlnaStatus.device_id);
  const remoteDLNAPlaying = remoteDLNAActive && dlnaStatus?.state === "playing";
  useEffect(() => {
    if (dlnaPlaybackPendingRef.current > 0) return;
    playbackOutputPlanRef.current = remoteDLNAActive && dlnaStatus?.device_id
      ? { output: "dlna", deviceID: dlnaStatus.device_id, state: remoteDLNAPlaying ? "playing" : "paused" }
      : { output: "local", state: playing ? "playing" : "paused" };
    dlnaPlaybackDesiredStateRef.current = remoteDLNAPlaying ? "playing" : remoteDLNAActive ? "paused" : null;
  }, [dlnaStatus?.device_id, playing, remoteDLNAActive, remoteDLNAPlaying]);
  const offlineCachedIds = useMemo(() => offlineCachedSongIds(offlineIndex), [offlineIndex]);
  const offlineEntries = useMemo(() => offlineSongEntries(offlineIndex), [offlineIndex]);
  const libraryPageSize = pageSizing.songs;
  const gridPageSize = pageSizing.cards;
  gridPageSizeRef.current = gridPageSize;
  const lyricLines = useMemo(() => parseLyricLines(lyrics?.lyrics), [lyrics]);
  const lyricOffsetSeconds = lyricOffsetMs / 1000;
  const activeLyric = useMemo(() => {
    let activeIndex = -1;
    for (let i = 0; i < lyricLines.length; i += 1) {
      const adjustedAt = adjustedLyricTime(lyricLines[i], lyricOffsetSeconds);
      if (lyricLines[i].at >= 0 && adjustedAt <= progress + 0.08)
        activeIndex = i;
      if (adjustedAt > progress + 0.08) break;
    }
    if (activeIndex < 0) return "";
    const activeGroup = lyricLines[activeIndex].groupKey;
    while (
      activeIndex > 0 &&
      lyricLines[activeIndex - 1].groupKey === activeGroup
    )
      activeIndex -= 1;
    return lyricLines[activeIndex].key;
  }, [lyricLines, lyricOffsetSeconds, progress]);
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
    resumeAudioContext(audioContextRef.current);
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
    const reloadForSessionChange = () => window.location.reload();
    window.addEventListener(SESSION_CHANGED_EVENT, reloadForSessionChange);
    return () => window.removeEventListener(SESSION_CHANGED_EVENT, reloadForSessionChange);
  }, []);

  useEffect(() => {
    if (view !== "library" || offlineMode) return;
    void api.libraryReviewSummary().then(setLibraryReviewSummary).catch(() => setLibraryReviewSummary(null));
  }, [view, offlineMode, librarySongPage?.total]);

  useEffect(() => {
    const updateNetworkState = () => setNetworkReachable(navigator.onLine);
    updateNetworkState();
    const timer = window.setInterval(updateNetworkState, 3000);
    window.addEventListener("online", updateNetworkState);
    window.addEventListener("offline", updateNetworkState);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", updateNetworkState);
      window.removeEventListener("offline", updateNetworkState);
    };
  }, []);

  useEffect(() => {
    if (!offlineMode) return;
    let canceled = false;
    const tryReconnect = () => {
      if (canceled || !navigator.onLine || offlineReconnectRef.current) return;
      offlineReconnectRef.current = true;
      void bootstrap().finally(() => {
        offlineReconnectRef.current = false;
      });
    };
    tryReconnect();
    const timer = window.setInterval(tryReconnect, 5000);
    return () => {
      canceled = true;
      window.clearInterval(timer);
    };
  }, [offlineMode]);

  useEffect(() => {
    void refreshOfflineCacheUsage();
  }, []);

  useEffect(() => {
    setUISoundSettings(uiSoundSettings);
  }, [uiSoundSettings]);

  useEffect(() => {
    const syncRoute = () => setRoute(currentBrowserRoute());
    window.addEventListener("popstate", syncRoute);
    return () => window.removeEventListener("popstate", syncRoute);
  }, []);

  useEffect(() => {
    if (authLoading) return;
    const routePath = window.location.pathname;
    if (routePath.startsWith("/share/")) return;
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
    if (!auth?.user || !queueSyncReady || !current) return;
    const ids = queue.map((song) => song.id).filter((id) => Number.isInteger(id)).slice(0, MAX_PLAYBACK_QUEUE_SIZE);
    if (!ids.length) return;
    void api.savePlaybackQueue(ids, current.id, playbackSessionSourceRef.current).catch(() => undefined);
  }, [auth?.user?.id, queueSyncReady, queue, current?.id]);

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
    rememberHomePlayerStyle(homePlayerStyle);
  }, [homePlayerStyle]);

  useEffect(() => {
    rememberMobileHomePlayerStyle(mobileHomePlayerStyle);
  }, [mobileHomePlayerStyle]);

  useEffect(() => {
    rememberMineradioStageEnabled(mineradioStageEnabled);
  }, [mineradioStageEnabled]);

  useEffect(() => {
    rememberArtistAlbumDisplayStyle(artistAlbumDisplayStyle, auth?.user);
  }, [artistAlbumDisplayStyle, auth?.user?.id]);

  useEffect(() => {
    rememberTerminalShellTheme(terminalShellTheme);
  }, [terminalShellTheme]);

  useEffect(() => {
    if (!auth?.user || !userPreferencesReadyRef.current) return;
    const nextPreferences = normalizeUserPreferences({
      home_player_style: homePlayerStyle,
      mobile_home_player_style: mobileHomePlayerStyle,
      mineradio_stage_enabled: mineradioStageEnabled,
      artist_album_display_style: artistAlbumDisplayStyle,
      lyrics_display_style: lyricsDisplayStyle,
      lyrics_drag_seek_enabled: lyricsDragSeekEnabled,
      terminal_shell_theme: terminalShellTheme,
    });
    if (sameUserPreferences(lastSavedUserPreferencesRef.current, nextPreferences)) return;
    if (userPreferencesSaveTimerRef.current != null) {
      window.clearTimeout(userPreferencesSaveTimerRef.current);
    }
    userPreferencesSaveTimerRef.current = window.setTimeout(() => {
      userPreferencesSaveTimerRef.current = null;
      void api.saveUserPreferences(nextPreferences)
        .then((saved) => {
          lastSavedUserPreferencesRef.current = normalizeUserPreferences(saved);
        })
        .catch(() => undefined);
    }, 250);
  }, [artistAlbumDisplayStyle, auth?.user?.id, homePlayerStyle, lyricsDisplayStyle, lyricsDragSeekEnabled, mineradioStageEnabled, mobileHomePlayerStyle, terminalShellTheme]);

  useEffect(() => {
    return () => {
      if (userPreferencesSaveTimerRef.current != null) {
        window.clearTimeout(userPreferencesSaveTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!settings.sharing_enabled && view === "shares") setView("home");
  }, [settings.sharing_enabled, view]);

  useEffect(() => {
    if (!auth?.user) {
      setDLNAStatus(null);
      setDLNADevices([]);
      setDLNAError("");
      return;
    }
    if (!settings.dlna_cast_enabled) {
      setDLNADevices([]);
      setDLNAError("");
      setDLNAStatus((old) => old ? { ...old, cast_enabled: false, output: "local", state: "idle" } : old);
      return;
    }
    void api.dlnaStatus().then(setDLNAStatus).catch(() => undefined);
    void api.dlnaDevices().then(setDLNADevices).catch(() => undefined);
  }, [auth?.user?.id, settings.dlna_cast_enabled]);

  useEffect(() => {
    setHistoryLoaded(false);
    setHistoryEntries([]);
  }, [auth?.user?.id]);

  useEffect(() => {
    if (
      !shouldLoadPlaybackHistory({
        authenticated: Boolean(auth?.user),
        view,
        loaded: historyLoaded,
        loading: historyLoading,
      })
    ) {
      return;
    }
    void refreshPlaybackHistory();
  }, [auth?.user?.id, view, historyLoaded, historyLoading]);

  useEffect(() => {
    if (mobileViewport && !MOBILE_PLAYBACK_VIEWS.has(view)) {
      setView("home");
      setSettingsTab("account");
    }
  }, [mobileViewport, view]);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.lang = settings.language;
    document.title = `${t("brand")} Music`;
    window.requestAnimationFrame(() => syncLazycatChrome(settings.theme));
    const fontFamily = sanitizeFontFamily(settings.web_font_family);
    const fontURL = sanitizeUploadedFontURL(settings.web_font_url);
    const lyricsFontFamily = sanitizeFontFamily(settings.lyrics_font_family);
    const lyricsFontURL = sanitizeUploadedFontURL(settings.lyrics_font_url);
    const lyricsFontSize = normalizeLyricsFontSize(settings.lyrics_font_size);
    const fontStyleId = "lark-web-font";
    const lyricsFontStyleId = "lark-lyrics-font";
    const existing = document.getElementById(fontStyleId) as HTMLStyleElement | null;
    const existingLyricsFont = document.getElementById(lyricsFontStyleId) as HTMLStyleElement | null;
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
        "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI Variable Text', 'Segoe UI', system-ui, ui-sans-serif, Inter, Roboto, 'Helvetica Neue', Arial, var(--font-cjk)",
      );
    }
    if (lyricsFontFamily && lyricsFontURL) {
      const style = existingLyricsFont || document.createElement("style");
      style.id = lyricsFontStyleId;
      style.textContent = `@font-face{font-family:"${lyricsFontFamily}";src:url("${lyricsFontURL}") format("${fontFormat(lyricsFontURL)}");font-display:swap;}`;
      if (!existingLyricsFont) document.head.appendChild(style);
      document.documentElement.dataset.customLyricsFont = "true";
      document.documentElement.style.setProperty("--lyrics-font", `"${lyricsFontFamily}", var(--app-font)`);
    } else {
      existingLyricsFont?.remove();
      delete document.documentElement.dataset.customLyricsFont;
      document.documentElement.style.removeProperty("--lyrics-font");
    }
    if (lyricsFontSize) document.documentElement.style.setProperty("--lyrics-font-size", `${lyricsFontSize}px`);
    else document.documentElement.style.removeProperty("--lyrics-font-size");
  }, [
    settings.theme,
    settings.language,
    settings.web_font_url,
    settings.web_font_family,
    settings.lyrics_font_family,
    settings.lyrics_font_url,
    settings.lyrics_font_size,
    t,
  ]);
  useEffect(() => {
    if (!current) return;
    const shouldResume =
      playbackStartModeRef.current === "resume" && resumeModeRef.current === "resume";
    const resume = shouldResume ? resumePosition(current) : 0;
    playbackStartModeRef.current = "restart";
    const cachedEntry = shouldPreferOfflinePlayback(offlineMode, networkReachable)
      ? findOfflineSongEntry(offlineIndex, current.id, settings.transcode_quality_kbps)
      : undefined;
    const nextMode = cachedEntry ? "auto" : defaultStreamMode(current);
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
  useEffect(() => {
    if (!current) return;
    const cachedEntry = findOfflineSongEntry(offlineIndex, current.id, settings.transcode_quality_kbps);
    if (shouldPreferOfflinePlayback(offlineMode, networkReachable) && cachedEntry && streamModeRef.current !== "auto") {
      setStreamMode("auto");
      setStreamOffset(0);
      return;
    }
    if (!offlineMode && networkReachable && cachedEntry && streamModeRef.current === "auto") {
      setStreamMode(defaultStreamMode(current));
    }
  }, [current?.id, networkReachable, offlineIndex, offlineMode, settings.transcode_quality_kbps]);
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
      if (
        shouldPreservePlaybackIntentOnMediaError(
          playingRef.current || pendingAutoplayRef.current,
          document.visibilityState,
        )
      ) {
        pendingAutoplayRef.current = true;
        setBuffering(true);
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
    const onVisibilityChange = () => {
      const audio = audioRef.current;
      if (!audio) return;
      prepareAudioForBackgroundPlayback(audio);
      if (
        shouldReloadMediaOnForeground(
          audio,
          playingRef.current,
          document.visibilityState,
        )
      ) {
        audio.load();
      }
      if (
        !shouldResumePlaybackOnForeground(
          audio,
          playingRef.current,
          document.visibilityState,
        )
      ) {
        return;
      }
      resumeEqualizer();
      pendingAutoplayRef.current = true;
      window.requestAnimationFrame(requestAudioPlay);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [requestAudioPlay, resumeEqualizer]);

  // Refresh "recently played" when the tab regains focus so the home list isn't stale
  // after the app was backgrounded (the audio-focused handler above intentionally
  // ignores this). Shares recentPlayedRefreshRef with playSong's scheduler to throttle.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - recentPlayedRefreshRef.current < 10_000) return;
      recentPlayedRefreshRef.current = now;
      api.recentPlayedSongs(HOME_RECENT_LIMIT).then(setRecentPlayedSongs).catch(() => undefined);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  useEffect(() => {
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.enumerateDevices) return;
    let cancelled = false;
    let deviceChangeTimer: number | null = null;

    const inspectAudioOutputs = async () => {
      try {
        const nextSnapshot = audioOutputSnapshot(await mediaDevices.enumerateDevices());
        const previousSnapshot = audioOutputSnapshotRef.current;
        if (shouldPauseForAudioOutputDisconnect(
          previousSnapshot,
          nextSnapshot,
          playingRef.current,
          document.visibilityState,
        )) {
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
    if (sleepTimerMode !== "time" || !sleepTimerMins) {
      setSleepLeft(0);
      return;
    }
    const end = Date.now() + sleepTimerMins * 60_000;
    setSleepLeft(sleepTimerMins * 60);
    const timer = window.setInterval(() => {
      const left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      setSleepLeft(left);
      if (left === 0) {
        pendingAutoplayRef.current = false;
        setPlaying(false);
        clearSleepTimer();
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [sleepTimerMode, sleepTimerMins]);

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
      play: () => {
        void ensurePlaybackOutputPlaying();
      },
      pause: () => {
        void ensurePlaybackOutputPaused();
      },
      stop: () => {
        if (remoteDLNAActive) {
          void switchDLNAToLocal();
          return;
        }
        setPlaying(false);
      },
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
  }, [current?.id, currentRadio?.id, currentRadio?.url, currentNetworkTrack?.id, currentNetworkTrack?.source_id, dlnaStatus?.device_id, dlnaStatus?.state, remoteDLNAActive, t]);

  useEffect(() => {
    if (!hasClientMediaSession()) return;
    const hasPlayable = Boolean(current || currentRadio || currentNetworkTrack);
    setClientPlaybackState(remoteDLNAPlaying || playing ? "playing" : hasPlayable ? "paused" : "none");
    if ((!current && !currentNetworkTrack) || !duration) return;
    setClientPositionState({
      duration,
      playbackRate: audioRef.current?.playbackRate || 1,
      position: Math.min(progress, duration),
    });
  }, [current?.id, currentRadio?.id, currentNetworkTrack?.id, currentNetworkTrack?.source_id, duration, playing, progress, remoteDLNAPlaying]);

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

  useLayoutEffect(() => {
    const node = mainRef.current;
    if (!node) return;
    let frame = 0;
    let fallbackTimer = 0;
    const update = () => {
      const next = measurePageSizing(node);
      setPageSizing((old) =>
        old.songs === next.songs && old.cards === next.cards ? old : next,
      );
    };
    const scheduleUpdate = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(update);
    };
    update();
    scheduleUpdate();
    fallbackTimer = window.setTimeout(update, 180);
    const resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(node);
    window.addEventListener("resize", scheduleUpdate);
    window.addEventListener("orientationchange", scheduleUpdate);
    document.addEventListener("fullscreenchange", scheduleUpdate);
    window.visualViewport?.addEventListener("resize", scheduleUpdate);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      if (fallbackTimer) window.clearTimeout(fallbackTimer);
      resizeObserver.disconnect();
      window.removeEventListener("resize", scheduleUpdate);
      window.removeEventListener("orientationchange", scheduleUpdate);
      document.removeEventListener("fullscreenchange", scheduleUpdate);
      window.visualViewport?.removeEventListener("resize", scheduleUpdate);
    };
  }, [lyricsFullScreen, mobilePlayerExpanded]);

  useLayoutEffect(() => {
    if (lyricsFullScreen) return;
    mainRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [view, lyricsFullScreen]);

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
      active.offsetTop -
      container.clientHeight * LYRIC_ACTIVE_ANCHOR_RATIO +
      active.clientHeight / 2;
    container.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
  }, [activeLyric, lyricsFullScreen]);

  function activateOfflineSession(index = readOfflineSongIndex()) {
    const cachedSongs = uniqueSongs(offlineSongEntries(index).map((entry) => entry.song), MAX_PLAYBACK_QUEUE_SIZE);
    if (!cachedSongs.length) return false;
    setExpectedSessionUserId(0);
    shellAlbumPageRequestRef.current += 1;
    setPlaybackSessionSource(null);
    setOfflineMode(true);
    setOfflineIndex(index);
    setSettings(defaultSettings);
    setAuth({ initialized: true, registration_enabled: false, user: offlineUser() });
    setSongs(cachedSongs);
    setLibrarySongPage({
      items: cachedSongs.slice(0, libraryPageSize),
      total: cachedSongs.length,
      limit: libraryPageSize,
      offset: 0,
      page: 1,
    });
    setRecentPlayedSongs([]);
    setRecentAddedSongs([]);
    setDailyMix([]);
    setFavoriteSongs([]);
    setFavoriteAlbums([]);
    setFavoriteArtists([]);
    setAlbums([]);
    setShellAlbumPageData(null);
    setShellAlbumPageLoading(false);
    setArtists([]);
    setPlaylists([]);
    setSmartPlaylists([]);
    setFolders([]);
    setQueue(cachedSongs);
    setCurrent((old) => old ?? cachedSongs[0] ?? null);
    rememberLibraryTab("offline");
    setQuery("");
    setView("library");
    return true;
  }

  async function refreshOfflineCacheUsage() {
    const usage = await offlineCacheUsage().catch(() => emptyOfflineUsage);
    setOfflineUsage(usage);
  }

  async function clearOfflineCacheData() {
    if (offlineClearing) return;
    if (!window.confirm(t("offlineCacheClearConfirm"))) return;
    setOfflineClearing(true);
    try {
      await clearOfflineCache();
      setOfflineIndex({});
      setOfflineUsage(emptyOfflineUsage);
      setOfflineRemovingKeys(new Set());
      autoCacheTriggeredRef.current.clear();
      if (offlineModeRef.current) {
        setSongs([]);
        setLibrarySongPage({ items: [], total: 0, limit: libraryPageSize, offset: 0, page: 1 });
        setQueue([]);
        setCurrent(null);
        setPlaying(false);
      }
      showMessage(t("offlineCacheCleared"));
    } finally {
      setOfflineClearing(false);
    }
  }

  function setAutoCachePlayedSetting(enabled: boolean) {
    setAutoCachePlayed(enabled);
    rememberAutoCachePlayedEnabled(enabled);
    if (!enabled) autoCacheTriggeredRef.current.clear();
  }

  function openOfflineCacheManager() {
    rememberLibraryTab("offline");
    setQuery("");
    setLibraryPage(1);
    setView("library");
  }

  async function removeOfflineCachedSong(entry: OfflineSongEntry) {
    const key = `${entry.song.id}:${entry.quality}`;
    if (offlineRemovingKeys.has(key)) return;
    if (!window.confirm(t("offlineCacheRemoveConfirm").replace("{title}", entry.song.title))) return;
    setOfflineRemovingKeys((old) => new Set(old).add(key));
    try {
      const nextIndex = await removeOfflineSongEntry(entry.song.id, entry.quality);
      setOfflineIndex(nextIndex);
      await refreshOfflineCacheUsage();
      autoCacheTriggeredRef.current.delete(entry.song.id);
      if (offlineModeRef.current) {
        const cachedSongs = uniqueSongs(offlineSongEntries(nextIndex).map((item) => item.song), MAX_PLAYBACK_QUEUE_SIZE);
        setSongs(cachedSongs);
        setLibrarySongPage({
          items: cachedSongs.slice(0, libraryPageSize),
          total: cachedSongs.length,
          limit: libraryPageSize,
          offset: 0,
          page: 1,
        });
        setQueue((old) => old.filter((song) => song.id !== entry.song.id));
        setCurrent((old) => (old?.id === entry.song.id ? cachedSongs[0] ?? null : old));
        if (!cachedSongs.length) setPlaying(false);
      }
      showMessage(t("offlineCacheRemoved"));
    } finally {
      setOfflineRemovingKeys((old) => {
        const next = new Set(old);
        next.delete(key);
        return next;
      });
    }
  }

  async function cacheSongOffline(song: Song, options: { silent?: boolean } = {}) {
    const quality = settings.transcode_quality_kbps || 192;
    const storedIndex = readOfflineSongIndex();
    if (offlineCachedSongIds(storedIndex).has(song.id) || offlineCachingIds.has(song.id)) {
      setOfflineIndex(storedIndex);
      return false;
    }
    setOfflineCachingIds((old) => new Set(old).add(song.id));
    if (!options.silent) showMessage(t("offlineCachePreparing"), 0);
    try {
      let status = await api.prepareOfflineSong(song.id, quality);
      for (let attempt = 0; status.status !== "ready" && attempt < OFFLINE_STATUS_MAX_POLLS; attempt += 1) {
        if (status.status === "failed") throw new Error(status.error || t("offlineCacheFailed"));
        await wait(OFFLINE_STATUS_POLL_MS);
        status =
          status.status === "missing"
            ? await api.prepareOfflineSong(song.id, quality)
            : await api.offlineSongStatus(song.id, quality);
      }
      if (status.status !== "ready") throw new Error(t("loadTimeout"));
      await cacheOfflineSongAssets(status);
      const nextIndex = upsertOfflineSongEntry(status, song);
      setOfflineIndex(nextIndex);
      await refreshOfflineCacheUsage();
      if (!options.silent) showMessage(t("offlineCacheReady"));
      return true;
    } catch (error) {
      if (!options.silent) showMessage(readableErrorMessage(error, t("offlineCacheFailed")));
      return false;
    } finally {
      setOfflineCachingIds((old) => {
        const next = new Set(old);
        next.delete(song.id);
        return next;
      });
    }
  }

  async function cacheSongsOffline(items: Song[]) {
    const targets = uniqueSongs(items).filter((song) => !offlineCachedSongIds(readOfflineSongIndex()).has(song.id));
    if (!targets.length) {
      showMessage(t("offlineCacheBatchAlready"));
      return;
    }
    showMessage(t("offlineCacheBatchPreparing").replace("{count}", String(targets.length)), 0);
    let cached = 0;
    for (const song of targets) {
      if (offlineCachedSongIds(readOfflineSongIndex()).has(song.id)) continue;
      if (await cacheSongOffline(song, { silent: true })) cached += 1;
    }
    await refreshOfflineCacheUsage();
    showMessage(
      cached > 0
        ? t("offlineCacheBatchReady").replace("{count}", String(cached))
        : t("offlineCacheFailed"),
    );
  }

  function maybeAutoCachePlayedSong(song: Song | null, currentProgress: number, currentDuration: number, completed = false) {
    if (!song || !autoCachePlayedRef.current || offlineModeRef.current || !networkReachableRef.current) return;
    if (currentRadioRef.current || currentNetworkTrackRef.current) return;
    if (
      findOfflineSongEntry(readOfflineSongIndex(), song.id, settings.transcode_quality_kbps) ||
      offlineCachingIds.has(song.id) ||
      autoCacheTriggeredRef.current.has(song.id)
    ) return;
    const resolvedDuration = currentDuration || song.duration_seconds || 0;
    const threshold = resolvedDuration > 0 ? Math.min(30, Math.max(5, resolvedDuration * 0.8)) : 30;
    if (!completed && currentProgress < threshold) return;
    autoCacheTriggeredRef.current.add(song.id);
    void cacheSongOffline(song, { silent: true }).then((cached) => {
      if (!cached) autoCacheTriggeredRef.current.delete(song.id);
    });
  }

  async function bootstrap() {
    setAuthLoading(true);
    setAuthError("");
    try {
      const status = await api.authStatus();
      setExpectedSessionUserId(status.user?.id ?? 0);
      setAuth(status);
      void api.health().then(setHealth).catch(() => undefined);
      if (status.initialized && status.user) {
        setOfflineMode(false);
        const nextResumeMode = storedResumeMode(status.user);
        resumeModeRef.current = nextResumeMode;
        setResumeMode(nextResumeMode);
        playbackStartModeRef.current = "resume";
        await loadAppData(status.user);
      }
    } catch (error) {
      if (activateOfflineSession()) {
        setAuthError("");
        return;
      }
      setAuthError(error instanceof Error ? error.message : String(error));
    } finally {
      setAuthLoading(false);
    }
  }

  async function loadAppData(user?: User | null) {
    setQueueSyncReady(false);
    userPreferencesReadyRef.current = false;
    const [loaded, preferences] = await Promise.all([
      api.settings().catch(() => defaultSettings),
      api.userPreferences().catch(() => null),
    ]);
    setSettings({ ...defaultSettings, ...loaded, theme: normalizeTheme(loaded.theme) });
    if (preferences) {
      const normalized = normalizeUserPreferences(preferences);
      lastSavedUserPreferencesRef.current = normalized;
      setHomePlayerStyle(normalized.home_player_style);
      setMobileHomePlayerStyle(normalized.mobile_home_player_style);
      setMineradioStageEnabled(normalized.mineradio_stage_enabled);
      setArtistAlbumDisplayStyle(normalized.artist_album_display_style);
      setLyricsDisplayStyle(normalized.lyrics_display_style);
      setLyricsDragSeekEnabled(normalized.lyrics_drag_seek_enabled);
      setTerminalShellTheme(normalized.terminal_shell_theme);
      rememberHomePlayerStyle(normalized.home_player_style);
      rememberMobileHomePlayerStyle(normalized.mobile_home_player_style);
      rememberMineradioStageEnabled(normalized.mineradio_stage_enabled);
      rememberArtistAlbumDisplayStyle(normalized.artist_album_display_style, user);
      rememberTerminalShellTheme(normalized.terminal_shell_theme);
      userPreferencesReadyRef.current = true;
    } else {
      lastSavedUserPreferencesRef.current = null;
    }
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
    setAuthLoading(true);
    shellAlbumPageRequestRef.current += 1;
    favoriteSessionRef.current += 1;
    refreshGenerationRef.current += 1;
    invalidateCollectionRequest();
    albumPageRequestRef.current += 1;
    albumPageInFlightRef.current = null;
    artistPageRequestRef.current += 1;
    artistPageInFlightRef.current = null;
    albumArtistFilterRef.current = 0;
    albumArtistQueryRef.current = "";
    albumFavoritesOnlyRef.current = false;
    albumBrowseIntentRef.current = {
      page: 1,
      limit: gridPageSizeRef.current,
      artistID: 0,
      artistName: "",
      favoritesOnly: false,
    };
    albumBrowseCommittedRef.current = null;
    albumFavoriteMutationRef.current += 1;
    albumFavoriteStateRef.current.clear();
    albumFavoriteQueueRef.current.clear();
    albumFavoriteRepeatRef.current.clear();
    artistInitialFilterRef.current = "";
    artistFavoritesOnlyRef.current = false;
    artistBrowseIntentRef.current = {
      page: 1,
      limit: gridPageSizeRef.current,
      initial: "",
      favoritesOnly: false,
    };
    artistBrowseCommittedRef.current = null;
    artistFavoriteMutationRef.current += 1;
    artistFavoriteStateRef.current.clear();
    artistFavoriteQueueRef.current.clear();
    artistFavoriteRepeatRef.current.clear();
    setAlbumPageLoading(false);
    setArtistPageLoading(false);
    const logoutController = new AbortController();
    await loadWithTimeout((signal) => api.logout(signal), logoutController).catch(() => undefined);
    setExpectedSessionUserId(0);
    // Invalidate work that may have started while the logout request was in flight.
    shellAlbumPageRequestRef.current += 1;
    favoriteSessionRef.current += 1;
    refreshGenerationRef.current += 1;
    invalidateCollectionRequest();
    albumPageRequestRef.current += 1;
    albumPageInFlightRef.current = null;
    artistPageRequestRef.current += 1;
    artistPageInFlightRef.current = null;
    albumFavoriteMutationRef.current += 1;
    artistFavoriteMutationRef.current += 1;
    albumFavoriteStateRef.current.clear();
    artistFavoriteStateRef.current.clear();
    albumFavoriteQueueRef.current.clear();
    artistFavoriteQueueRef.current.clear();
    albumFavoriteRepeatRef.current.clear();
    artistFavoriteRepeatRef.current.clear();
    userPreferencesReadyRef.current = false;
    lastSavedUserPreferencesRef.current = null;
    setQueueSyncReady(false);
    setSongs([]);
    setHistoryEntries([]);
    setFavoriteSongs([]);
    setFavoriteAlbums([]);
    setFavoriteArtists([]);
    setDailyMix([]);
    setFolders([]);
    setNetworkSources([]);
    setRadioSources([]);
    setRadioStations([]);
    setCurrentRadio(null);
    setRadioQueue([]);
    setCurrentNetworkTrack(null);
    setCollection(null);
    setCollectionBack(null);
    setAlbums([]);
    setArtists([]);
    setAlbumPage(1);
    setAlbumPageData(null);
    setShellAlbumPageData(null);
    setShellAlbumPageLoading(false);
    setAlbumArtistFilter(0);
    setAlbumArtistQuery("");
    setAlbumFavoritesOnly(false);
    setArtistPage(1);
    setArtistPageData(null);
    setArtistInitialFilter("");
    setArtistFavoritesOnly(false);
    setPlaylists([]);
    setSmartPlaylists([]);
    setScrobblingSettings(null);
    setPlaybackSessionSource(null);
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
    maybeAutoCachePlayedSong(current, currentProgress, currentDuration, completed);
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
    if (!offlineModeRef.current && networkReachableRef.current) {
      void api
        .saveProgress(current.id, currentProgress, currentDuration, completed)
        .catch(() => undefined);
    }
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

  function preservePlaybackIntentAfterMediaError(media: HTMLAudioElement) {
    pendingAutoplayRef.current = true;
    setBuffering(true);
    prepareAudioForBackgroundPlayback(media);
    if (!currentRef.current && !currentNetworkTrackRef.current) return;
    const mediaTime = media.currentTime || 0;
    const resumeAt =
      mediaTime > 0.05
        ? streamOffsetRef.current + mediaTime
        : progressRef.current;
    resumeSeekRef.current = resumeAt;
    setProgress(resumeAt);
  }

  function handlePlaybackStall(media: HTMLAudioElement) {
    if (!(playingRef.current || pendingAutoplayRef.current)) return;
    setBuffering(true);
    if (
      !shouldHandleStallAsNetworkIssue(document.visibilityState) ||
      streamModeRef.current === "adaptive" ||
      stallDowngradeTimerRef.current != null
    )
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
    if (offlineModeRef.current) {
      activateOfflineSession(readOfflineSongIndex());
      return;
    }

    const gen = ++refreshGenerationRef.current;
    const isStale = () => refreshGenerationRef.current !== gen;
    const albumPageRequestID = albumPageRequestRef.current;
    const artistPageRequestID = artistPageRequestRef.current;
    const albumBrowseSnapshot = { ...albumBrowseIntentRef.current };
    const artistBrowseSnapshot = { ...artistBrowseIntentRef.current };

    // Layer 1: critical data needed for first render - block on these.
    const [songPageItem, dailyItems, libraryStatsItem, playbackQueueItem] = await Promise.all([
      api.songsPage(query, libraryPage, libraryPageSize, false, { sort: librarySort, review: libraryReview }),
      api.dailyMix(24).catch(() => []),
      api.libraryStats().catch(() => null),
      options.initializeQueue
        ? api.playbackQueue().catch(() => null)
        : Promise.resolve(null),
    ]);
    if (isStale()) return;
    const songItems = songPageItem.items;
    setSongs(songItems);
    setLibrarySongPage(songPageItem);
    setDailyMix(dailyItems);
    setLibraryStats(libraryStatsItem);

    // Layer 2: browse data - stagger by 80ms to reduce SQLite contention on startup.
    await new Promise((r) => setTimeout(r, 80));
    if (isStale()) return;
    const albumPageMutationEpoch = albumFavoriteMutationRef.current;
    const artistPageMutationEpoch = artistFavoriteMutationRef.current;
    const albumSnapshotIsCurrent = () =>
      albumPageRequestID === albumPageRequestRef.current &&
      albumBrowseSnapshot.limit === gridPageSizeRef.current &&
      sameAlbumBrowseQuery(albumBrowseSnapshot, albumBrowseIntentRef.current);
    const artistSnapshotIsCurrent = () =>
      artistPageRequestID === artistPageRequestRef.current &&
      artistBrowseSnapshot.limit === gridPageSizeRef.current &&
      sameArtistBrowseQuery(artistBrowseSnapshot, artistBrowseIntentRef.current);
    const refreshAlbumPage = albumPageInFlightRef.current == null && albumSnapshotIsCurrent();
    const refreshArtistPage = artistPageInFlightRef.current == null && artistSnapshotIsCurrent();
    const [recentPlayedItems, recentAddedItems, albumPageItem, artistPageItem, playlistPageItem, smartPlaylistItems] = await Promise.all([
      api.recentPlayedSongs(HOME_RECENT_LIMIT).catch(() => []),
      api.recentAddedSongs(HOME_RECENT_LIMIT).catch(() => []),
      refreshAlbumPage
        ? api.albumsPage(albumBrowseSnapshot.page, albumBrowseSnapshot.limit, albumBrowseSnapshot.artistID, undefined, albumBrowseSnapshot.favoritesOnly)
            .catch(() => null)
        : Promise.resolve(null),
      refreshArtistPage
        ? api.artistsPage(artistBrowseSnapshot.page, artistBrowseSnapshot.limit, artistBrowseSnapshot.initial, artistBrowseSnapshot.favoritesOnly)
            .catch(() => null)
        : Promise.resolve(null),
      api.playlistsPage(playlistPage, gridPageSize).catch(() => null),
      api.smartPlaylists().catch(() => []),
    ]);
    if (isStale()) return;
    setRecentPlayedSongs(recentPlayedItems);
    setRecentAddedSongs(recentAddedItems);
    let acceptedAlbumPageItem: AlbumPage | null = null;
    if (
      albumPageItem &&
      albumSnapshotIsCurrent() &&
      albumPageMutationEpoch === albumFavoriteMutationRef.current
    ) {
      acceptedAlbumPageItem = commitAlbumBrowsePage(albumPageItem, albumBrowseSnapshot, albumPageMutationEpoch);
    }
    if (
      artistPageItem &&
      artistSnapshotIsCurrent() &&
      artistPageMutationEpoch === artistFavoriteMutationRef.current
    ) {
      commitArtistBrowsePage(artistPageItem, artistBrowseSnapshot, artistPageMutationEpoch);
    }
    if (playlistPageItem) {
      setPlaylistPageData(playlistPageItem);
      setPlaylists(playlistPageItem.items);
    }
    setSmartPlaylists(smartPlaylistItems);

    // Layer 3: deferred data - favorites, settings, network, radio. Stagger by 300ms.
    await new Promise((r) => setTimeout(r, 300));
    if (isStale()) return;
    const favoriteAlbumMutationEpoch = albumFavoriteMutationRef.current;
    const favoriteArtistMutationEpoch = artistFavoriteMutationRef.current;
    const [folderItems, libraryDirectoryItems, favoriteSongPageItem, favoriteAlbumItems, favoriteArtistItems, networkSourceItems, radioSourceItems, radioStationItems, radioFavoriteItems, scrobblingItem, uiSoundItem, playbackHistoryItem] = await Promise.all([
      api.folders(STARTUP_FOLDER_LIMIT).catch(() => []),
      api.libraryDirectories().catch(() => []),
      api.songsPage("", 1, FAVORITES_FETCH_LIMIT, true).catch(() => ({
        items: [],
        total: 0,
        limit: FAVORITES_FETCH_LIMIT,
        offset: 0,
        page: 1,
      })),
      api.favoriteAlbums(FAVORITES_FETCH_LIMIT).catch(() => null),
      api.favoriteArtists().catch(() => null),
      api.networkSources().catch(() => []),
      api.radioSources().catch(() => []),
      api.topRadioStations(RADIO_STATION_LIMIT).catch(() => []),
      api.radioFavorites().catch(() => []),
      api.scrobblingSettings().catch(() => null),
      api.uiSoundSettings().catch(() => ({ enabled: false, volume: 0.85 })),
      api.playbackHistorySettings().catch(() => ({ separate_by_device: false })),
    ]);
    if (isStale()) return;
    setFolders(folderItems);
    setLibraryDirectories(libraryDirectoryItems);
    setFavoriteSongs(favoriteSongPageItem.items);
    if (favoriteAlbumItems !== null && favoriteAlbumMutationEpoch === albumFavoriteMutationRef.current) {
      setFavoriteAlbums(applyAlbumFavoriteOverrides(favoriteAlbumItems, favoriteAlbumMutationEpoch).filter((item) => item.favorite));
    }
    if (favoriteArtistItems !== null && favoriteArtistMutationEpoch === artistFavoriteMutationRef.current) {
      setFavoriteArtists(applyArtistFavoriteOverrides(favoriteArtistItems, favoriteArtistMutationEpoch).filter((item) => item.favorite));
    }
    setNetworkSources(networkSourceItems);
    const playableRadioStations = radioStationItems.map(radioStationToPlayable);
    const playableRadioFavorites = radioFavoriteItems.map(radioStationToPlayable);
    setRadioSources(radioSourceItems);
    setRadioStations(playableRadioStations);
    setRadioFavorites(playableRadioFavorites);
    setScrobblingSettings(scrobblingItem);
    setUISoundSettingsState(uiSoundItem);
    setPlaybackHistorySettings(playbackHistoryItem);

    // Restore playback queue from Layer 1 data.
    let restoredQueue: Song[] = [];
    let restoredCurrent: Song | null = null;
    let restoredRadio: RadioStation | null = null;
    let restoredRadioQueue: RadioStation[] = [];
    if (options.initializeQueue && auth?.user && persistentQueueEnabled) {
      const session = playbackQueueItem?.queue;
      if (session?.radio?.current) {
        const withCurrentFavorite = (station: RadioStation) => {
          const playable = radioStationToPlayable(station);
          const favorite = playableRadioFavorites.some((item) => sameRadioStation(item, playable));
          return { ...playable, favorite: playable.favorite || favorite };
        };
        restoredRadio = withCurrentFavorite(session.radio.current);
        restoredRadioQueue = uniqueRadioStations([
          restoredRadio,
          ...(session.radio.queue ?? []).map(withCurrentFavorite),
        ]);
        setPlaybackSessionSource(null);
      } else {
        const restoreIDs = session?.song_ids?.filter((id) => Number.isInteger(id)).slice(0, MAX_PLAYBACK_QUEUE_SIZE) ?? [];
        const restoreCurrentID = session?.current_id ?? 0;
        const source = session?.source ?? null;
        setPlaybackSessionSource(source ? { type: source.type, source_id: source.source_id } : null);
        if (restoreIDs.length) {
          const localSongs = new Map([
            ...songItems,
            ...dailyItems,
            ...recentPlayedItems,
            ...recentAddedItems,
            ...favoriteSongPageItem.items,
          ].map((song) => [song.id, song] as const));
          restoredQueue = (await Promise.all(restoreIDs.map((id) => localSongs.get(id) ?? api.song(id).catch(() => null))))
            .filter((song): song is Song => Boolean(song));
          restoredCurrent = restoredQueue.find((song) => song.id === restoreCurrentID) ?? restoredQueue[0] ?? null;
        }
        if (!restoredQueue.length && source) {
          restoredQueue = await songsForPlaybackSource(source, MAX_PLAYBACK_QUEUE_SIZE);
          restoredCurrent = restoredQueue.find((song) => song.id === restoreCurrentID) ?? restoredQueue[0] ?? null;
        }
      }
    }
    if (isStale()) return;
    if (restoredRadio) {
      setCurrent(null);
      setCurrentNetworkTrack(null);
      setCurrentRadio(restoredRadio);
      setRadioQueue(restoredRadioQueue);
    }
    setQueue((old) => {
      if (!options.initializeQueue && old.length > 0) return old;
      if (restoredQueue.length) return restoredQueue;
      return dailyItems.length > 0 ? dailyItems : songItems;
    });
    const nextCurrent = restoredRadio
      ? null
      : current
      ? (songItems.find((item) => item.id === current.id) ?? current)
      : restoredCurrent;
    if (nextCurrent && (nextCurrent.id !== current?.id || nextCurrent !== current)) {
      setCurrent(nextCurrent);
    }
    if (options.initializeQueue) setQueueSyncReady(true);
    setCollection((old) => {
      if (!old) return old;
      return {
        ...old,
        songs: old.songs
          .map((song) => songItems.find((item) => item.id === song.id) ?? song),
        albums: acceptedAlbumPageItem &&
          !albumBrowseSnapshot.favoritesOnly &&
          albumPageMutationEpoch === albumFavoriteMutationRef.current
          ? old.albums
              ?.map((album) => acceptedAlbumPageItem.items.find((item) => item.id === album.id) ?? album)
          : old.albums,
      };
    });
  }

  async function refreshLibraryDataOnly() {
    if (offlineModeRef.current) {
      activateOfflineSession(readOfflineSongIndex());
      return;
    }
    const [songPageItem, recentAddedItems, folderItems, libraryStatsItem] = await Promise.all([
      api.songsPage(query, libraryPage, libraryPageSize, false, { sort: librarySort, review: libraryReview }),
      api.recentAddedSongs(HOME_RECENT_LIMIT).catch(() => recentAddedSongs),
      api.folders(STARTUP_FOLDER_LIMIT).catch(() => folders),
      api.libraryStats().catch(() => libraryStats),
    ]);
    setSongs(songPageItem.items);
    setLibrarySongPage(songPageItem);
    setRecentAddedSongs(recentAddedItems);
    setFolders(folderItems);
    setLibraryStats(libraryStatsItem);
  }

  async function refreshMetadataAfterCorrection(result: FolderMetadataCorrectionResult, path: string) {
    if (offlineModeRef.current) throw new Error("library refresh is unavailable offline");
    const albumQuery = { ...albumBrowseIntentRef.current };
    const artistQuery = { ...artistBrowseIntentRef.current };
    const affectedSongIDs = new Set(result.items.map((item) => item.song_id).filter((id) => id > 0));
    const currentSong = currentRef.current;
    const [
      songPageItem,
      recentPlayedItems,
      recentAddedItems,
      dailyItems,
      folderItems,
      libraryStatsItem,
      albumPageItem,
      artistPageItem,
      favoriteAlbumItems,
      favoriteArtistItems,
      correctedFolderSongs,
      refreshedCurrent,
    ] = await Promise.all([
      api.songsPage(query, libraryPage, libraryPageSize, false, { sort: librarySort, review: libraryReview }),
      api.recentPlayedSongs(HOME_RECENT_LIMIT),
      api.recentAddedSongs(HOME_RECENT_LIMIT),
      api.dailyMix(24),
      api.folders(STARTUP_FOLDER_LIMIT),
      api.libraryStats(),
      loadAlbumPage(albumQuery.page, albumQuery.artistID, albumQuery.favoritesOnly, albumQuery.artistName, albumQuery.limit),
      loadArtistPage(artistQuery.page, artistQuery.initial, artistQuery.favoritesOnly, artistQuery.limit),
      api.favoriteAlbums(FAVORITES_FETCH_LIMIT),
      api.favoriteArtists(FAVORITES_FETCH_LIMIT),
      api.folderSongs(path, 0),
      currentSong && affectedSongIDs.has(currentSong.id) ? api.song(currentSong.id) : Promise.resolve(null),
    ]);
    if (!albumPageItem || !artistPageItem) throw new Error("metadata collection refresh was superseded");

    setSongs(songPageItem.items);
    setLibrarySongPage(songPageItem);
    setRecentPlayedSongs(recentPlayedItems);
    setRecentAddedSongs(recentAddedItems);
    setDailyMix(dailyItems);
    setFolders(folderItems);
    setLibraryStats(libraryStatsItem);
    setAlbums(albumPageItem.items);
    setArtists(artistPageItem.items);
    setFavoriteAlbums(favoriteAlbumItems);
    setFavoriteArtists(favoriteArtistItems);
    applyUpdatedSongs([...correctedFolderSongs, ...songPageItem.items, ...recentPlayedItems, ...recentAddedItems, ...dailyItems]);
    if (refreshedCurrent) updateSongState(refreshedCurrent);
  }

  async function loadLibrarySongsPage(page: number, search = query, sort = librarySort, review = libraryReview) {
    const nextPage = Math.max(1, page);
    setLibraryPageLoading(true);
    try {
      if (offlineModeRef.current) {
        let cachedSongs = uniqueSongs(offlineSongEntries(readOfflineSongIndex()).map((entry) => entry.song), MAX_PLAYBACK_QUEUE_SIZE)
          .filter((song) => {
            const q = search.trim().toLowerCase();
            if (!q) return true;
            return [song.title, song.artist, song.album].some((value) => value.toLowerCase().includes(q));
          });
        if (review === "incomplete") cachedSongs = cachedSongs.filter((song) => !song.artist || !song.album || /^(unknown|未知)/i.test(song.artist) || /^(unknown|未知)/i.test(song.album));
        cachedSongs.sort((a, b) => {
          if (sort === "filename_asc" || sort === "filename_desc") {
            const compared = a.file_name.localeCompare(b.file_name, undefined, { sensitivity: "base", numeric: true });
            return sort === "filename_desc" ? -compared : compared;
          }
          const compared = new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
          return sort === "added_asc" ? compared : -compared;
        });
        const offset = (nextPage - 1) * libraryPageSize;
        setLibraryPage(nextPage);
        setSongs(cachedSongs.slice(offset, offset + libraryPageSize));
        setLibrarySongPage({
          items: cachedSongs.slice(offset, offset + libraryPageSize),
          total: cachedSongs.length,
          limit: libraryPageSize,
          offset,
          page: nextPage,
        });
        return;
      }
      const pageItem = await api.songsPage(search, nextPage, libraryPageSize, false, { sort, review });
      setLibraryPage(pageItem.page);
      setLibrarySongPage(pageItem);
      setSongs(pageItem.items);
    } finally {
      setLibraryPageLoading(false);
    }
  }

  async function changeLibrarySort(next: SongSort) {
    if (next === librarySort) return;
    const previous = librarySort;
    setLibrarySort(next);
    setLibraryPage(1);
    try {
      await loadLibrarySongsPage(1, query, next, libraryReview);
    } catch {
      setLibrarySort(previous);
      showMessage(t("librarySortFailed"));
    }
  }

  async function toggleLibraryReview() {
    const next: SongReview = libraryReview === "incomplete" ? "" : "incomplete";
    const previous = libraryReview;
    setLibraryReview(next);
    setLibraryPage(1);
    try {
      await loadLibrarySongsPage(1, query, librarySort, next);
    } catch {
      setLibraryReview(previous);
      showMessage(t("libraryReviewFailed"));
    }
  }

  function applyAlbumFavoriteOverrides(items: Album[], responseMutationEpoch?: number) {
    return items.map((item) => {
      const override = albumFavoriteStateRef.current.get(item.id);
      if (!override) return item;
      if (responseMutationEpoch != null && override.mutationEpoch <= responseMutationEpoch) {
        albumFavoriteStateRef.current.delete(item.id);
        return item;
      }
      return override.favorite === item.favorite ? item : { ...item, favorite: override.favorite };
    });
  }

  function applyArtistFavoriteOverrides(items: Artist[], responseMutationEpoch?: number) {
    return items.map((item) => {
      const override = artistFavoriteStateRef.current.get(item.id);
      if (!override) return item;
      if (responseMutationEpoch != null && override.mutationEpoch <= responseMutationEpoch) {
        artistFavoriteStateRef.current.delete(item.id);
        return item;
      }
      return override.favorite === item.favorite ? item : { ...item, favorite: override.favorite };
    });
  }

  function commitAlbumBrowsePage(pageItem: AlbumPage, query: AlbumBrowseQuery, responseMutationEpoch?: number) {
    const data = { ...pageItem, items: applyAlbumFavoriteOverrides(pageItem.items, responseMutationEpoch) };
    const committedQuery = { ...query, page: data.page, limit: data.limit };
    albumArtistFilterRef.current = committedQuery.artistID;
    albumArtistQueryRef.current = committedQuery.artistName;
    albumFavoritesOnlyRef.current = committedQuery.favoritesOnly;
    albumBrowseIntentRef.current = committedQuery;
    albumBrowseCommittedRef.current = { query: committedQuery, data };
    setAlbumPage(data.page);
    setAlbumPageData(data);
    setAlbumArtistFilter(committedQuery.artistID);
    setAlbumArtistQuery(committedQuery.artistName);
    setAlbumFavoritesOnly(committedQuery.favoritesOnly);
    setAlbums((old) => mergeAlbums(old, data.items));
    return data;
  }

  function commitArtistBrowsePage(pageItem: ArtistPage, query: ArtistBrowseQuery, responseMutationEpoch?: number) {
    const data = { ...pageItem, items: applyArtistFavoriteOverrides(pageItem.items, responseMutationEpoch) };
    const committedQuery = { ...query, page: data.page, limit: data.limit };
    artistInitialFilterRef.current = committedQuery.initial;
    artistFavoritesOnlyRef.current = committedQuery.favoritesOnly;
    artistBrowseIntentRef.current = committedQuery;
    artistBrowseCommittedRef.current = { query: committedQuery, data };
    setArtistPage(data.page);
    setArtistPageData(data);
    setArtistInitialFilter(committedQuery.initial);
    setArtistFavoritesOnly(committedQuery.favoritesOnly);
    setArtists((old) => mergeArtists(old, data.items));
    return data;
  }

  function restoreAlbumBrowse(fallback?: AlbumBrowseQuery) {
    const committed = albumBrowseCommittedRef.current;
    const query = committed?.query ?? fallback;
    if (!query) return;
    albumArtistFilterRef.current = query.artistID;
    albumArtistQueryRef.current = query.artistName;
    albumFavoritesOnlyRef.current = query.favoritesOnly;
    albumBrowseIntentRef.current = query;
    setAlbumPage(query.page);
    setAlbumArtistFilter(query.artistID);
    setAlbumArtistQuery(query.artistName);
    setAlbumFavoritesOnly(query.favoritesOnly);
    if (committed) {
      const data = { ...committed.data, items: applyAlbumFavoriteOverrides(committed.data.items) };
      albumBrowseCommittedRef.current = { query, data };
      setAlbumPageData(data);
      setAlbums((old) => mergeAlbums(old, data.items));
    }
  }

  function restoreArtistBrowse(fallback?: ArtistBrowseQuery) {
    const committed = artistBrowseCommittedRef.current;
    const query = committed?.query ?? fallback;
    if (!query) return;
    artistInitialFilterRef.current = query.initial;
    artistFavoritesOnlyRef.current = query.favoritesOnly;
    artistBrowseIntentRef.current = query;
    setArtistPage(query.page);
    setArtistInitialFilter(query.initial);
    setArtistFavoritesOnly(query.favoritesOnly);
    if (committed) {
      const data = { ...committed.data, items: applyArtistFavoriteOverrides(committed.data.items) };
      artistBrowseCommittedRef.current = { query, data };
      setArtistPageData(data);
      setArtists((old) => mergeArtists(old, data.items));
    }
  }

  async function loadAlbumPage(
    page: number,
    artistID = albumArtistFilterRef.current,
    favoritesOnly = albumFavoritesOnlyRef.current,
    artistName = albumArtistQueryRef.current,
    limit = gridPageSizeRef.current,
  ): Promise<AlbumPage | undefined> {
    const nextPage = Math.max(1, page);
    const query = { page: nextPage, limit, artistID, artistName, favoritesOnly };
    const requestID = ++albumPageRequestRef.current;
    const mutationEpoch = albumFavoriteMutationRef.current;
    albumBrowseIntentRef.current = query;
    albumPageInFlightRef.current = requestID;
    if (offlineModeRef.current) {
      const emptyPage = { items: [], total: 0, limit, offset: 0, page: nextPage };
      albumPageInFlightRef.current = null;
      setAlbumPageLoading(false);
      return commitAlbumBrowsePage(emptyPage, query);
    }
    setAlbumPageLoading(true);
    try {
      const pageItem = await api.albumsPage(nextPage, limit, artistID, undefined, favoritesOnly);
      if (requestID !== albumPageRequestRef.current) return undefined;
      if (mutationEpoch !== albumFavoriteMutationRef.current) {
        return loadAlbumPage(nextPage, artistID, favoritesOnly, artistName, gridPageSizeRef.current);
      }
      const lastPage = Math.max(1, Math.ceil(pageItem.total / Math.max(1, pageItem.limit)));
      if (nextPage > lastPage || pageItem.page > lastPage) {
        return loadAlbumPage(lastPage, artistID, favoritesOnly, artistName, gridPageSizeRef.current);
      }
      return commitAlbumBrowsePage(pageItem, query, mutationEpoch);
    } catch (error) {
      if (requestID !== albumPageRequestRef.current) return undefined;
      throw error;
    } finally {
      if (requestID === albumPageRequestRef.current) {
        albumPageInFlightRef.current = null;
        setAlbumPageLoading(false);
      }
    }
  }

  async function loadArtistPage(
    page: number,
    initial = artistInitialFilterRef.current,
    favoritesOnly = artistFavoritesOnlyRef.current,
    limit = gridPageSizeRef.current,
  ): Promise<ArtistPage | undefined> {
    const nextPage = Math.max(1, page);
    const query = { page: nextPage, limit, initial, favoritesOnly };
    const requestID = ++artistPageRequestRef.current;
    const mutationEpoch = artistFavoriteMutationRef.current;
    artistBrowseIntentRef.current = query;
    artistPageInFlightRef.current = requestID;
    if (offlineModeRef.current) {
      const emptyPage = { items: [], total: 0, limit, offset: 0, page: nextPage, initials: [] };
      artistPageInFlightRef.current = null;
      setArtistPageLoading(false);
      return commitArtistBrowsePage(emptyPage, query);
    }
    setArtistPageLoading(true);
    try {
      const pageItem = await api.artistsPage(nextPage, limit, initial, favoritesOnly);
      if (requestID !== artistPageRequestRef.current) return undefined;
      if (mutationEpoch !== artistFavoriteMutationRef.current) {
        return loadArtistPage(nextPage, initial, favoritesOnly, gridPageSizeRef.current);
      }
      const lastPage = Math.max(1, Math.ceil(pageItem.total / Math.max(1, pageItem.limit)));
      if (nextPage > lastPage || pageItem.page > lastPage) {
        return loadArtistPage(lastPage, initial, favoritesOnly, gridPageSizeRef.current);
      }
      return commitArtistBrowsePage(pageItem, query, mutationEpoch);
    } catch (error) {
      if (requestID !== artistPageRequestRef.current) return undefined;
      throw error;
    } finally {
      if (requestID === artistPageRequestRef.current) {
        artistPageInFlightRef.current = null;
        setArtistPageLoading(false);
      }
    }
  }

  async function requestAlbumPage(
    page: number,
    artistID = albumArtistFilterRef.current,
    favoritesOnly = albumFavoritesOnlyRef.current,
    artistName = albumArtistQueryRef.current,
    failureKey: TKey = "loadFailed",
  ) {
    const fallback = { ...albumBrowseIntentRef.current };
    try {
      await loadAlbumPage(page, artistID, favoritesOnly, artistName);
    } catch {
      restoreAlbumBrowse(fallback);
      showMessage(t(failureKey));
    }
  }

  async function requestArtistPage(
    page: number,
    initial = artistInitialFilterRef.current,
    favoritesOnly = artistFavoritesOnlyRef.current,
    failureKey: TKey = "loadFailed",
  ) {
    const fallback = { ...artistBrowseIntentRef.current };
    try {
      await loadArtistPage(page, initial, favoritesOnly);
    } catch {
      restoreArtistBrowse(fallback);
      showMessage(t(failureKey));
    }
  }

  function selectAlbumArtistFilter(artistItem: Artist) {
    albumArtistFilterRef.current = artistItem.id;
    albumArtistQueryRef.current = artistItem.name;
    setAlbumArtistFilter(artistItem.id);
    setAlbumArtistQuery(artistItem.name);
    void requestAlbumPage(1, artistItem.id, albumFavoritesOnlyRef.current, artistItem.name, "favoriteFilterFailed");
  }

  function clearAlbumArtistFilter() {
    const hadFilter = albumArtistFilterRef.current > 0 || albumArtistQueryRef.current.trim() !== "";
    albumArtistFilterRef.current = 0;
    albumArtistQueryRef.current = "";
    setAlbumArtistFilter(0);
    setAlbumArtistQuery("");
    if (hadFilter) void requestAlbumPage(1, 0, albumFavoritesOnlyRef.current, "", "favoriteFilterFailed");
  }

  function toggleAlbumFavoritesFilter() {
    const next = !albumFavoritesOnlyRef.current;
    albumFavoritesOnlyRef.current = next;
    setAlbumFavoritesOnly(next);
    void requestAlbumPage(1, albumArtistFilterRef.current, next, albumArtistQueryRef.current, "favoriteFilterFailed");
  }

  function selectArtistInitialFilter(initial: string) {
    const nextInitial = initial === artistInitialFilterRef.current ? "" : initial;
    artistInitialFilterRef.current = nextInitial;
    setArtistInitialFilter(nextInitial);
    void requestArtistPage(1, nextInitial, artistFavoritesOnlyRef.current, "favoriteFilterFailed");
  }

  function toggleArtistFavoritesFilter() {
    const next = !artistFavoritesOnlyRef.current;
    artistFavoritesOnlyRef.current = next;
    setArtistFavoritesOnly(next);
    void requestArtistPage(1, artistInitialFilterRef.current, next, "favoriteFilterFailed");
  }

  async function loadPlaylistPage(page: number) {
    const nextPage = Math.max(1, page);
    if (offlineModeRef.current) {
      setPlaylistPage(nextPage);
      setPlaylistPageData({ items: [], total: 0, limit: gridPageSize, offset: 0, page: nextPage });
      setPlaylists([]);
      return;
    }
    setPlaylistPageLoading(true);
    try {
      const pageItem = await api.playlistsPage(nextPage, gridPageSize);
      setPlaylistPage(pageItem.page);
      setPlaylistPageData(pageItem);
      setPlaylists(pageItem.items);
    } finally {
      setPlaylistPageLoading(false);
    }
  }

  async function loadShellAlbumPage(page: number) {
    const nextPage = Math.max(1, page);
    const requestID = ++shellAlbumPageRequestRef.current;
    if (offlineModeRef.current) {
      setShellAlbumPageData({ items: [], total: 0, limit: gridPageSize, offset: 0, page: nextPage });
      return;
    }
    setShellAlbumPageLoading(true);
    try {
      const pageItem = await api.albumsPage(nextPage, gridPageSize, 0, undefined, false);
      if (requestID !== shellAlbumPageRequestRef.current) return;
      setShellAlbumPageData(pageItem);
      setAlbums((old) => mergeAlbums(old, pageItem.items));
    } catch {
      // Keep the last usable shell page visible when this independent surface fails.
    } finally {
      if (requestID === shellAlbumPageRequestRef.current) setShellAlbumPageLoading(false);
    }
  }

  useEffect(() => {
    if (!auth?.user || authLoading) return;
    const pending: Promise<unknown>[] = [];
    if (!librarySongPage) pending.push(loadLibrarySongsPage(1));
    if (!albumPageData) pending.push(requestAlbumPage(1));
    if (!artistPageData) pending.push(requestArtistPage(1));
    if (!playlistPageData) pending.push(loadPlaylistPage(1));
    if (pending.length) void Promise.allSettled(pending);
  }, [auth?.user?.id, authLoading]);

  useEffect(() => {
    if (interfaceMode !== "shell" || mobileViewport || !auth?.user || authLoading) return;
    void loadShellAlbumPage(shellAlbumPageData?.page ?? 1);
  }, [interfaceMode, mobileViewport, auth?.user?.id, authLoading, gridPageSize]);

  useEffect(() => {
    if (!auth?.user || authLoading) return;
    const pending: Promise<unknown>[] = [];
    if (librarySongPage && librarySongPage.limit !== libraryPageSize) {
      const nextPage = Math.floor(librarySongPage.offset / libraryPageSize) + 1;
      pending.push(loadLibrarySongsPage(nextPage));
    }
    if (albumPageData && albumPageData.limit !== gridPageSize) {
      const nextPage = albumPageInFlightRef.current != null
        ? albumBrowseIntentRef.current.page
        : Math.floor(albumPageData.offset / gridPageSize) + 1;
      pending.push(requestAlbumPage(nextPage));
    }
    if (artistPageData && artistPageData.limit !== gridPageSize) {
      const nextPage = artistPageInFlightRef.current != null
        ? artistBrowseIntentRef.current.page
        : Math.floor(artistPageData.offset / gridPageSize) + 1;
      pending.push(requestArtistPage(nextPage));
    }
    if (playlistPageData && playlistPageData.limit !== gridPageSize) {
      const nextPage = Math.floor(playlistPageData.offset / gridPageSize) + 1;
      pending.push(loadPlaylistPage(nextPage));
    }
    if (pending.length) void Promise.allSettled(pending);
  }, [
    auth?.user?.id,
    authLoading,
    libraryPageSize,
    gridPageSize,
    librarySongPage?.limit,
    albumPageData?.limit,
    artistPageData?.limit,
    playlistPageData?.limit,
  ]);

  async function refreshRecentPlayed() {
    setRecentPlayedSongs(await api.recentPlayedSongs(HOME_RECENT_LIMIT).catch(() => recentPlayedSongs));
  }

  async function refreshPlaybackHistory() {
    setHistoryLoading(true);
    try {
      setHistoryEntries(await api.playbackHistory(PLAYBACK_HISTORY_LIMIT));
    } catch {
      // Keep the existing timeline visible if the refresh fails.
    } finally {
      setHistoryLoaded(true);
      setHistoryLoading(false);
    }
  }

  // prependRecentPlayed optimistically moves the just-played song to the front so the
  // home "recently played" list updates instantly, without waiting for a server round
  // trip (the previous code blind-refetched on every play, causing visible lag).
  function prependRecentPlayed(song: Song) {
    setRecentPlayedSongs((old) => [song, ...old.filter((item) => item.id !== song.id)].slice(0, HOME_RECENT_LIMIT));
    setHistoryEntries((old) =>
      prependOptimisticPlaybackHistoryEntry(old, song, {
        deviceType: mobileViewport ? "mobile" : "pc",
        limit: PLAYBACK_HISTORY_LIMIT,
      }),
    );
  }

  // scheduleRecentPlayedRefresh coalesces the server reconciliation so we don't fire a
  // recent-played GET on every single track start; the optimistic prepend already gives
  // instant UI and the server only needs to confirm ordering/play-counts periodically.
  function scheduleRecentPlayedRefresh() {
    const now = Date.now();
    if (now - recentPlayedRefreshRef.current < 10_000) return;
    recentPlayedRefreshRef.current = now;
    void refreshRecentPlayed();
    if (view === "history" || historyEntries.length) void refreshPlaybackHistory();
  }

  function setPlaybackSessionSource(source: PlaybackSourceInput | null) {
    playbackSessionSourceRef.current = source;
  }

  function persistPlaybackSourceForPlay(options: PlaySongOptions) {
    const source = options.source;
    if (source) {
      setPlaybackSessionSource(source);
      return source;
    }
    if (!options.keepPlaybackSource) {
      setPlaybackSessionSource(null);
      return null;
    }
    return playbackSessionSourceRef.current;
  }

  function savePlaybackQueueSession(items: Song[], song: Song, source: PlaybackSourceInput | null) {
    if (!auth?.user) return;
    const ids = items.map((item) => item.id).filter((id) => Number.isInteger(id)).slice(0, MAX_PLAYBACK_QUEUE_SIZE);
    if (!ids.length) return;
    void api.savePlaybackQueue(ids, song.id, source).catch(() => undefined);
  }

  function dlnaErrorMessage(err: unknown) {
    return err instanceof Error ? err.message : String(err);
  }

  function enqueueDLNACommand<T>(task: () => Promise<T>) {
    dlnaPlaybackPendingRef.current += 1;
    const command = dlnaPlaybackCommandRef.current.then(task, task);
    const settled = command.finally(() => {
      dlnaPlaybackPendingRef.current = Math.max(0, dlnaPlaybackPendingRef.current - 1);
    });
    dlnaPlaybackCommandRef.current = settled.then(() => undefined, () => undefined);
    return settled;
  }

  async function refreshDLNADevices(active = true) {
    if (!settings.dlna_cast_enabled) {
      setDLNADevices([]);
      setDLNAError(t("dlnaCastDisabled"));
      setDLNAStatus((old) => old ?? {
        cast_enabled: false,
        library_enabled: settings.dlna_library_enabled,
        output: "local",
        state: "idle",
      });
      return;
    }
    if (active) setDLNALoading(true);
    setDLNAError("");
    try {
      const devices = active ? await api.discoverDLNADevices() : await api.dlnaDevices();
      setDLNADevices(devices);
      setDLNAStatus(await api.dlnaStatus());
    } catch (err) {
      setDLNAError(dlnaErrorMessage(err));
    } finally {
      if (active) setDLNALoading(false);
    }
  }

  function openDLNAPanel() {
    setDLNAPanelOpen(true);
    void refreshDLNADevices(false);
  }

  async function playSongToDLNADevice(
    deviceID: string,
    song: Song,
    list = songs,
    options: PlaySongOptions = {},
  ) {
    if (!deviceID || !settings.dlna_cast_enabled) {
      setDLNAError(t("dlnaCastDisabled"));
      setDLNAPanelOpen(true);
      return false;
    }
    const nextQueue = queueWithCurrent(list.length ? list : [song], song);
    const previousPlan = playbackOutputPlanRef.current;
    const targetPlan = { output: "dlna" as const, deviceID, state: "playing" as const };
    dlnaPlaybackDesiredStateRef.current = "playing";
    playbackOutputPlanRef.current = targetPlan;
    return enqueueDLNACommand(async () => {
      setDLNALoading(true);
      setDLNAError("");
      try {
        const status = await api.playDLNA(deviceID, song.id);
        if (current && current.id !== song.id) syncPlaybackProgress(false);
        const audio = audioRef.current;
        if (audio) {
          audio.pause();
          audio.currentTime = 0;
        }
        playbackStartModeRef.current = options.startMode ?? "restart";
        pendingAutoplayRef.current = false;
        setBuffering(false);
        setRadioDownloadKbps(0);
        radioDownloadSampleRef.current = { at: 0, ahead: 0 };
        setStreamOffset(0);
        setStreamMode(defaultStreamMode(song));
        setCurrentRadio(null);
        setRadioQueue([]);
        setCurrentNetworkTrack(null);
        setCurrent(song);
        setQueue(nextQueue);
        setProgress(0);
        setBufferedEnd(0);
        setDuration(song.duration_seconds || 0);
        setPlaying(false);
        setDLNAStatus(status);
        setDLNAPanelOpen(false);
        playUISound("play");
        const nextSource = persistPlaybackSourceForPlay(options);
        savePlaybackQueueSession(nextQueue, song, nextSource);
        prependRecentPlayed(song);
        await api.markPlayed(song.id).catch(() => undefined);
        scheduleRecentPlayedRefresh();
        return true;
      } catch (err) {
        if (playbackOutputPlanRef.current === targetPlan) {
          playbackOutputPlanRef.current = previousPlan;
          dlnaPlaybackDesiredStateRef.current = previousPlan.output === "dlna" ? previousPlan.state : null;
        }
        const messageText = dlnaErrorMessage(err);
        setDLNAError(messageText);
        setDLNAPanelOpen(true);
        showMessage(messageText);
        return false;
      } finally {
        setDLNALoading(false);
      }
    });
  }

  async function playCurrentToDLNA(device: DLNADevice) {
    if (!current) {
      setDLNAError(t("dlnaSelectSongFirst"));
      return;
    }
    await playSongToDLNADevice(device.id, current, queue.length ? queue : [current], { keepPlaybackSource: true });
  }

  async function switchDLNAToLocal() {
    const previousPlan = playbackOutputPlanRef.current;
    if (previousPlan.output !== "dlna" && !remoteDLNAActive) {
      setDLNAPanelOpen(false);
      return;
    }
    const deviceID = previousPlan.output === "dlna" ? previousPlan.deviceID : dlnaStatus?.device_id;
    dlnaPlaybackDesiredStateRef.current = null;
    playbackOutputPlanRef.current = { output: "local", state: "playing" };
    await enqueueDLNACommand(async () => {
      setDLNALoading(true);
      setDLNAError("");
      try {
        const status = deviceID
          ? await api.stopDLNA(deviceID)
          : await api.switchDLNALocal();
        setDLNAStatus(status);
        setDLNAPanelOpen(false);
        if (current && playbackOutputPlanRef.current.output === "local" && playbackOutputPlanRef.current.state === "playing") {
          pendingAutoplayRef.current = true;
          setPlaying(true);
        }
        showMessage(t("localPlayback"));
      } catch (err) {
        const failedPlan = playbackOutputPlanRef.current;
        if (failedPlan.output === "local") {
          const restoredPlan = previousPlan.output === "dlna"
            ? { ...previousPlan, state: failedPlan.state }
            : previousPlan;
          playbackOutputPlanRef.current = restoredPlan;
          dlnaPlaybackDesiredStateRef.current = restoredPlan.output === "dlna" ? restoredPlan.state : null;
          if (restoredPlan.output === "dlna" && failedPlan.state !== previousPlan.state) {
            void setRemoteDLNAPlaybackState(failedPlan.state);
          }
        }
        setDLNAError(dlnaErrorMessage(err));
      } finally {
        setDLNALoading(false);
      }
    });
  }

  function setRemoteDLNAPlaybackState(target: "playing" | "paused") {
    const plan = playbackOutputPlanRef.current;
    const deviceID = plan.output === "dlna" ? plan.deviceID : undefined;
    if (!deviceID) return Promise.resolve();
    dlnaPlaybackDesiredStateRef.current = target;
    const targetPlan = { output: "dlna" as const, deviceID, state: target };
    playbackOutputPlanRef.current = targetPlan;
    return enqueueDLNACommand(async () => {
      const activePlan = playbackOutputPlanRef.current;
      if (activePlan.output !== "dlna" || activePlan.deviceID !== deviceID || activePlan.state !== target) return;
      setDLNALoading(true);
      setDLNAError("");
      try {
        const nextStatus = target === "playing"
          ? await api.resumeDLNA(deviceID)
          : await api.pauseDLNA(deviceID);
        setDLNAStatus(nextStatus);
        setPlaying(false);
        audioRef.current?.pause();
        playUISound(nextStatus.state === "playing" ? "play" : "pause");
      } catch (err) {
        if (playbackOutputPlanRef.current === targetPlan) {
          playbackOutputPlanRef.current = plan;
          dlnaPlaybackDesiredStateRef.current = plan.output === "dlna" ? plan.state : null;
        }
        const messageText = dlnaErrorMessage(err);
        setDLNAError(messageText);
        setDLNAPanelOpen(true);
        showMessage(messageText);
      } finally {
        setDLNALoading(false);
      }
    });
  }

  async function togglePlaybackOutput() {
    const plan = playbackOutputPlanRef.current;
    if (plan.output === "dlna" && plan.deviceID) {
      const currentState = dlnaPlaybackDesiredStateRef.current ?? plan.state;
      await setRemoteDLNAPlaybackState(currentState === "playing" ? "paused" : "playing");
      return;
    }
    const target = plan.state === "playing" ? "paused" : "playing";
    playbackOutputPlanRef.current = { output: "local", state: target };
    playUISound(target === "playing" ? "play" : "pause");
    setPlaying(target === "playing");
  }

  async function ensurePlaybackOutputPlaying() {
    if (playbackOutputPlanRef.current.output === "dlna") {
      await setRemoteDLNAPlaybackState("playing");
      return;
    }
    playbackOutputPlanRef.current = { output: "local", state: "playing" };
    if (!playingRef.current) setPlaying(true);
  }

  async function ensurePlaybackOutputPaused() {
    if (playbackOutputPlanRef.current.output === "dlna") {
      await setRemoteDLNAPlaybackState("paused");
      return;
    }
    playbackOutputPlanRef.current = { output: "local", state: "paused" };
    if (playingRef.current) setPlaying(false);
  }

  function saveRadioPlaybackSession(station: RadioStation, items: RadioStation[]) {
    if (!auth?.user) return;
    const radioItems = uniqueRadioStations([station, ...items]);
    void api.savePlaybackRadioQueue(station, radioItems).catch(() => undefined);
  }

  function clearPersistentPlaybackSession() {
    if (!auth?.user) return;
    void api.clearPlaybackQueue().catch(() => undefined);
  }

  async function songsForPlaybackQueueIDs(ids: number[]) {
    const localSongs = new Map([
      ...queue,
      ...songs,
      ...dailyMix,
      ...recentPlayedSongs,
      ...recentAddedSongs,
      ...favoriteSongs,
    ].map((song) => [song.id, song] as const));
    return (await Promise.all(ids.map((id) => localSongs.get(id) ?? api.song(id).catch(() => null))))
      .filter((song): song is Song => Boolean(song));
  }

  async function songsForPlaybackSource(source: PlaybackSourceInput, limit = RESUME_SOURCE_QUEUE_LIMIT) {
    return (
      source.type === "album"
        ? api.albumSongs(source.source_id, limit)
        : source.type === "playlist"
          ? api.playlistSongs(source.source_id, limit)
          : api.artistSongs(source.source_id, limit)
    ).catch(() => []);
  }

  async function playFromPlaybackQueueStatus(song: Song, status: PlaybackQueueStatus | null) {
    const ids = status?.queue?.song_ids?.filter((id) => Number.isInteger(id)).slice(0, MAX_PLAYBACK_QUEUE_SIZE) ?? [];
    if (!ids.includes(song.id)) return false;
    const items = await songsForPlaybackQueueIDs(ids);
    const matched = items.find((item) => item.id === song.id);
    if (!matched) return false;
    void playSong(matched, items, { startMode: "resume", source: status?.queue?.source ?? undefined });
    return true;
  }

  async function resumePlayback(song: Song) {
    const status = await api.playbackQueue().catch(() => null);
    if (await playFromPlaybackQueueStatus(song, status)) return;
    const source = status?.queue?.source;
    if (!source) {
      void playSong(song, [song], { startMode: "resume" });
      return;
    }

    const sourceMatchesSong =
      (source.type === "album" && song.album_id === source.source_id) ||
      (source.type === "artist" && song.artist_id === source.source_id) ||
      source.type === "playlist";
    if (!sourceMatchesSong) {
      void playSong(song, [song], { startMode: "resume" });
      return;
    }

    const items = await songsForPlaybackSource(source, RESUME_SOURCE_QUEUE_LIMIT);
    const matched = items.find((item) => item.id === song.id);
    if (matched) {
      void playSong(matched, items, { startMode: "resume", source });
      return;
    }

    void playSong(song, [song], { startMode: "resume" });
  }

  async function playSong(
    song: Song,
    list = songs,
    options: PlaySongOptions = {},
  ) {
    if (remoteDLNAActive && dlnaStatus?.device_id) {
      await playSongToDLNADevice(dlnaStatus.device_id, song, list, options);
      return;
    }
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
    const nextQueue = queueWithCurrent(list.length ? list : [song], song);
    setQueue(nextQueue);
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
    playUISound("play");
    const nextSource = persistPlaybackSourceForPlay(options);
    savePlaybackQueueSession(nextQueue, song, nextSource);
    prependRecentPlayed(song); // optimistic; instant home update
    await api.markPlayed(song.id).catch(() => undefined);
    scheduleRecentPlayedRefresh(); // coalesced server reconciliation
  }

  function playRadio(station: RadioStation, list?: RadioStation[]) {
    if (!station?.url) return;
    if (sleepTimerModeRef.current !== "time") clearSleepTimer();
    setPlaybackSessionSource(null);
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
    const inferredGroupQueue = radioQueueForStation(station);
    const nextRadioQueue = uniqueRadioStations([
      ...(list ?? []),
      ...inferredGroupQueue,
      station,
    ]);
    setCurrentRadio(playableStation);
    setRadioQueue(nextRadioQueue);
    setCurrentNetworkTrack(null);
    setLyrics(null);
    setLyricCandidates([]);
    setProgress(0);
    setDuration(0);
    setBufferedEnd(0);
    setStreamOffset(0);
    setStreamMode("auto");
    setPlaying(true);
    playUISound("play");
    saveRadioPlaybackSession(playableStation, nextRadioQueue);
  }

  function radioQueueForStation(station: RadioStation) {
    const group = station.group_name || "";
    const sourceURL = station.source_url || "";
    const rawURL = radioRawURL(station);
    const matches = radioSources.filter((source) => {
      if (group && radioGroupName(source) === group) return true;
      if (sourceURL && source.source_url === sourceURL) return true;
      return rawURL !== "" && source.url === rawURL;
    });
    return matches.map(radioSourceToStation);
  }

  function playNetworkTrack(track: NetworkTrack) {
    if (!track?.stream_url) return;
    if (sleepTimerModeRef.current !== "time") clearSleepTimer();
    setPlaybackSessionSource(null);
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
    playUISound("play");
    clearPersistentPlaybackSession();
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

  function clearSleepTimer() {
    setSleepTimerMode("off");
    setSleepTimerMins(0);
    setSleepLeft(0);
    setSleepSongsLeft(0);
    setSleepAlbumId(0);
    setSleepAlbumTitle("");
  }

  function setSleepTimerByMinutes(minutes: number) {
    const nextMinutes = Math.max(1, Math.min(24 * 60, Math.trunc(minutes)));
    setSleepTimerMode("time");
    setSleepTimerMins(nextMinutes);
    setSleepSongsLeft(0);
    setSleepAlbumId(0);
    setSleepAlbumTitle("");
    setSleepTimerOpen(false);
  }

  function setSleepTimerBySongs(count: number) {
    const nextCount = Math.max(1, Math.min(99, Math.trunc(count)));
    setSleepTimerMode("songs");
    setSleepTimerMins(0);
    setSleepLeft(0);
    setSleepSongsLeft(nextCount);
    setSleepAlbumId(0);
    setSleepAlbumTitle("");
    setSleepTimerOpen(false);
  }

  function setSleepTimerByAlbum() {
    if (!current?.album_id) return;
    setSleepTimerMode("album");
    setSleepTimerMins(0);
    setSleepLeft(0);
    setSleepSongsLeft(0);
    setSleepAlbumId(current.album_id);
    setSleepAlbumTitle(current.album || t("album"));
    setSleepTimerOpen(false);
  }

  function stopAtSleepTimerBoundary(active?: Song | null) {
    pendingAutoplayRef.current = false;
    setPlaying(false);
    if (active) setProgress(durationRef.current || active.duration_seconds || progressRef.current);
  }

  function shouldStopForSleepTimerAfterSong(active: Song, activeQueue: Song[]) {
    const mode = sleepTimerModeRef.current;
    if (mode === "songs") {
      const nextLeft = Math.max(0, sleepSongsLeftRef.current - 1);
      if (nextLeft <= 0) {
        clearSleepTimer();
        return true;
      }
      setSleepSongsLeft(nextLeft);
      return false;
    }
    if (mode !== "album") return false;

    const targetAlbumId = sleepAlbumIdRef.current || active.album_id;
    if (!targetAlbumId || active.album_id !== targetAlbumId) {
      clearSleepTimer();
      return true;
    }
    const currentIndex = activeQueue.findIndex((song) => song.id === active.id);
    const hasMoreInAlbum =
      currentIndex >= 0 &&
      activeQueue.slice(currentIndex + 1).some((song) => song.album_id === targetAlbumId);
    if (!hasMoreInAlbum) {
      clearSleepTimer();
      return true;
    }
    return false;
  }

  function next(delta: 1 | -1, ended = false) {
    if (currentRadioRef.current) {
      if (ended) {
        pendingAutoplayRef.current = false;
        setPlaying(false);
        return;
      }
      const activeRadio = currentRadioRef.current;
      const inferredGroupQueue = radioQueueForStation(activeRadio);
      const radioList = uniqueRadioStations([
        ...radioQueue,
        ...inferredGroupQueue,
        ...(radioQueue.length || inferredGroupQueue.length
          ? []
          : radioStations.length
            ? radioStations
            : radioSources.map(radioSourceToStation)),
      ]);
      const currentIndex = radioList.findIndex((station) => sameRadioStation(station, activeRadio));
      if (radioList.length > 1) {
        const nextIndex = currentIndex >= 0
          ? (currentIndex + delta + radioList.length) % radioList.length
          : delta > 0
            ? 0
            : radioList.length - 1;
        playRadio(radioList[nextIndex], radioList);
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
    if (ended && shouldStopForSleepTimerAfterSong(active, activeQueue)) {
      stopAtSleepTimerBoundary(active);
      return;
    }
    if (ended && mode === "repeat-one") {
      if (remoteDLNAActive && dlnaStatus?.device_id) {
        void playSongToDLNADevice(dlnaStatus.device_id, active, activeQueue, { keepPlaybackSource: true });
        return;
      }
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
    const idx = activeQueue.findIndex((song) => song.id === active.id);
    const boundaryAction = queueBoundaryAction(mode, delta, idx, activeQueue.length, ended);
    if (boundaryAction === "stop") {
      stopAtSleepTimerBoundary(active);
      return;
    }
    if (boundaryAction === "no-op") return;
    if (ended && activeQueue.length < 2) {
      pendingAutoplayRef.current = false;
      setPlaying(false);
      setProgress(duration || active.duration_seconds || progress);
      if (sleepTimerModeRef.current === "songs" || sleepTimerModeRef.current === "album") clearSleepTimer();
      return;
    }
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
      if (sleepTimerModeRef.current === "songs" || sleepTimerModeRef.current === "album") clearSleepTimer();
      return;
    }
    if (target.id === active.id && audioRef.current) {
      if (remoteDLNAActive && dlnaStatus?.device_id) {
        void playSongToDLNADevice(dlnaStatus.device_id, target, activeQueue, { keepPlaybackSource: true });
        return;
      }
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
    if (remoteDLNAActive && dlnaStatus?.device_id) {
      void playSongToDLNADevice(dlnaStatus.device_id, target, activeQueue, { keepPlaybackSource: true });
      return;
    }
    void playSong(target, activeQueue, { keepPlaybackSource: true });
  }

  function insertNextBatch(items: Song[]) {
    const requested = uniqueSongs(items.filter(Boolean), MAX_PLAYBACK_QUEUE_SIZE);
    if (!requested.length) return;
    playUISound("success");
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
      const batch = requested
        .filter((song) => song.id !== current.id && !baseIDs.has(song.id))
        .slice(0, MAX_PLAYBACK_QUEUE_SIZE - 1);
      inserted = batch.length;
      if (!batch.length) return base;
      const idx = Math.max(0, base.findIndex((song) => song.id === current.id));
      const headCapacity = MAX_PLAYBACK_QUEUE_SIZE - batch.length;
      const head = base.slice(Math.max(0, idx + 1 - headCapacity), idx + 1);
      const tailCapacity = MAX_PLAYBACK_QUEUE_SIZE - head.length - batch.length;
      return [
        ...head,
        ...batch,
        ...base.slice(idx + 1, idx + 1 + tailCapacity),
      ];
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

  function adjustLyricOffset(deltaMs: number) {
    setLyricOffsetMs((value) => normalizeLyricOffsetMs(value + deltaMs));
  }

  async function openLyricCandidates() {
    if (!current) return;
    const songID = current.id;
    const key = lyricCandidateCacheKey(songID);
    const cached = getCandidateCache<LyricCandidate>(key);
    setLyricCandidatesOpen(true);
    if (cached !== undefined) {
      setLyricCandidates(cached);
      setLyricCandidatesLoading(false);
      return;
    }
    setLyricCandidatesLoading(true);
    try {
      const items = await loadCandidateCache(key, () => api.lyricCandidates(songID));
      if (currentRef.current?.id === songID) setLyricCandidates(items);
    } catch {
      if (currentRef.current?.id === songID) setLyricCandidates([]);
    } finally {
      if (currentRef.current?.id === songID) setLyricCandidatesLoading(false);
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
      invalidateLyricCandidateCache([current.id]);
      setLyricCandidatesOpen(false);
      setProgress(0);
    } finally {
      setLyricsLoading(false);
    }
  }

  async function refreshLyricCandidates() {
    if (!current || lyricCandidatesLoading) return;
    const songID = current.id;
    setLyricCandidatesLoading(true);
    try {
      const items = await reloadCandidateCache(lyricCandidateCacheKey(songID), () => api.lyricCandidates(songID, true));
      if (currentRef.current?.id === songID) setLyricCandidates(items);
    } finally {
      if (currentRef.current?.id === songID) setLyricCandidatesLoading(false);
    }
  }

  function cyclePlayMode() {
    playUISound("click");
    setPlayMode((mode) =>
      mode === "sequence"
        ? "shuffle"
        : mode === "shuffle"
          ? "repeat-one"
          : "sequence",
    );
  }

  async function scan() {
    if (scanStatus?.running) {
      showMessage(t("scanning"));
      return;
    }
    showMessage(`${t("scanning")}...`, 0);
    let refreshBusy = false;
    let lastLibraryRefresh = 0;
    const refreshLibraryDuringScan = () => {
      const now = Date.now();
      if (refreshBusy || now - lastLibraryRefresh < 2000) return;
      refreshBusy = true;
      lastLibraryRefresh = now;
      void refreshLibraryDataOnly().finally(() => {
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
          canceled: result.canceled,
        },
      );
      showMessage(result.canceled
        ? t("scanCanceled")
        : `${t("done")}: +${result.added}, ↻${result.updated}, errors ${result.errors.length}`,
      );
      await refreshAll();
    } catch (error) {
      showMessage(error instanceof Error ? error.message : t("loadFailed"));
    } finally {
      window.clearInterval(poll);
    }
  }

  async function cancelScan() {
    await api.cancelScan().catch(() => undefined);
    const latest = await api.scanStatus().catch(() => null);
    if (latest) setScanStatus(latest);
    showMessage(t("scanCanceled"));
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
    if (
      nextSettings.transcode_quality_kbps !== settings.transcode_quality_kbps &&
      currentRef.current &&
      streamModeRef.current === "adaptive"
    ) {
      const audio = audioRef.current;
      const resumeAt = Math.max(0, streamOffsetRef.current + (audio?.currentTime || 0));
      resumeSeekRef.current = resumeAt;
      pendingAutoplayRef.current = playingRef.current || pendingAutoplayRef.current;
      setStreamOffset(resumeAt);
      setProgress(resumeAt);
      if (audio) {
        audio.pause();
        audio.currentTime = 0;
      }
      if (pendingAutoplayRef.current) setBuffering(true);
    }
    setSettings(nextSettings);
    const saved = await api.saveSettings(nextSettings).catch(() => nextSettings);
    setSettings({ ...defaultSettings, ...saved, theme: normalizeTheme(saved.theme) });
    setSmartPlaylists(await api.smartPlaylists().catch(() => []));
  }

  function updateSongState(updated: Song) {
    setFavoriteSongs((old) => {
      if (!updated.favorite) return old.filter((item) => item.id !== updated.id);
      const exists = old.some((item) => item.id === updated.id);
      return exists
        ? old.map((item) => (item.id === updated.id ? updated : item))
        : [updated, ...old];
    });
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

  function applyUpdatedSongs(updatedSongs: Song[]) {
    if (!updatedSongs.length) return;
    const byID = new Map(updatedSongs.map((item) => [item.id, item]));
    const replace = (items: Song[]) => items.map((item) => byID.get(item.id) || item);
    setSongs(replace);
    setRecentPlayedSongs(replace);
    setRecentAddedSongs(replace);
    setDailyMix(replace);
    setQueue(replace);
    setFavoriteSongs((old) => replace(old).filter((item) => item.favorite));
    setCurrent((old) => (old ? byID.get(old.id) || old : old));
    setCollection((old) => (old ? { ...old, songs: replace(old.songs) } : old));
  }

  function applyMetadataWritebackResult(result: MetadataWritebackResult, target: MetadataEditorTarget) {
    const affectedSongIDs = new Set<number>();
    if (target.type === "song") affectedSongIDs.add(target.song.id);
    else target.songs.forEach((song) => affectedSongIDs.add(song.id));
    if (result.song) affectedSongIDs.add(result.song.id);
    result.songs?.forEach((song) => affectedSongIDs.add(song.id));
    invalidateLyricCandidateCache([...affectedSongIDs]);
    if (result.song) {
      updateSongState(result.song);
    }
    if (result.songs?.length) {
      applyUpdatedSongs(result.songs);
    }
    if (result.albums?.length) {
      const updatedAlbums = result.albums;
      const byID = new Map(updatedAlbums.map((item) => [item.id, item]));
      setAlbums((old) => {
        const editedID = target.type === "album" ? target.album.id : 0;
        const filtered = old.filter((item) => item.id !== editedID && !byID.has(item.id));
        return [...updatedAlbums, ...filtered];
      });
      setFavoriteAlbums((old) => {
        const editedID = target.type === "album" ? target.album.id : 0;
        const filtered = old.filter((item) => item.id !== editedID && !byID.has(item.id));
        return [...updatedAlbums.filter((item) => item.favorite), ...filtered];
      });
      setCollection((old) => {
        if (!old || old.type !== "album" || target.type !== "album" || old.id !== target.album.id) return old;
        const nextAlbum = updatedAlbums[0];
        const nextSongs = result.songs?.length ? result.songs : old.songs;
        return {
          ...old,
          id: nextAlbum.id,
          title: nextAlbum.title,
          subtitle: [
            nextAlbum.artist,
            nextAlbum.year ? String(nextAlbum.year) : "",
            `${nextAlbum.song_count || nextSongs.length} ${t("count")}`,
          ].filter(Boolean).join(" · "),
          favorite: nextAlbum.favorite,
          songs: nextSongs,
          coverUrl: albumCoverUrl(nextAlbum),
          artistId: nextAlbum.artist_id,
          artistName: nextAlbum.artist,
        };
      });
    }
    if (result.album) {
      const updatedAlbum = result.album;
      setAlbums((old) => {
        const filtered = old.filter((item) => item.id !== updatedAlbum.id && !(target.type === "album" && item.id === target.album.id));
        return [updatedAlbum, ...filtered];
      });
      setFavoriteAlbums((old) => {
        const filtered = old.filter((item) => item.id !== updatedAlbum.id && !(target.type === "album" && item.id === target.album.id));
        return updatedAlbum.favorite ? [updatedAlbum, ...filtered] : filtered;
      });
      setCollection((old) => {
        if (!old || old.type !== "album") return old;
        const editingCurrentAlbum = target.type === "album" && (old.id === target.album.id || old.id === updatedAlbum.id);
        if (!editingCurrentAlbum) return old;
        const nextSongs = result.songs?.length ? result.songs : old.songs;
        return {
          ...old,
          id: updatedAlbum.id,
          title: updatedAlbum.title,
          subtitle: [
            updatedAlbum.artist,
            updatedAlbum.year ? String(updatedAlbum.year) : "",
            `${updatedAlbum.song_count || nextSongs.length} ${t("count")}`,
          ].filter(Boolean).join(" · "),
          favorite: updatedAlbum.favorite,
          songs: nextSongs,
          coverUrl: albumCoverUrl(updatedAlbum),
          artistId: updatedAlbum.artist_id,
          artistName: updatedAlbum.artist,
        };
      });
    }
  }

  function openSongMetadataEditor(song: Song) {
    setMetadataEditorTarget({ type: "song", song });
  }

  function openAlbumMetadataEditorFromCollection(item: Collection) {
    if (item.type !== "album" || !item.id) return;
    const cached = albums.find((album) => album.id === item.id);
    const fallback: Album = {
      id: item.id,
      title: item.title,
      artist_id: item.artistId || 0,
      artist: item.artistName || "",
      album_artist: cached?.album_artist || item.artistName || "",
      year: cached?.year || Number(item.subtitle.match(/\b\d{4}\b/)?.[0] || 0),
      favorite: Boolean(item.favorite),
      song_count: item.songs.length || cached?.song_count || 0,
      cover_version: cached?.cover_version,
    };
    setMetadataEditorTarget({ type: "album", album: cached || fallback, songs: item.songs });
  }

  async function toggleFavorite(song: Song) {
    const updated = await api.favoriteSong(song.id);
    updateSongState(updated);
    playUISound(updated.favorite ? "favorite" : "toggleOff");
  }

  function openShareDialog(type: ShareTarget["type"], id: number, title: string) {
    playUISound("share");
    setShareDialogTarget({ type, id, title });
  }

  function updateAlbumFavoriteState(updated: Album, previousFavorite?: boolean) {
    const mutationEpoch = ++albumFavoriteMutationRef.current;
    albumFavoriteStateRef.current.set(updated.id, { favorite: updated.favorite, mutationEpoch });
    const committed = albumBrowseCommittedRef.current;
    if (committed) {
      const matchesArtist = committed.query.artistID <= 0 || committed.query.artistID === updated.artist_id;
      const favoriteChanged = previousFavorite != null && previousFavorite !== updated.favorite;
      const items = committed.data.items
        .map((item) => (item.id === updated.id ? updated : item))
        .filter((item) => !committed.query.favoritesOnly || item.favorite);
      const total = committed.query.favoritesOnly && matchesArtist && favoriteChanged
        ? Math.max(0, committed.data.total + (updated.favorite ? 1 : -1))
        : committed.data.total;
      const data = { ...committed.data, items, total };
      albumBrowseCommittedRef.current = { ...committed, data };
      setAlbumPageData(data);
    }
    setFavoriteAlbums((old) => {
      if (!updated.favorite) return old.filter((item) => item.id !== updated.id);
      const exists = old.some((item) => item.id === updated.id);
      return exists
        ? old.map((item) => (item.id === updated.id ? updated : item))
        : [updated, ...old];
    });
    setShellAlbumPageData((old) => old
      ? { ...old, items: old.items.map((item) => (item.id === updated.id ? updated : item)) }
      : old);
    setAlbums((old) => mergeAlbums(old, [updated]));
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

  function clampCommittedAlbumFavoritePage() {
    const committed = albumBrowseCommittedRef.current;
    if (!committed?.query.favoritesOnly) return;
    const lastPage = Math.max(1, Math.ceil(committed.data.total / Math.max(1, committed.data.limit)));
    if (committed.query.page <= lastPage) return;
    const query = { ...committed.query, page: lastPage };
    commitAlbumBrowsePage({
      ...committed.data,
      items: [],
      page: lastPage,
      offset: (lastPage - 1) * committed.data.limit,
    }, query);
  }

  async function reconcileFavoriteAlbumPage() {
    const query = { ...albumBrowseIntentRef.current };
    if (!query.favoritesOnly) return;
    try {
      await loadAlbumPage(query.page, query.artistID, true, query.artistName);
    } catch {
      const committed = albumBrowseCommittedRef.current;
      if (committed && sameAlbumBrowseQuery(committed.query, albumBrowseIntentRef.current)) {
        const lastPage = Math.max(1, Math.ceil(committed.data.total / Math.max(1, committed.data.limit)));
        if (query.page > lastPage) {
          try {
            await loadAlbumPage(lastPage, query.artistID, true, query.artistName);
            return;
          } catch {
            clampCommittedAlbumFavoritePage();
            showMessage(t("favoriteFilterFailed"));
            return;
          }
        }
      }
      if (!committed || !sameAlbumBrowseQuery(committed.query, albumBrowseIntentRef.current)) {
        restoreAlbumBrowse(query);
      } else {
        clampCommittedAlbumFavoritePage();
      }
      showMessage(t("favoriteFilterFailed"));
    }
  }

  async function toggleAlbumFavoriteById(id: number, initialFavorite?: boolean) {
    const expectedUserID = auth?.user?.id ?? 0;
    if (!id || !expectedUserID) return;
    if (albumFavoriteQueueRef.current.has(id)) {
      if (albumFavoriteRepeatRef.current.has(id)) albumFavoriteRepeatRef.current.delete(id);
      else albumFavoriteRepeatRef.current.add(id);
      return;
    }
    const session = favoriteSessionRef.current;
    let lastUpdated: Album | null = null;
    const mutation = (async () => {
      let previousFavorite = albumFavoriteStateRef.current.get(id)?.favorite ?? initialFavorite;
      let updated: Album | null = null;
      do {
        if (session !== favoriteSessionRef.current) return null;
        const targetFavorite = !previousFavorite;
        const controller = new AbortController();
        updated = await loadWithTimeout(
          (signal) => api.favoriteAlbum(id, targetFavorite, expectedUserID, signal),
          controller,
        );
        if (session !== favoriteSessionRef.current) return null;
        updateAlbumFavoriteState(updated, previousFavorite);
        lastUpdated = updated;
        previousFavorite = updated.favorite;
        playUISound(updated.favorite ? "favorite" : "toggleOff");
      } while (albumFavoriteRepeatRef.current.delete(id));
      return updated;
    })();
    albumFavoriteQueueRef.current.set(id, mutation);
    try {
      lastUpdated = await mutation;
    } catch {
      if (session === favoriteSessionRef.current) showMessage(t("favoriteUpdateFailed"));
    } finally {
      if (albumFavoriteQueueRef.current.get(id) === mutation) {
        albumFavoriteQueueRef.current.delete(id);
        albumFavoriteRepeatRef.current.delete(id);
      }
    }
    if (lastUpdated) await reconcileFavoriteAlbumPage();
  }

  async function toggleAlbumFavorite(album: Album) {
    await toggleAlbumFavoriteById(album.id, album.favorite);
  }

  function updateArtistFavoriteState(updated: Artist, previousFavorite?: boolean) {
    const mutationEpoch = ++artistFavoriteMutationRef.current;
    artistFavoriteStateRef.current.set(updated.id, { favorite: updated.favorite, mutationEpoch });
    const committed = artistBrowseCommittedRef.current;
    if (committed) {
      const matchesInitial = !committed.query.initial || committed.query.initial === updated.initial;
      const favoriteChanged = previousFavorite != null && previousFavorite !== updated.favorite;
      const items = committed.data.items
        .map((item) => (item.id === updated.id ? updated : item))
        .filter((item) => !committed.query.favoritesOnly || item.favorite);
      const total = committed.query.favoritesOnly && matchesInitial && favoriteChanged
        ? Math.max(0, committed.data.total + (updated.favorite ? 1 : -1))
        : committed.data.total;
      let initials = committed.data.initials;
      if (committed.query.favoritesOnly && favoriteChanged && updated.favorite && updated.initial) {
        initials = Array.from(new Set([...initials, updated.initial])).sort();
      } else if (
        committed.query.favoritesOnly &&
        favoriteChanged &&
        !updated.favorite &&
        total === 0
      ) {
        initials = committed.query.initial
          ? initials.filter((initial) => initial !== updated.initial)
          : [];
      }
      const data = { ...committed.data, items, total, initials };
      artistBrowseCommittedRef.current = { ...committed, data };
      setArtistPageData(data);
    }
    setArtists((old) => mergeArtists(old, [updated]));
    setFavoriteArtists((old) => {
      if (!updated.favorite) return old.filter((item) => item.id !== updated.id);
      const exists = old.some((item) => item.id === updated.id);
      return exists
        ? old.map((item) => (item.id === updated.id ? updated : item))
        : [updated, ...old];
    });
    setCollection((old) =>
      old?.type === "artist" && old.id === updated.id
        ? { ...old, favorite: updated.favorite, title: updated.name }
        : old,
    );
  }

  function clampCommittedArtistFavoritePage() {
    const committed = artistBrowseCommittedRef.current;
    if (!committed?.query.favoritesOnly) return;
    const lastPage = Math.max(1, Math.ceil(committed.data.total / Math.max(1, committed.data.limit)));
    if (committed.query.page <= lastPage) return;
    const query = { ...committed.query, page: lastPage };
    commitArtistBrowsePage({
      ...committed.data,
      items: [],
      page: lastPage,
      offset: (lastPage - 1) * committed.data.limit,
    }, query);
  }

  async function reconcileFavoriteArtistPage() {
    const query = { ...artistBrowseIntentRef.current };
    if (!query.favoritesOnly) return;
    try {
      await loadArtistPage(query.page, query.initial, true);
    } catch {
      const committed = artistBrowseCommittedRef.current;
      if (committed && sameArtistBrowseQuery(committed.query, artistBrowseIntentRef.current)) {
        const lastPage = Math.max(1, Math.ceil(committed.data.total / Math.max(1, committed.data.limit)));
        if (query.page > lastPage) {
          try {
            await loadArtistPage(lastPage, query.initial, true);
            return;
          } catch {
            clampCommittedArtistFavoritePage();
            showMessage(t("favoriteFilterFailed"));
            return;
          }
        }
      }
      if (!committed || !sameArtistBrowseQuery(committed.query, artistBrowseIntentRef.current)) {
        restoreArtistBrowse(query);
      } else {
        clampCommittedArtistFavoritePage();
      }
      showMessage(t("favoriteFilterFailed"));
    }
  }

  async function toggleArtistFavoriteById(id: number, initialFavorite?: boolean) {
    const expectedUserID = auth?.user?.id ?? 0;
    if (!id || !expectedUserID) return;
    if (artistFavoriteQueueRef.current.has(id)) {
      if (artistFavoriteRepeatRef.current.has(id)) artistFavoriteRepeatRef.current.delete(id);
      else artistFavoriteRepeatRef.current.add(id);
      return;
    }
    const session = favoriteSessionRef.current;
    let lastUpdated: Artist | null = null;
    const mutation = (async () => {
      let previousFavorite = artistFavoriteStateRef.current.get(id)?.favorite ?? initialFavorite;
      let updated: Artist | null = null;
      do {
        if (session !== favoriteSessionRef.current) return null;
        const targetFavorite = !previousFavorite;
        const controller = new AbortController();
        updated = await loadWithTimeout(
          (signal) => api.favoriteArtist(id, targetFavorite, expectedUserID, signal),
          controller,
        );
        if (session !== favoriteSessionRef.current) return null;
        updateArtistFavoriteState(updated, previousFavorite);
        lastUpdated = updated;
        previousFavorite = updated.favorite;
        playUISound(updated.favorite ? "favorite" : "toggleOff");
      } while (artistFavoriteRepeatRef.current.delete(id));
      return updated;
    })();
    artistFavoriteQueueRef.current.set(id, mutation);
    try {
      lastUpdated = await mutation;
    } catch {
      if (session === favoriteSessionRef.current) showMessage(t("favoriteUpdateFailed"));
    } finally {
      if (artistFavoriteQueueRef.current.get(id) === mutation) {
        artistFavoriteQueueRef.current.delete(id);
        artistFavoriteRepeatRef.current.delete(id);
      }
    }
    if (lastUpdated) await reconcileFavoriteArtistPage();
  }

  async function toggleArtistFavorite(artistItem: Artist) {
    await toggleArtistFavoriteById(artistItem.id, artistItem.favorite);
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
    playUISound(updated.favorite ? "favorite" : "toggleOff");
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
      playUISound("success");
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
    playUISound("success");
    setPlaylists(await api.playlists());
  }

  function isSameCollection(left: Collection, right: Collection | null): right is Collection {
    return Boolean(right && left.type === right.type && left.id === right.id);
  }

  async function fetchCollectionSongs(target: Collection, limit = 0) {
    if (!target.id) return [];
    if (target.type === "playlist") return withTimeout(api.playlistSongs(target.id, limit));
    if (target.type === "album") return withTimeout(api.albumSongs(target.id, limit));
    return withTimeout(api.artistSongs(target.id, limit));
  }

  function playbackSourceForCollection(target: Collection): PlaybackSourceInput | undefined {
    if (!target.id || (target.type !== "album" && target.type !== "artist" && target.type !== "playlist")) return undefined;
    return { type: target.type, source_id: target.id };
  }

  async function playCollection(target: Collection) {
    const items = target.songs.length
      ? target.songs
      : await fetchCollectionSongs(target, MAX_PLAYBACK_QUEUE_SIZE);
    const source = playbackSourceForCollection(target);
    if (items[0]) void playSong(items[0], items, source ? { source } : {});
  }

  async function insertCollectionNext(target: Collection) {
    const items = target.songs.length
      ? target.songs
      : await fetchCollectionSongs(target, MAX_PLAYBACK_QUEUE_SIZE);
    if (items.length) insertNextBatch(items);
  }

  // beginCollectionRequest starts a fresh collection load: it aborts any in-flight
  // previous load (so rapid artist/album navigation doesn't stack orphaned requests
  // that compound server load) and bumps the request id used to ignore stale results.
  function invalidateCollectionRequest() {
    collectionRequestRef.current += 1;
    collectionAbortRef.current?.abort();
    collectionAbortRef.current = null;
  }

  function beginCollectionRequest(): { requestId: number; controller: AbortController } {
    collectionAbortRef.current?.abort();
    const controller = new AbortController();
    collectionAbortRef.current = controller;
    const requestId = ++collectionRequestRef.current;
    return { requestId, controller };
  }

  function setCollectionLoadError(target: Collection, requestId: number, error: unknown) {
    if (requestId !== collectionRequestRef.current) return;
    if (isAbortError(error)) return; // superseded/cancelled load — not a real failure
    const message = friendlyLoadError(error, t as (key: string) => string);
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
    const { requestId, controller } = beginCollectionRequest();
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
      const items = await loadWithTimeout((signal) => api.playlistSongs(playlist.id, COLLECTION_DETAIL_SONG_LIMIT, signal), controller);
      if (requestId !== collectionRequestRef.current) return;
      setCollection({
        type: "playlist",
        id: playlist.id,
        title: playlist.name,
        subtitle: `${playlist.song_count || items.length} ${t("count")}`,
        favorite: playlist.favorite,
        songs: items,
        coverUrl: items[0] ? coverUrl(items[0]) : undefined,
      });
    } catch (error) {
      setCollectionLoadError(nextCollection, requestId, error);
    }
  }

  async function openSmartPlaylist(playlist: SmartPlaylist) {
    if (!playlist.enabled) return;
    const label = smartPlaylistLabel(playlist.id, settings.language);
    setCollectionBack(null);
    const { requestId } = beginCollectionRequest();
    const nextCollection: Collection = {
      type: "playlist",
      id: 0,
      title: label.title,
      subtitle: t("loading"),
      loading: true,
      favorite: false,
      songs: [],
    };
    setCollection(nextCollection);
    setView("collection");
    try {
      const items = await withTimeout(api.smartPlaylistSongs(playlist.id, COLLECTION_DETAIL_SONG_LIMIT));
      if (requestId !== collectionRequestRef.current) return;
      setCollection({
        type: "playlist",
        id: 0,
        title: label.title,
        subtitle: `${items.length} ${t("count")}`,
        favorite: false,
        songs: items,
        coverUrl: items[0] ? coverUrl(items[0]) : undefined,
      });
    } catch (error) {
      setCollectionLoadError(nextCollection, requestId, error);
    }
  }

  async function openAlbum(album: Album, backTo: Collection | null = null) {
    setCollectionBack(backTo);
    const { requestId, controller } = beginCollectionRequest();
    const albumRequestMutationEpoch = albumFavoriteMutationRef.current;
    const initialFavorite = albumFavoriteStateRef.current.get(album.id)?.favorite ?? album.favorite;
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
      favorite: initialFavorite,
      coverUrl: albumCoverUrl(album),
      artistId: album.artist_id,
      artistName: album.artist,
      songs: [],
    };
    setCollection(nextCollection);
    setView("collection");
    try {
      const [items, refreshedAlbum] = await Promise.all([
        loadWithTimeout((signal) => api.albumSongs(album.id, COLLECTION_DETAIL_SONG_LIMIT, signal), controller, COLLECTION_LOAD_TIMEOUT_MS),
        api.album(album.id, controller.signal).catch(() => null),
      ]);
      if (requestId !== collectionRequestRef.current) return;
      const resolvedAlbum = applyAlbumFavoriteOverrides(
        [refreshedAlbum ?? album],
        refreshedAlbum ? albumRequestMutationEpoch : undefined,
      )[0];
      setAlbums((old) => old.map((item) =>
        item.id === resolvedAlbum.id ? resolvedAlbum : item,
      ));
      setCollection({
        type: "album",
        id: resolvedAlbum.id,
        title: resolvedAlbum.title,
        subtitle: [
          resolvedAlbum.artist,
          resolvedAlbum.year ? String(resolvedAlbum.year) : "",
          `${resolvedAlbum.song_count || items.length} ${t("count")}`,
        ].filter(Boolean).join(" · "),
        favorite: resolvedAlbum.favorite,
        songs: items,
        coverUrl: albumCoverUrl(resolvedAlbum),
        artistId: resolvedAlbum.artist_id,
        artistName: resolvedAlbum.artist,
      });
    } catch (error) {
      setCollectionLoadError(nextCollection, requestId, error);
    }
  }

  async function openSongAlbum(song: Song, backTo: Collection | null = null) {
    if (!song.album_id) return;
    const cached = albums.find((item) => item.id === song.album_id);
    if (cached) {
      await openAlbum(cached, backTo);
      return;
    }
    const item = await api.album(song.album_id);
    await openAlbum(item, backTo);
  }

  async function openArtistById(id: number, fallbackName = "") {
    if (!id) return;
    setCollectionBack(null);
    const { requestId, controller } = beginCollectionRequest();
    const artist = artists.find((item) => item.id === id) ?? favoriteArtists.find((item) => item.id === id);
    const title = artist?.name || fallbackName || t("artists");
    const artistAlbums = albums.filter((album) => album.artist_id === id && album.song_count > 0);
    const albumRequestMutationEpoch = albumFavoriteMutationRef.current;
    const artistRequestMutationEpoch = artistFavoriteMutationRef.current;
    const initialFavorite = artistFavoriteStateRef.current.get(id)?.favorite ?? artist?.favorite ?? false;
    const nextCollection: Collection = {
      type: "artist",
      id,
      title,
      subtitle: t("loading"),
      loading: true,
      favorite: initialFavorite,
      songs: [],
      albums: artistAlbums,
      coverUrl: `/api/artists/${id}/cover`,
      artistId: id,
      artistName: title,
    };
    setCollection(nextCollection);
    setView("collection");
    try {
      const [items, artistAlbumPage, refreshedArtist] = await Promise.all([
        loadWithTimeout((signal) => api.artistSongs(id, COLLECTION_DETAIL_SONG_LIMIT, signal), controller),
        api.albumsPage(1, MAX_GRID_PAGE_SIZE, id, controller.signal).catch(() => null),
        api.artist(id, controller.signal),
      ]);
      if (requestId !== collectionRequestRef.current) return;
      const resolvedArtist = applyArtistFavoriteOverrides(
        [refreshedArtist],
        artistRequestMutationEpoch,
      )[0];
      const resolvedTitle =
        resolvedArtist.name || fallbackName || items[0]?.artist || t("artists");
      const resolvedAlbums = applyAlbumFavoriteOverrides(
        artistAlbumPage?.items ?? albumsFromSongs(items, id, resolvedTitle),
        artistAlbumPage ? albumRequestMutationEpoch : undefined,
      );
      setCollection({
        type: "artist",
        id,
        title: resolvedTitle,
        subtitle: `${resolvedArtist.song_count || items.length} ${t("count")}`,
        favorite: resolvedArtist.favorite,
        songs: items,
        albums: resolvedAlbums,
        coverUrl: `/api/artists/${id}/cover`,
        artistId: id,
        artistName: resolvedTitle,
      });
      setArtists((old) => mergeArtists(old, [resolvedArtist]));
      if (artistAlbumPage?.items.length) {
        const resolvedByID = new Map(resolvedAlbums.map((item) => [item.id, item]));
        setAlbums((old) => old.map((item) => resolvedByID.get(item.id) ?? item));
      }
    } catch (error) {
      setCollectionLoadError(nextCollection, requestId, error);
    }
  }

  // retryCurrentCollection re-opens whatever collection is currently shown, used by the
  // error-state retry button so a timed-out artist/album/playlist load can be retried in
  // place without navigating away.
  async function retryCurrentCollection() {
    if (!collection?.id) return;
    if (collection.type === "artist") {
      void openArtistById(collection.id, collection.title);
      return;
    }
    if (collection.type === "album") {
      const cached = albums.find((item) => item.id === collection.id);
      if (cached) {
        void openAlbum(cached, collectionBack);
        return;
      }
      try {
        void openAlbum(await api.album(collection.id), collectionBack);
      } catch {
        /* ignore — error surfaces via the normal load path */
      }
      return;
    }
    if (collection.type === "playlist") {
      const cached = playlists.find((item) => item.id === collection.id);
      if (cached) void openPlaylist(cached);
    }
  }

  async function playAlbum(album: Album) {
    const items = await api.albumSongs(album.id, MAX_PLAYBACK_QUEUE_SIZE);
    if (items[0]) void playSong(items[0], items, { source: { type: "album", source_id: album.id } });
  }

  async function cacheCollectionOffline(target: Collection) {
    const source =
      target.songs.length
        ? target.songs
        : target.type === "album" && target.id
          ? await api.albumSongs(target.id)
        : [];
    await cacheSongsOffline(source);
  }

  async function playArtist(artist: Artist) {
    const items = await api.artistSongs(artist.id, MAX_PLAYBACK_QUEUE_SIZE);
    if (items[0]) void playSong(items[0], items, { source: { type: "artist", source_id: artist.id } });
  }

  async function playPlaylist(playlist: Playlist) {
    const items = await api.playlistSongs(playlist.id, MAX_PLAYBACK_QUEUE_SIZE);
    if (items[0]) void playSong(items[0], items, { source: { type: "playlist", source_id: playlist.id } });
  }

  async function playSmartPlaylist(playlist: SmartPlaylist) {
    if (!playlist.enabled) return;
    const items = await api.smartPlaylistSongs(playlist.id, MAX_PLAYBACK_QUEUE_SIZE);
    if (items[0]) void playSong(items[0], items);
  }

  async function playFolder(folder: Folder) {
    const items = await api.folderSongs(folder.path, MAX_PLAYBACK_QUEUE_SIZE);
    if (items[0]) void playSong(items[0], items);
  }

  const playbackNav: { id: View; label: string; icon: ReactNode }[] = [
    { id: "home", label: t("home"), icon: <House /> },
    { id: "history", label: t("history"), icon: <ClockCounterClockwise /> },
    { id: "favorites", label: t("favorites"), icon: <Heart /> },
    { id: "library", label: t("library"), icon: <MusicNotes /> },
    { id: "playlists", label: t("playlists"), icon: <PlaylistIcon /> },
    { id: "albums", label: t("albums"), icon: <Disc /> },
    { id: "artists", label: t("artists"), icon: <Record /> },
  ];
  const desktopNav: { id: View; label: string; icon: ReactNode }[] = [
    ...playbackNav,
    { id: "settings", label: t("settings"), icon: <GearSix /> },
    ...(settings.sharing_enabled ? [{ id: "shares" as const, label: t("myShares"), icon: <ShareNetwork /> }] : []),
    { id: "about", label: t("about"), icon: <Info /> },
  ];
  const openNavigationView = (id: View) => {
    setLyricsFullScreen(false);
    setMobilePlayerExpanded(false);
    setView(id);
    if (id === "library") void loadLibrarySongsPage(1);
    if (id === "playlists") void loadPlaylistPage(1);
    if (id === "albums") void requestAlbumPage(1);
    if (id === "artists") void requestArtistPage(1);
  };
  const activeNav = (id: View) =>
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
  const heroSong = current ?? (resumePosition(recentPlayedSongs[0]) ? recentPlayedSongs[0] : null);
  const playModeLabel =
    playMode === "sequence"
      ? t("playModeSequence")
      : playMode === "shuffle"
        ? t("playModeShuffle")
        : playMode === "repeat-one"
          ? t("playModeRepeatOne")
          : playMode === "order"
            ? t("playModeOrder")
            : t("playModeSinglePlay");
  const playableDuration = duration || current?.duration_seconds || currentNetworkTrack?.duration_seconds || 0;
  const playedPercent = playableDuration
    ? `${Math.min(100, Math.max(0, (progress / playableDuration) * 100))}%`
    : "0%";
  const bufferedPercent = playableDuration
    ? `${Math.min(100, Math.max(0, (bufferedEnd / playableDuration) * 100))}%`
    : "0%";
  const mobileLibraryActive =
    view === "library" ||
    view === "playlists" ||
    view === "albums" ||
    view === "artists" ||
    view === "radio" ||
    view === "collection";
  const mobileFallbackSong = heroSong ?? recentAddedSongs[0] ?? dailyMix[0] ?? songs[0] ?? null;
  const mobileDisplaySong = current ?? (!currentRadio && !currentNetworkTrack ? mobileFallbackSong : null);
  const mobilePlayerAvailable = Boolean(currentRadio || currentNetworkTrack || mobileDisplaySong);
  useEffect(() => {
    if (!mobilePlayerAvailable && mobilePlayerExpanded) setMobilePlayerExpanded(false);
  }, [mobilePlayerAvailable, mobilePlayerExpanded]);
  const mobileMyActive =
    view === "my" ||
    view === "history" ||
    view === "favorites" ||
    view === "settings" ||
    view === "about";
  const mobileBottomNavItems = [
    { key: "home", label: t("home"), icon: <House />, active: !mobilePlayerExpanded && view === "home", onSelect: () => openNavigationView("home") },
    { key: "library", label: t("library"), icon: <MusicNotes />, active: !mobilePlayerExpanded && mobileLibraryActive, onSelect: () => openNavigationView("library") },
    {
      key: "player",
      label: t("playback"),
      icon: <Play />,
      active: mobilePlayerExpanded || lyricsFullScreen,
      disabled: !mobilePlayerAvailable,
      onSelect: () => {
        if (!mobilePlayerAvailable) return;
        setLyricsFullScreen(false);
        setMobilePlayerExpanded(true);
      },
    },
    { key: "my", label: t("my"), icon: <UserCircle />, active: !mobilePlayerExpanded && mobileMyActive, onSelect: () => openNavigationView("my") },
  ];
  const screenTitle =
    collection && view === "collection"
      ? collection.title
      : view === "my"
        ? t("my")
      : view === "settings"
        ? t("settings")
        : (playbackNav.find((item) => item.id === view)?.label ?? t("brand"));
  const topbarHasScreenTitle = !([
    "favorites",
    "library",
    "playlists",
    "albums",
    "artists",
    "collection",
    "my",
  ] as View[]).includes(view);
  const showTopbarScreenTitle = topbarHasScreenTitle && !(mobileViewport && view === "home");
  const showUserMenu = view !== "settings" && !mobileViewport;
  const albumCacheByID = new Map(albums.map((item) => [item.id, item]));
  const artistCacheByID = new Map(artists.map((item) => [item.id, item]));
  const albumBrowseItems = (albumPageData?.items ?? albums)
    .map((item) => albumCacheByID.get(item.id) ?? item);
  const artistBrowseItems = (artistPageData?.items ?? artists)
    .map((item) => artistCacheByID.get(item.id) ?? item);
  const displayedAlbums = albumFavoritesOnly
    ? albumBrowseItems.filter((item) => item.favorite)
    : albumBrowseItems;
  const displayedArtists = artistFavoritesOnly
    ? artistBrowseItems.filter((item) => item.favorite)
    : artistBrowseItems;
  const currentAlbum =
    current && current.album_id
      ? albums.find((item) => item.id === current.album_id)
      : undefined;
  const currentArtwork = coverUrl(current) || currentNetworkTrack?.cover_url || "";
  const playerStyle = currentArtwork
    ? ({ "--cover-url": `url(${currentArtwork})` } as React.CSSProperties)
    : undefined;
  const mobilePlaybackActive = Boolean(current || currentRadio || currentNetworkTrack);
  const toggleMobilePlayback = () => {
    if (!mobilePlaybackActive && mobileDisplaySong) {
      if (resumePosition(mobileDisplaySong) > 0) void resumePlayback(mobileDisplaySong);
      else void playSong(mobileDisplaySong, songs);
      return;
    }
    void togglePlaybackOutput();
  };
  const currentOfflineEntry = current ? findOfflineSongEntry(offlineIndex, current.id, settings.transcode_quality_kbps) : undefined;
  const shouldUseOfflineAudio = Boolean(currentOfflineEntry && shouldPreferOfflinePlayback(offlineMode, networkReachable));
  const currentStreamUrl =
    currentRadio?.url ||
    currentNetworkTrack?.stream_url ||
    (shouldUseOfflineAudio
      ? currentOfflineEntry?.audio_url
      : streamUrl(current, streamMode, streamOffset, settings.transcode_quality_kbps));
  const canFavoriteCurrent = Boolean(current || currentRadio);
  const toggleCurrentFavorite = () => {
    if (currentRadio) void toggleRadioFavorite(currentRadio);
    else if (current) void toggleFavorite(current);
  };
  const offlineCacheControls: OfflineCacheControls = {
    cachedSongIds: offlineCachedIds,
    cachingSongIds: offlineCachingIds,
    entries: offlineEntries,
    usage: offlineUsage,
    clearing: offlineClearing,
    removingKeys: offlineRemovingKeys,
    onCacheSong: (song) => void cacheSongOffline(song),
    onCacheSongs: (items) => void cacheSongsOffline(items),
    onRemoveSong: (entry) => void removeOfflineCachedSong(entry),
    onClearAll: () => void clearOfflineCacheData(),
  };
  const pluginHostTheme = themes.find((theme) => theme.id === settings.theme)?.mode ?? "dark";
  const songloftPlayMode = toSongloftPlayMode(playMode);
  const pluginHostPlayerState: SongloftPlayerState = {
    queue,
    current_index: current ? queue.findIndex((song) => song.id === current.id) : -1,
    current_song: current,
    is_playing: remoteDLNAPlaying || playing,
    current_time: progress,
    duration: duration || current?.duration_seconds || 0,
    volume: Math.round(volume * 100),
    play_mode: songloftPlayMode,
    source_playlist_id: playbackSessionSourceRef.current?.type === "playlist"
      ? playbackSessionSourceRef.current.source_id
      : null,
  };

  async function handlePluginHostCall(call: SongloftHostCall): Promise<unknown> {
    const { ns, method, params } = call;
    const numberParam = (name: string) => {
      const value = params[name];
      if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${name} must be a number`);
      return value;
    };
    const songIDs = (value: unknown) => {
      if (!Array.isArray(value)) return [];
      return value
        .filter((id): id is number => typeof id === "number" && Number.isInteger(id) && id > 0)
        .slice(0, MAX_PLAYBACK_QUEUE_SIZE);
    };

    if (ns === "host" && method === "getInfo") {
      return { version: health?.version || "lark", platform: "web", capabilities: ["player", "favorite"] };
    }
    if (ns === "cookies") {
      throw new Error("getCookies is not available on the web platform");
    }
    if (ns === "favorite" && method === "refresh") {
      const songID = numberParam("songId");
      const refreshed = await api.song(songID);
      updateSongState(refreshed);
      return null;
    }
    if (ns !== "player") throw new Error(`unknown namespace: ${ns}`);

    switch (method) {
      case "getState":
        return pluginHostPlayerState;
      case "setQueue": {
        const resolved = await songsForPlaybackQueueIDs(songIDs(params.ids));
        if (!resolved.length) throw new Error("no valid songs resolved");
        const rawIndex = typeof params.startIndex === "number" ? Math.trunc(params.startIndex) : 0;
        const startIndex = Math.max(0, Math.min(resolved.length - 1, rawIndex));
        const sourcePlaylistID = typeof params.sourcePlaylistId === "number" && Number.isInteger(params.sourcePlaylistId)
          ? params.sourcePlaylistId
          : 0;
        await playSong(resolved[startIndex], resolved, sourcePlaylistID > 0
          ? { source: { type: "playlist", source_id: sourcePlaylistID } }
          : {});
        return null;
      }
      case "addToQueue": {
        const resolved = await songsForPlaybackQueueIDs(songIDs(params.ids));
        setQueue((existing) => uniqueSongs([...existing, ...resolved], MAX_PLAYBACK_QUEUE_SIZE));
        return null;
      }
      case "insertToQueue": {
        const index = Math.trunc(numberParam("index"));
        const [song] = await songsForPlaybackQueueIDs([Math.trunc(numberParam("id"))]);
        if (!song) throw new Error("song not found");
        setQueue((existing) => {
          const next = existing.filter((item) => item.id !== song.id);
          next.splice(Math.max(0, Math.min(next.length, index)), 0, song);
          return next.slice(0, MAX_PLAYBACK_QUEUE_SIZE);
        });
        return null;
      }
      case "removeFromQueue": {
        const index = Math.trunc(numberParam("index"));
        const existing = queueRef.current;
        if (index < 0 || index >= existing.length) throw new Error("queue index out of range");
        const nextQueue = existing.filter((_, itemIndex) => itemIndex !== index);
        const removedCurrent = existing[index]?.id === currentRef.current?.id;
        if (removedCurrent && nextQueue.length) {
          await playSong(nextQueue[Math.min(index, nextQueue.length - 1)], nextQueue, { keepPlaybackSource: true });
        } else {
          setQueue(nextQueue);
          if (removedCurrent) {
            audioRef.current?.pause();
            setCurrent(null);
            setPlaying(false);
            clearPersistentPlaybackSession();
          }
        }
        return null;
      }
      case "reorderQueue": {
        const oldIndex = Math.trunc(numberParam("oldIndex"));
        const newIndex = Math.trunc(numberParam("newIndex"));
        setQueue((existing) => {
          if (oldIndex < 0 || oldIndex >= existing.length || newIndex < 0 || newIndex >= existing.length) return existing;
          const reordered = [...existing];
          const [moved] = reordered.splice(oldIndex, 1);
          reordered.splice(newIndex, 0, moved);
          return reordered;
        });
        return null;
      }
      case "clearQueue":
        audioRef.current?.pause();
        setQueue([]);
        setCurrent(null);
        setPlaying(false);
        clearPersistentPlaybackSession();
        return null;
      case "play": {
        if (typeof params.id === "number") {
          const [song] = await songsForPlaybackQueueIDs([Math.trunc(params.id)]);
          if (!song) throw new Error("song not found");
          const activeQueue = queueRef.current.some((item) => item.id === song.id) ? queueRef.current : [song];
          await playSong(song, activeQueue, { keepPlaybackSource: activeQueue.length > 1 });
        } else if (currentRef.current) {
          await ensurePlaybackOutputPlaying();
        }
        return null;
      }
      case "pause":
        await ensurePlaybackOutputPaused();
        return null;
      case "togglePlay":
        await togglePlaybackOutput();
        return null;
      case "next":
        next(1);
        return null;
      case "prev":
        next(-1);
        return null;
      case "seek":
        seekTo(numberParam("seconds"));
        return null;
      case "setVolume":
        updateVolume(numberParam("volume") / 100);
        return null;
      case "setPlayMode": {
        const mode = params.mode;
        if (mode !== "order" && mode !== "loop" && mode !== "single" && mode !== "random" && mode !== "singlePlay") {
          throw new Error("invalid play mode");
        }
        setPlayMode(fromSongloftPlayMode(mode as SongloftPlayMode));
        return null;
      }
      case "playPlaylistById": {
        const playlistID = Math.trunc(numberParam("playlistId"));
        const items = await api.playlistSongs(playlistID, MAX_PLAYBACK_QUEUE_SIZE);
        if (!items.length) throw new Error("playlist has no songs");
        await playSong(items[0], items, { source: { type: "playlist", source_id: playlistID } });
        return null;
      }
      default:
        throw new Error(`unknown player method: ${method}`);
    }
  }
  const nowTitle = current?.title ?? currentNetworkTrack?.title ?? currentRadio?.name ?? t("nowPlaying");
  const radioDownloadSpeed = radioDownloadKbps > 0 ? `${t("downloadSpeed")} ${formatDownloadSpeed(radioDownloadKbps)}` : "";
  const nowSubtitle = currentRadio
    ? [currentRadio.country, currentRadio.codec || currentRadio.tags, currentRadio.bitrate ? `${currentRadio.bitrate}kbps` : "", radioDownloadSpeed].filter(Boolean).join(" · ")
    : currentNetworkTrack
      ? [t("networkLibrary"), currentNetworkTrack.provider, currentNetworkTrack.artist, currentNetworkTrack.album].filter(Boolean).join(" · ")
      : "";
  const playerPlaying = remoteDLNAPlaying || playing;
  const dlnaCastLabel = remoteDLNAActive && dlnaStatus?.device_name
    ? `${t("playingOnDevice")} ${dlnaStatus.device_name}`
    : t("playToDevice");
  const radioPanelStations = useMemo(() => {
    const inferredGroupQueue = currentRadio ? radioQueueForStation(currentRadio) : [];
    const base = uniqueRadioStations([
      ...radioQueue,
      ...inferredGroupQueue,
      ...(radioQueue.length || inferredGroupQueue.length
        ? []
        : radioStations.length
          ? radioStations
          : radioSources.map(radioSourceToStation)),
    ]);
    const out: RadioStation[] = [];
    const add = (station: RadioStation | null | undefined) => {
      if (!station?.url) return;
      const playable = radioStationToPlayable(station);
      if (out.some((item) => sameRadioStation(item, playable))) return;
      out.push(playable);
    };
    add(currentRadio);
    base.forEach(add);
    return out;
  }, [currentRadio, radioQueue, radioSources, radioStations]);
  const queuePanelMode = currentRadio ? "radio" : "songs";
  const mobilePlayerLabels = {
    nowPlaying: t("nowPlaying"),
    position: t("position"),
    volume: t("volume"),
    previous: t("previous"),
    next: t("next"),
    play: t("play"),
    pause: t("pause"),
    recentAdded: t("recentAdded"),
    musicEditor: t("mobileMusicEditor"),
    ready: t("ready"),
    by: t("byArtist"),
    back: t("minimizePlayer"),
    menu: t("mobilePlayerMenu"),
    favorite: t("favorites"),
    soundEffects: t("mobileSoundEffects"),
    queue: queuePanelMode === "radio" ? t("onlineRadio") : t("queue"),
    lyrics: t("lyrics"),
    sleepTimer: t("sleepTimer"),
    cast: dlnaCastLabel,
  };
  const seekStyle = {
    "--played": playedPercent,
    "--buffered": bufferedPercent,
  } as React.CSSProperties;
  const volumeStyle = {
    "--volume-level": `${Math.round(Math.max(0, Math.min(1, volume)) * 100)}%`,
  } as React.CSSProperties;
  const publicShareToken = publicShareTokenFromRoute(route);
  const effectiveInterfaceMode: InterfaceMode = mobileViewport ? "standard" : interfaceMode;
  const mineradioDesktopHome = !mobileViewport && view === "home" && homePlayerStyle === "mineradio-stage" && !lyricsFullScreen && !currentRadio && !currentNetworkTrack && effectiveInterfaceMode === "standard";

  function enterShellMode() {
    if (mobileViewport) return;
    setLyricsFullScreen(false);
    setMobilePlayerExpanded(false);
    setQueueOpen(false);
    setEqPanelOpen(false);
    setInterfaceMode("shell");
    rememberInterfaceMode("shell");
  }

  function exitShellMode() {
    setLyricsFullScreen(false);
    setInterfaceMode("standard");
    rememberInterfaceMode("standard");
  }

  if (publicShareToken) {
    return <PublicShareView token={publicShareToken} settings={settings} t={t} />;
  }

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
    <>
    <div
      className={lyricsFullScreen ? "app-shell lyrics-mode" : "app-shell"}
      data-interface-mode={effectiveInterfaceMode}
      data-view={view}
      data-mobile-player-expanded={mobilePlayerExpanded ? "true" : "false"}
      data-mobile-player-available={mobilePlayerAvailable ? "true" : "false"}
      data-mobile-theme={mobileHomePlayerStyle}
      data-mineradio-stage-active={mineradioDesktopHome ? "true" : "false"}
      aria-hidden={effectiveInterfaceMode === "shell" ? "true" : undefined}
    >
      <a className="skip-link" href="#main-content">
        {t("skipToContent")}
      </a>
      <aside className={mineradioDesktopHome ? "sidebar desktop-sidebar mineradio-stage-edge-nav" : "sidebar desktop-sidebar"}>
        <div className="brand">
          <img src="/logo.png" alt={t("brand")} /> <span>{t("brand")}</span>
        </div>
        <nav aria-label="Primary">
          <span className="nav-section-label">{t("playback")}</span>
          {playbackNav.map((item) => (
            <button
              key={item.id}
              title={item.label}
              aria-label={item.label}
              className={activeNav(item.id) ? "active" : ""}
              onClick={() => openNavigationView(item.id)}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
          <hr className="nav-divider" />
          <span className="nav-section-label">{t("settings")}</span>
          {desktopNav.slice(playbackNav.length).map((item) => (
            <button
              key={item.id}
              title={item.label}
              aria-label={item.label}
              className={activeNav(item.id) ? "active" : ""}
              onClick={() => openNavigationView(item.id)}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <MobileBottomNav items={mobileBottomNavItems} label={t("primaryNavigation")} />

      <main id="main-content" className="main" tabIndex={-1} ref={mainRef}>
        {lyricsFullScreen ? (
          <FullLyrics
            song={current}
            lines={lyricLines}
            activeLyric={activeLyric}
            lyricsSource={lyrics?.source || current?.lyrics_source || ""}
            lyricsDisplayStyle={lyricsDisplayStyle}
            lyrics={lyrics}
            loading={lyricsLoading}
            progress={progress}
            lyricOffsetMs={lyricOffsetMs}
            onAdjustLyricOffset={adjustLyricOffset}
            onResetLyricOffset={() => setLyricOffsetMs(0)}
            t={t}
            scrollRef={lyricsScrollRef}
            onToggleView={() => {
              setLyricsFullScreen(false);
              if (mobileViewport) setMobilePlayerExpanded(true);
            }}
            onSeek={seekTo}
            lyricsDragSeekEnabled={lyricsDragSeekEnabled}
            candidates={lyricCandidates}
            candidatesOpen={lyricCandidatesOpen}
            candidatesLoading={lyricCandidatesLoading}
            onOpenCandidates={() => void openLyricCandidates()}
            onRefreshCandidates={() => void refreshLyricCandidates()}
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
              setLyricsFullScreen(false);
              void openSongAlbum(song);
            }}
            onFavoriteSong={(song) => void toggleFavorite(song)}
            onEditMetadata={(song) => openSongMetadataEditor(song)}
          />
        ) : (
          <>
            <header className="topbar">
              {showTopbarScreenTitle ? (
                <div className="top-title">
                  <span>{t("brand")}</span>
                  <h1>{screenTitle}</h1>
                </div>
              ) : null}
              {view !== "radio" && view !== "library" && view !== "history" && view !== "my" && !(mobileViewport && view === "settings") ? (
                <SongSearchBox
                  t={t}
                  value={query}
                  onSearch={(value) => {
                    setQuery(value);
                    setLibraryPage(1);
                    if (value.trim()) setView("library");
                    void loadLibrarySongsPage(1, value);
                  }}
                />
              ) : (
                <span className="topbar-search-spacer" aria-hidden="true" />
              )}
              {offlineMode || !networkReachable ? (
                <span className="offline-status-pill">{t("offlineMode")}</span>
              ) : null}
              {showUserMenu ? (
                <UserMenu
                  user={auth.user}
                  t={t}
                  profileEnabled
                  onOpenProfile={() => {
                    setLyricsFullScreen(false);
                    setSettingsTab("account");
                    setView("settings");
                  }}
                  onOpenShellMode={enterShellMode}
                  onLogout={() => void logout()}
                />
              ) : null}
            </header>
            {message ? (
              <div className="app-toast" role="status" aria-live="polite">
                {message}
              </div>
            ) : null}

            {view === "home" && (
              <HomeView
                songs={songs}
                recentPlayedSongs={recentPlayedSongs}
                recentAddedSongs={recentAddedSongs}
                dailyMix={dailyMix}
                albums={albums}
                artists={artists}
                playlists={playlists}
                stats={libraryStats}
                currentRadio={currentRadio}
                currentNetworkTrack={currentNetworkTrack}
                heroSong={heroSong}
                current={current}
                playing={playerPlaying}
                progress={progress}
                duration={playableDuration}
                audioElement={audioEl}
                volume={volume}
                bassGain={bassGain}
                trebleGain={trebleGain}
                playMode={playMode}
                playModeLabel={playModeLabel}
                activeLyricText={activeLyricText}
                homePlayerStyle={homePlayerStyle}
                mineradioStageEnabled={mineradioStageEnabled}
                mobileHomePlayerStyle={mobileHomePlayerStyle}
                mobileViewport={mobileViewport}
                t={t}
                onPlay={playSong}
                onResume={(song) => void resumePlayback(song)}
                onTogglePlayback={() => void togglePlaybackOutput()}
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
                onOpenLibrary={() => {
                  rememberLibraryTab("songs");
                  openNavigationView("library");
                }}
                onOpenFavorites={() => openNavigationView("favorites")}
                onOpenAlbums={() => {
                  setView("albums");
                  void requestAlbumPage(1);
                }}
                onOpenArtists={() => {
                  setView("artists");
                  void requestArtistPage(1);
                }}
                onOpenPlaylists={() => {
                  setView("playlists");
                  void loadPlaylistPage(1);
                }}
                onOpenRadio={() => {
                  setView("radio");
                  if (!radioStations.length) void loadRadioStations();
                }}
              />
            )}

            {view === "my" && (
              <MobileMyView
                user={auth.user}
                stats={libraryStats}
                queueCount={queuePanelMode === "radio" ? radioPanelStations.length : queue.length}
                t={t}
                onOpenFavorites={() => openNavigationView("favorites")}
                onOpenHistory={() => openNavigationView("history")}
                onOpenQueue={toggleQueuePanel}
                onOpenSettings={() => openNavigationView("settings")}
                onOpenAbout={() => openNavigationView("about")}
              />
            )}

            {view === "history" && (
              <HistoryView
                entries={historyEntries}
                loading={historyLoading}
                current={current}
                playing={playerPlaying}
                t={t}
                onRefresh={() => void refreshPlaybackHistory()}
                onPlay={(song, list) => playSong(song, list)}
                onResume={(song) => void resumePlayback(song)}
                onFavorite={(song) => void toggleFavorite(song)}
                onAdd={(song) => addToPlaylist(song)}
                onInsertNext={(items) => insertNextBatch(items)}
                offlineCache={offlineCacheControls}
                onShareSong={settings.sharing_enabled ? (song) => openShareDialog("song", song.id, song.title) : undefined}
                onOpenAlbum={(song) => void openSongAlbum(song)}
                onOpenArtist={(song) => void openArtistById(song.artist_id, song.artist)}
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
                songPageSize={libraryPageSize}
                cardPageSize={gridPageSize}
                onPlay={playSong}
                onFavoriteSong={toggleFavorite}
                onAdd={addToPlaylist}
                onInsertNext={(items) => insertNextBatch(items)}
                offlineCache={offlineCacheControls}
                onShareSong={settings.sharing_enabled ? (song) => openShareDialog("song", song.id, song.title) : undefined}
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
                libraryDirectories={libraryDirectories}
                onLibraryDirectoriesChange={setLibraryDirectories}
                mobileBasic={mobileViewport}
                language={settings.language}
                userRole={auth.user.role}
                current={current}
                t={t}
                onPlay={playSong}
                onFavorite={toggleFavorite}
                onAdd={addToPlaylist}
                onInsertNext={(items) => insertNextBatch(items)}
                offlineCache={offlineCacheControls}
                onShareSong={settings.sharing_enabled ? (song) => openShareDialog("song", song.id, song.title) : undefined}
                onOpenAlbum={(song) => {
                  void openSongAlbum(song);
                }}
                onOpenArtist={(song) =>
                  void openArtistById(song.artist_id, song.artist)
                }
                onEditMetadata={auth.user.role === "admin" ? openSongMetadataEditor : undefined}
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
                onCancelScan={() => void cancelScan()}
                onDismissScan={() => setScanStatus(null)}
                stats={libraryStats}
                songPage={librarySongPage}
                pageLoading={libraryPageLoading}
                searchQuery={query}
                sort={librarySort}
                review={libraryReview}
                reviewCount={libraryReviewSummary?.incomplete_songs}
                onSortChange={(next) => void changeLibrarySort(next)}
                onReviewToggle={() => void toggleLibraryReview()}
                onMetadataCorrected={(result, path) => refreshMetadataAfterCorrection(result, path)}
                onSongSearch={(value) => {
                  setQuery(value);
                  setLibraryPage(1);
                  void loadLibrarySongsPage(1, value);
                }}
                onPageChange={loadLibrarySongsPage}
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
                artistAlbumDisplayStyle={artistAlbumDisplayStyle}
                onArtistAlbumDisplayStyleChange={setArtistAlbumDisplayStyle}
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
                offlineCache={offlineCacheControls}
                onInsertCollection={() => void insertCollectionNext(collection)}
                onCacheCollection={() => void cacheCollectionOffline(collection)}
                onShareSong={settings.sharing_enabled ? (song) => openShareDialog("song", song.id, song.title) : undefined}
                onShareCollection={
                  settings.sharing_enabled && collection.id
                    ? () => openShareDialog(collection.type, collection.id!, collection.title)
                    : undefined
                }
                onEditMetadata={
                  collection.type === "album" && collection.id
                    ? () => openAlbumMetadataEditorFromCollection(collection)
                    : undefined
                }
                onFavoriteCollection={
                  collection.type === "album"
                    ? collection.id
                      ? () => void toggleAlbumFavoriteById(collection.id!, collection.favorite)
                      : undefined
                    : collection.type === "artist"
                      ? collection.id
                        ? () => void toggleArtistFavoriteById(collection.id!, collection.favorite)
                        : undefined
                      : undefined
                }
                onOpenAlbum={(song) => {
                  void openSongAlbum(song, collection.type === "artist" ? collection : null);
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
                onRetry={() => void retryCurrentCollection()}
              />
            )}
            {view === "playlists" && (
              <>
                {smartPlaylists.some((item) => item.enabled) ? (
                  <CardGrid
                    t={t}
                    title={t("smartPlaylists")}
                    items={smartPlaylists.filter((item) => item.enabled).map((item) => {
                      const label = smartPlaylistLabel(item.id, settings.language);
                      return {
                        id: item.id,
                        title: label.title,
                        subtitle: label.hint,
                        theme: settings.theme,
                        onClick: () => void openSmartPlaylist(item),
                        onPlay: () => void playSmartPlaylist(item),
                      };
                    })}
                  />
                ) : null}
                <CardGrid
                  t={t}
                  title={t("playlists")}
                  action={mobileViewport ? undefined : (
                    <button onClick={createPlaylist}>
                      <Plus /> {t("createPlaylist")}
                    </button>
                  )}
                  items={playlists.map((p) => ({
                    id: p.id,
                    title: p.name,
                    subtitle: `${p.song_count} ${t("count")}`,
                    theme: p.cover_theme,
                    onClick: () => void openPlaylist(p),
                    onPlay: () => void playPlaylist(p),
                  }))}
                />
                <PaginationControls page={playlistPageData} itemCount={playlists.length} loading={playlistPageLoading} t={t} onPageChange={loadPlaylistPage} />
              </>
            )}
            {view === "albums" && (
              <>
                <CardGrid
                  t={t}
                  title={t("albums")}
                  variant="album"
                  actionKey={`${settings.language}|${albumArtistFilter}|${albumArtistQuery}|${albumFavoritesOnly}|${albumPageData?.total ?? 0}|${albumPageLoading}`}
                  action={
                    <div className="collection-browse-actions">
                      <FavoriteFilterToggle
                        active={albumFavoritesOnly}
                        count={albumPageLoading ? undefined : albumPageData?.total}
                        t={t}
                        onToggle={toggleAlbumFavoritesFilter}
                      />
                      <AlbumArtistFilter
                        t={t}
                        selectedArtistId={albumArtistFilter}
                        selectedArtistName={albumArtistQuery}
                        onSelect={selectAlbumArtistFilter}
                        onClear={clearAlbumArtistFilter}
                      />
                    </div>
                  }
                  items={displayedAlbums.map((a) => ({
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
                  loading={albumPageLoading}
                  emptyTitle={albumFavoritesOnly ? t("emptyFavoriteAlbums") : undefined}
                  emptyDescription={albumFavoritesOnly ? t("emptyFavoriteAlbumsHint") : undefined}
                />
                <PaginationControls page={albumPageData} itemCount={displayedAlbums.length} loading={albumPageLoading} t={t} onPageChange={requestAlbumPage} />
              </>
            )}
            {view === "artists" && (
              <>
                <CardGrid
                  t={t}
                  title={t("artists")}
                  variant="artist"
                  action={
                    <div className="collection-browse-actions">
                      <FavoriteFilterToggle
                        active={artistFavoritesOnly}
                        count={artistPageLoading ? undefined : artistPageData?.total}
                        t={t}
                        onToggle={toggleArtistFavoritesFilter}
                      />
                      <ArtistInitialFilter
                        active={artistInitialFilter}
                        available={artistPageData?.initials ?? []}
                        loading={artistPageLoading}
                        t={t}
                        onSelect={selectArtistInitialFilter}
                      />
                    </div>
                  }
                  actionKey={`${artistInitialFilter}:${artistPageData?.initials?.join("") ?? ""}:${artistPageLoading ? "loading" : "ready"}:${artistFavoritesOnly}:${artistPageData?.total ?? 0}`}
                  items={displayedArtists.map((a) => ({
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
                  loading={artistPageLoading}
                  emptyTitle={artistFavoritesOnly ? t("emptyFavoriteArtists") : undefined}
                  emptyDescription={artistFavoritesOnly ? t("emptyFavoriteArtistsHint") : undefined}
                />
                <PaginationControls page={artistPageData} itemCount={displayedArtists.length} loading={artistPageLoading} t={t} onPageChange={requestArtistPage} />
              </>
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
                mobileViewport={mobileViewport}
                homePlayerStyle={homePlayerStyle}
                onHomePlayerStyleChange={setHomePlayerStyle}
                mobileHomePlayerStyle={mobileHomePlayerStyle}
                onMobileHomePlayerStyleChange={setMobileHomePlayerStyle}
                mineradioStageEnabled={mineradioStageEnabled}
                onMineradioStageEnabledChange={setMineradioStageEnabled}
                artistAlbumDisplayStyle={artistAlbumDisplayStyle}
                onArtistAlbumDisplayStyleChange={setArtistAlbumDisplayStyle}
                lyricsDisplayStyle={lyricsDisplayStyle}
                onLyricsDisplayStyleChange={setLyricsDisplayStyle}
                lyricsDragSeekEnabled={lyricsDragSeekEnabled}
                onLyricsDragSeekEnabledChange={setLyricsDragSeekEnabled}
                persistentQueueEnabled={persistentQueueEnabled}
                onPersistentQueueChange={(enabled) => {
                  setPersistentQueueEnabled(enabled);
                  rememberPersistentQueueEnabled(enabled);
                }}
                uiSoundSettings={uiSoundSettings}
                onUISoundSettingsChange={setUISoundSettingsState}
                playbackHistorySettings={playbackHistorySettings}
                onPlaybackHistorySettingsChange={setPlaybackHistorySettings}
                offlineUsage={offlineUsage}
                autoCachePlayed={autoCachePlayed}
                onAutoCachePlayedChange={setAutoCachePlayedSetting}
                onRefreshOfflineUsage={() => void refreshOfflineCacheUsage()}
                onManageOfflineCache={openOfflineCacheManager}
                scrobblingSettings={scrobblingSettings}
                onScrobblingSettingsChange={setScrobblingSettings}
                activeTab={settingsTab}
                onTabChange={setSettingsTab}
                onOpenAlbums={() => setView("albums")}
                onOpenPlaylists={() => setView("playlists")}
                onUpdateProfile={(nickname, avatar) => void updateProfile(nickname, avatar)}
                pluginHostTheme={pluginHostTheme}
                pluginHostPlayerState={pluginHostPlayerState}
                onPluginHostCall={handlePluginHostCall}
                t={t}
              />
            )}
            {view === "shares" && settings.sharing_enabled && (
              <ShareManagementView t={t} onToast={showMessage} />
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

      {shareDialogTarget ? (
        <ShareDialog
          target={shareDialogTarget}
          t={t}
          onClose={() => setShareDialogTarget(null)}
          onCreated={() => {
            setShareDialogTarget(null);
            showMessage(t("shareLinkCopied"));
            playUISound("copy");
          }}
        />
      ) : null}
      {metadataEditorTarget ? (
        <MetadataEditorDialog
          target={metadataEditorTarget}
          currentCover={metadataEditorTarget.type === "album" ? albumCoverUrl(metadataEditorTarget.album) : coverUrl(metadataEditorTarget.song)}
          t={t}
          onClose={() => setMetadataEditorTarget(null)}
          onSaved={(result) => {
            applyMetadataWritebackResult(result, metadataEditorTarget);
            showMessage(t("metadataWritebackDone"));
          }}
        />
      ) : null}

      {dlnaCastAvailable ? (
        <DLNACastPanel
          open={dlnaPanelOpen}
          devices={dlnaDevices}
          status={dlnaStatus}
          loading={dlnaLoading}
          error={dlnaError}
          onClose={() => setDLNAPanelOpen(false)}
          onRefresh={() => void refreshDLNADevices(true)}
          onSelectLocal={() => void switchDLNAToLocal()}
          onSelectDevice={(device) => void playCurrentToDLNA(device)}
          t={t}
        />
      ) : null}

      <footer className="player" style={playerStyle}>
        <MobileMiniPlayer
          theme={mobileHomePlayerStyle}
          cover={currentArtwork || coverUrl(mobileDisplaySong)}
          title={mobileDisplaySong?.title ?? currentNetworkTrack?.title ?? currentRadio?.name ?? t("brand")}
          artist={mobileDisplaySong?.artist ?? currentNetworkTrack?.artist ?? currentRadio?.country ?? t("nowPlaying")}
          available={mobilePlayerAvailable}
          playing={playerPlaying}
          progress={progress}
          duration={playableDuration}
          labels={{
            play: t("play"),
            pause: t("pause"),
            expand: t("expandPlayer"),
            queue: queuePanelMode === "radio" ? t("onlineRadio") : t("queue"),
            next: t("next"),
          }}
          onToggle={toggleMobilePlayback}
          onExpand={() => {
            setLyricsFullScreen(false);
            setMobilePlayerExpanded(true);
          }}
          onQueue={current || currentRadio || currentNetworkTrack ? toggleQueuePanel : undefined}
          onNext={mobilePlaybackActive ? () => next(1) : undefined}
        />
        <MobilePlayerDock
          theme={mobileHomePlayerStyle}
          cover={currentArtwork || coverUrl(mobileDisplaySong)}
          playing={playerPlaying}
          progress={progress}
          duration={playableDuration || mobileDisplaySong?.duration_seconds || 0}
          volume={volume}
          title={mobileDisplaySong?.title ?? currentNetworkTrack?.title ?? currentRadio?.name ?? t("brand")}
          artist={mobileDisplaySong?.artist ?? currentNetworkTrack?.artist ?? currentRadio?.country ?? t("nowPlaying")}
          album={mobileDisplaySong?.album ?? currentNetworkTrack?.album ?? t("onlineRadio")}
          playMode={playMode}
          playModeLabel={playModeLabel}
          labels={mobilePlayerLabels}
          onToggle={toggleMobilePlayback}
          onPrevious={mobilePlaybackActive ? () => next(-1) : undefined}
          onNext={mobilePlaybackActive ? () => next(1) : undefined}
          onCyclePlayMode={cyclePlayMode}
          onSeek={seekTo}
          onVolume={updateVolume}
          onBack={() => setMobilePlayerExpanded(false)}
          onFavorite={canFavoriteCurrent ? toggleCurrentFavorite : undefined}
          onSoundEffects={toggleEqualizerPanel}
          onCast={dlnaCastAvailable ? openDLNAPanel : undefined}
          onQueue={current || currentRadio || currentNetworkTrack ? toggleQueuePanel : undefined}
          onSleepTimer={() => setSleepTimerOpen(true)}
          onLyrics={current ? () => {
            setMobilePlayerExpanded(mobileViewport);
            setLyricsFullScreen(true);
          } : undefined}
          favoriteActive={Boolean(currentRadio?.favorite || current?.favorite)}
          soundEffectsActive={eqPanelOpen || eqEnabled}
          castActive={dlnaCastAvailable && remoteDLNAActive}
          castLabel={dlnaCastLabel}
          queueActive={queueOpen}
          sleepTimerActive={sleepTimerMode !== "off"}
          lyricsActive={lyricsFullScreen || inlineLyrics}
        />
        <PlayerMood
          theme={settings.theme}
          playing={playerPlaying}
          song={current}
          radio={currentRadio}
          audioEl={audioEl}
          streamSrc={currentStreamUrl}
          lowBandwidth={buffering}
          eqActive={eqEnabled}
          onOpenEqualizer={toggleEqualizerPanel}
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
              <RadioMiniLogo station={currentRadio} playing={playerPlaying} />
            ) : currentNetworkTrack ? (
              <MiniArtwork url={currentNetworkTrack.cover_url} playing={playerPlaying} />
            ) : (
              <MiniCover song={current} playing={playerPlaying} />
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
            data-active={(currentRadio?.favorite || current?.favorite) ? "true" : "false"}
            aria-label={t(currentRadio?.favorite || current?.favorite ? "removeFavorite" : "addFavorite")}
            aria-pressed={Boolean(currentRadio?.favorite || current?.favorite)}
            disabled={!canFavoriteCurrent}
            onClick={toggleCurrentFavorite}
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
                data-playing={playerPlaying ? "true" : "false"}
                aria-label={playerPlaying ? t("pause") : t("play")}
                disabled={!current && !currentRadio && !currentNetworkTrack}
                onClick={() => void togglePlaybackOutput()}
              >
                {playerPlaying ? <Pause weight="fill" /> : <Play weight="fill" />}
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
            aria-label={t("position")}
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
            onClick={toggleQueuePanel}
          >
            <Queue />
          </button>
          {dlnaCastAvailable ? (
            <button
              className={remoteDLNAActive ? "cast-toggle active" : "cast-toggle"}
              title={dlnaCastLabel}
              aria-label={dlnaCastLabel}
              aria-pressed={remoteDLNAActive}
              onClick={openDLNAPanel}
            >
              <Screencast />
            </button>
          ) : null}
          <button
            className={eqPanelOpen || eqEnabled ? "eq-toggle active" : "eq-toggle"}
            title={t("equalizer")}
            aria-label={t("equalizer")}
            onClick={toggleEqualizerPanel}
          >
            <SlidersHorizontal />
          </button>
          <SleepTimerControl
            mode={sleepTimerMode}
            minutes={sleepTimerMins}
            left={sleepLeft}
            songsLeft={sleepSongsLeft}
            onOpen={() => setSleepTimerOpen(true)}
            t={t}
          />
          <SpeakerSimpleHigh />
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volume}
            aria-label={t("volume")}
            style={volumeStyle}
            onChange={(e) => {
              updateVolume(Number(e.target.value));
            }}
            onWheel={(event) => {
              event.preventDefault();
              updateVolume(volume + (event.deltaY < 0 ? 0.05 : -0.05));
            }}
          />
        </div>
        <audio
          ref={setAudioNode}
          preload="auto"
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
            if (
              shouldPreservePlaybackIntentOnMediaError(
                playingRef.current || pendingAutoplayRef.current,
                document.visibilityState,
              )
            ) {
              preservePlaybackIntentAfterMediaError(event.currentTarget);
              return;
            }
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
              modal={mobileViewport}
              t={t}
              onPlay={(station) => playRadio(station, radioPanelStations)}
              onClose={() => setQueueOpen(false)}
            />
          ) : (
            <QueuePanel
              queue={queue}
              current={current}
              modal={mobileViewport}
              t={t}
              onPlay={(song) => void playSong(song, queue, { keepPlaybackSource: true })}
              onClose={() => setQueueOpen(false)}
            />
          )}
        </div>
      )}
      {sleepTimerOpen ? (
        <SleepTimerDialog
          mode={sleepTimerMode}
          minutes={sleepTimerMins}
          left={sleepLeft}
          songsLeft={sleepSongsLeft}
          albumTitle={sleepAlbumTitle || current?.album || ""}
          canUseSongTimer={Boolean(current)}
          canUseAlbumTimer={Boolean(current?.album_id)}
          t={t}
          onClose={() => setSleepTimerOpen(false)}
          onClear={() => {
            clearSleepTimer();
            setSleepTimerOpen(false);
          }}
          onSetTime={setSleepTimerByMinutes}
          onSetSongs={setSleepTimerBySongs}
          onSetAlbum={setSleepTimerByAlbum}
        />
      ) : null}
      {eqPanelOpen ? (
        <div className="eq-layer">
          <button className="eq-scrim" type="button" aria-label={t("close")} onClick={() => setEqPanelOpen(false)} />
          {mobileViewport ? (
            <MobileSoundPanel
              t={t}
              enabled={eqEnabled}
              bands={eqBands}
              onToggle={() => setEqEnabled((value) => !value)}
              onApplyPreset={(presetBands) => setEqBands(presetBands)}
              onClose={() => setEqPanelOpen(false)}
            />
          ) : (
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
          )}
        </div>
      ) : null}
    </div>
    {effectiveInterfaceMode === "shell" ? (
      <TerminalShell
        user={auth.user}
        settings={settings}
        health={health}
        libraryStats={libraryStats}
        networkReachable={networkReachable}
        offlineMode={offlineMode}
        songs={songs}
        librarySongPage={librarySongPage}
        libraryPageLoading={libraryPageLoading}
        albums={(shellAlbumPageData?.items ?? []).map((item) => albumCacheByID.get(item.id) ?? item)}
        albumPage={shellAlbumPageData}
        albumPageLoading={shellAlbumPageLoading}
        favoriteSongs={favoriteSongs}
        favoriteAlbums={favoriteAlbums}
        recentPlayedSongs={recentPlayedSongs}
        dailyMix={dailyMix}
        queue={queue}
        current={current}
        currentRadio={currentRadio}
        currentNetworkTrack={currentNetworkTrack}
        playing={playerPlaying}
        progress={progress}
        duration={playableDuration}
        volume={volume}
        playModeLabel={playModeLabel}
        lyricLines={lyricLines}
        activeLyric={activeLyric}
        lyricsLoading={lyricsLoading}
        shellTheme={terminalShellTheme}
        t={t}
        onShellThemeChange={setTerminalShellTheme}
        onExit={exitShellMode}
        onPlaySong={(song, list) => void playSong(song, list)}
        onPlayQueueSong={(song) => void playSong(song, queue, { keepPlaybackSource: true })}
        onPlayAlbum={(album) => void playAlbum(album)}
        onFavoriteSong={(song) => void toggleFavorite(song)}
        onFavoriteAlbum={(album) => void toggleAlbumFavorite(album)}
        onTogglePlayback={() => void togglePlaybackOutput()}
        onPrevious={() => next(-1)}
        onNext={() => next(1)}
        onSeek={seekTo}
        onVolume={updateVolume}
        onLoadLibrarySongsPage={(page, search) => void loadLibrarySongsPage(page, search)}
        onLoadAlbumPage={(page) => void loadShellAlbumPage(page)}
      />
    ) : null}
    </>
  );
}

function LibrarySummaryStats({
  t,
  stats,
  onOpenSongs,
  onOpenAlbums,
  onOpenArtists,
  onOpenPlaylists,
}: {
  t: ReturnType<typeof createT>;
  stats: LibraryStats;
  onOpenSongs: () => void;
  onOpenAlbums: () => void;
  onOpenArtists: () => void;
  onOpenPlaylists: () => void;
}) {
  const items = [
    { key: "songs", value: stats.songs, label: t("count"), onOpen: onOpenSongs },
    { key: "albums", value: stats.albums, label: t("albums"), onOpen: onOpenAlbums },
    { key: "artists", value: stats.artists, label: t("artists"), onOpen: onOpenArtists },
    { key: "playlists", value: stats.playlists, label: t("playlists"), onOpen: onOpenPlaylists },
  ];
  return (
    <div className="library-summary-stats" aria-label={t("librarySummary")}>
      {items.map((item) => (
        <button
          className="library-summary-stat"
          key={item.key}
          type="button"
          aria-label={`${item.value} ${item.label}`}
          onClick={item.onOpen}
        >
          <strong title={String(item.value)}>{compactLibraryCount(item.value)}</strong>
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
}

function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function historyEntryDate(entry: PlaybackHistoryEntry) {
  const date = new Date(entry.updated_at || entry.played_at);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function formatHistoryDayLabel(key: string, t: ReturnType<typeof createT>) {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (key === localDateKey(today)) return t("historyToday");
  if (key === localDateKey(yesterday)) return t("historyYesterday");
  const date = new Date(`${key}T00:00:00`);
  if (Number.isNaN(date.getTime())) return key;
  return date.toLocaleDateString(undefined, { month: "long", day: "numeric", weekday: "long" });
}

function formatHistoryTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function HomeView({
  songs,
  recentPlayedSongs,
  recentAddedSongs,
  dailyMix,
  albums,
  artists,
  playlists,
  stats,
  currentRadio,
  currentNetworkTrack,
  heroSong,
  current,
  playing,
  progress,
  duration,
  audioElement,
  volume,
  bassGain,
  trebleGain,
  playMode,
  playModeLabel,
  activeLyricText,
  homePlayerStyle,
  mineradioStageEnabled,
  mobileHomePlayerStyle,
  mobileViewport,
  t,
  onPlay,
  onResume,
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
  onOpenLibrary,
  onOpenAlbums,
  onOpenArtists,
  onOpenPlaylists,
  onOpenRadio,
}: {
  songs: Song[];
  recentPlayedSongs: Song[];
  recentAddedSongs: Song[];
  dailyMix: Song[];
  albums: Album[];
  artists: Artist[];
  playlists: Playlist[];
  stats: LibraryStats | null;
  currentRadio: RadioStation | null;
  currentNetworkTrack: NetworkTrack | null;
  heroSong?: Song | null;
  current: Song | null;
  playing: boolean;
  progress: number;
  duration: number;
  audioElement: HTMLAudioElement | null;
  volume: number;
  bassGain: number;
  trebleGain: number;
  playMode: PlayMode;
  playModeLabel: string;
  activeLyricText: string;
  homePlayerStyle: HomePlayerStyle;
  mineradioStageEnabled: boolean;
  mobileHomePlayerStyle: MobileHomePlayerStyle;
  mobileViewport: boolean;
  t: ReturnType<typeof createT>;
  onPlay: (song: Song, list?: Song[]) => void;
  onResume: (song: Song) => void;
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
  onOpenLibrary: () => void;
  onOpenFavorites: () => void;
  onOpenAlbums: () => void;
  onOpenArtists: () => void;
  onOpenPlaylists: () => void;
  onOpenRadio: () => void;
}) {
  const playerThemeLabels = {
    position: t("position"),
    volume: t("volume"),
    previous: t("previous"),
    next: t("next"),
    play: t("play"),
    pause: t("pause"),
    seekBackward10: t("seekBackward10"),
    seekForward10: t("seekForward10"),
    enter: t("enterPlayer"),
    controls: t("playerControls"),
  };
  const [recentTab, setRecentTab] = useState<RecentHomeTab>("played");
  const [dailyView, setDailyView] = useState<DailyDiscoveryView>("songs");
  const recentSongs = (recentTab === "played" ? recentPlayedSongs : recentAddedSongs).slice(0, 5);
  const dailySource = dailyMix.length ? dailyMix : songs;
  const dailySongs = dailySource.slice(0, 8);
  const dailySpotlight = dailySource.slice(0, 5);
  const featuredAlbums = albums.slice(0, 4);
  const featuredArtists = artists.slice(0, 4);
  const featuredPlaylists = playlists.slice(0, 3);
  const resumeCandidate = resumePosition(recentPlayedSongs[0]) ? recentPlayedSongs[0] : null;
  const displaySong = current ?? heroSong ?? resumeCandidate ?? recentAddedSongs[0] ?? dailySource[0] ?? songs[0];
  const canResumeDisplaySong = Boolean(displaySong && resumePosition(displaySong) > 0);
  const heroActive = Boolean(current);
  const heroCanResume = !heroActive && Boolean(resumeCandidate);
  const heroPlaying = playing && heroActive;
  const heroAlbum = displaySong
    ? albums.find((album) => album.id === displaySong.album_id)
    : undefined;
  const mobileRecent = recentSongs.length ? recentSongs : songs.slice(0, 5);
  const mobileLibrary = dailySongs.length ? dailySongs : songs.slice(0, 8);
  if (mobileViewport) {
    return (
      <section className="home-view mobile-home-view">
        <MobileHomeSurface
          theme={mobileHomePlayerStyle}
          displaySong={displaySong}
          canResumeDisplaySong={canResumeDisplaySong}
          externalNowPlaying={currentRadio ? {
            title: currentRadio.name || t("onlineRadio"),
            artist: currentRadio.country || t("onlineRadio"),
            album: currentRadio.codec || currentRadio.tags || t("liveRadio"),
            cover: currentRadio.favicon,
          } : currentNetworkTrack ? {
            title: currentNetworkTrack.title || t("nowPlaying"),
            artist: currentNetworkTrack.artist || t("artist"),
            album: currentNetworkTrack.album || currentNetworkTrack.provider || t("networkLibrary"),
            cover: currentNetworkTrack.cover_url,
          } : null}
          current={current}
          playing={playing}
          recentSongs={mobileRecent}
          recentAddedSongs={recentAddedSongs.slice(0, 6)}
          recommendedSongs={mobileLibrary}
          albums={featuredAlbums}
          artists={featuredArtists}
          playlists={featuredPlaylists}
          stats={stats}
          t={t}
          onPlay={onPlay}
          onResume={onResume}
          onTogglePlayback={onTogglePlayback}
          onOpenLibrary={onOpenLibrary}
          onOpenAlbums={onOpenAlbums}
          onOpenArtists={onOpenArtists}
          onOpenPlaylists={onOpenPlaylists}
          onOpenRadio={onOpenRadio}
          onOpenAlbum={onOpenAlbum}
          onOpenArtist={onOpenArtist}
          onOpenPlaylist={onOpenPlaylist}
        />
      </section>
    );
  }

  if (homePlayerStyle === "mineradio-stage" && !currentRadio && !currentNetworkTrack) {
    return (
      <section className="home-view home-view-mineradio" data-mineradio-home="true">
        <section className="hero mineradio-stage-hero">
          <MineradioStagePlayer
            cover={coverUrl(displaySong)}
            playing={heroPlaying}
            progress={heroActive ? progress : 0}
            duration={heroActive ? duration : displaySong?.duration_seconds || 0}
            title={displaySong?.title}
            artist={displaySong?.artist}
            album={displaySong?.album}
            playMode={playMode}
            playModeLabel={playModeLabel}
            labels={playerThemeLabels}
            immersiveStage={mineradioStageEnabled}
            activeLyricText={activeLyricText}
            audioElement={audioElement}
            playlists={playlists}
            onToggle={heroActive ? onTogglePlayback : heroCanResume && displaySong ? () => onResume(displaySong) : undefined}
            onPrevious={heroActive ? onPrevious : undefined}
            onNext={heroActive ? onNext : undefined}
            onCyclePlayMode={onCyclePlayMode}
            onSeek={heroActive ? onSeek : undefined}
            onOpenPlaylist={onOpenPlaylist}
          />
        </section>
      </section>
    );
  }

  return (
    <section className="home-view">
      <section className={currentRadio ? "hero radio-hero" : homePlayerStyle === "album-slide" ? "hero album-slide-hero" : homePlayerStyle === "smartisan-turntable" ? "hero smartisan-turntable-hero" : homePlayerStyle === "gramophone" ? "hero gramophone-hero" : homePlayerStyle === "running-kitten" ? "hero running-kitten-hero" : homePlayerStyle === "walkman" ? "hero walkman-hero" : homePlayerStyle === "singularity" ? "hero singularity-hero" : homePlayerStyle === "audio-scope" ? "hero neural-cathedral-hero" : "hero"}>
        {currentRadio ? (
          <RadioReceiver
            title={currentRadio.name || t("onlineRadio")}
            subtitle={[t("onlineRadio"), currentRadio.country, currentRadio.codec || currentRadio.tags].filter(Boolean).join(" · ")}
            playing={playing}
            t={t}
            onPlay={() => undefined}
          />
        ) : homePlayerStyle === "cassette" ? (
          <CassetteDeck
            cover={coverUrl(displaySong)}
            playing={heroPlaying}
            progress={heroActive ? progress : 0}
            duration={heroActive ? duration : displaySong?.duration_seconds || 0}
            title={displaySong?.title}
            artist={displaySong?.artist}
            playMode={playMode}
            playModeLabel={playModeLabel}
            labels={playerThemeLabels}
            onToggle={heroActive ? onTogglePlayback : heroCanResume && displaySong ? () => onResume(displaySong) : undefined}
            onPrevious={heroActive ? onPrevious : undefined}
            onNext={heroActive ? onNext : undefined}
            onCyclePlayMode={onCyclePlayMode}
            onSeek={heroActive ? onSeek : undefined}
          />
        ) : homePlayerStyle === "ipod" ? (
          <IpodPlayer
            cover={coverUrl(displaySong)}
            playing={heroPlaying}
            progress={heroActive ? progress : 0}
            duration={heroActive ? duration : displaySong?.duration_seconds || 0}
            title={displaySong?.title}
            artist={displaySong?.artist}
            playMode={playMode}
            playModeLabel={playModeLabel}
            labels={playerThemeLabels}
            onToggle={heroActive ? onTogglePlayback : heroCanResume && displaySong ? () => onResume(displaySong) : undefined}
            onPrevious={heroActive ? onPrevious : undefined}
            onNext={heroActive ? onNext : undefined}
            onCyclePlayMode={onCyclePlayMode}
            onSeek={heroActive ? onSeek : undefined}
          />
        ) : homePlayerStyle === "audio-scope" ? (
          <NeuralCathedralPlayer
            playing={heroPlaying}
            progress={heroActive ? progress : 0}
            duration={heroActive ? duration : displaySong?.duration_seconds || 0}
            title={displaySong?.title}
            artist={displaySong?.artist}
            playMode={playMode}
            playModeLabel={playModeLabel}
            labels={playerThemeLabels}
            telemetryLabel={t("playerTelemetry")}
            manualOverrideLabel={t("manualOverride")}
            onToggle={heroActive ? onTogglePlayback : heroCanResume && displaySong ? () => onResume(displaySong) : undefined}
            onPrevious={heroActive ? onPrevious : undefined}
            onNext={heroActive ? onNext : undefined}
            onCyclePlayMode={onCyclePlayMode}
            onSeek={heroActive ? onSeek : undefined}
          />
        ) : homePlayerStyle === "album-slide" ? (
          <AlbumSlidePlayer
            cover={coverUrl(displaySong)}
            playing={heroPlaying}
            progress={heroActive ? progress : 0}
            duration={heroActive ? duration : displaySong?.duration_seconds || 0}
            title={displaySong?.title}
            artist={displaySong?.artist}
            album={displaySong?.album}
            playMode={playMode}
            playModeLabel={playModeLabel}
            labels={playerThemeLabels}
            onToggle={heroActive ? onTogglePlayback : heroCanResume && displaySong ? () => onResume(displaySong) : undefined}
            onPrevious={heroActive ? onPrevious : undefined}
            onNext={heroActive ? onNext : undefined}
            onCyclePlayMode={onCyclePlayMode}
            onSeek={heroActive ? onSeek : undefined}
          />
        ) : homePlayerStyle === "smartisan-turntable" ? (
          <SmartisanTurntable
            cover={coverUrl(displaySong)}
            playing={heroPlaying}
            progress={heroActive ? progress : 0}
            duration={heroActive ? duration : displaySong?.duration_seconds || 0}
            title={displaySong?.title}
            artist={displaySong?.artist}
            playMode={playMode}
            playModeLabel={playModeLabel}
            labels={playerThemeLabels}
            onToggle={heroActive ? onTogglePlayback : heroCanResume && displaySong ? () => onResume(displaySong) : undefined}
            onPrevious={heroActive ? onPrevious : undefined}
            onNext={heroActive ? onNext : undefined}
            onCyclePlayMode={onCyclePlayMode}
            onSeek={heroActive ? onSeek : undefined}
          />
        ) : homePlayerStyle === "gramophone" ? (
          <GramophonePlayer
            cover={coverUrl(displaySong)}
            playing={heroPlaying}
            progress={heroActive ? progress : 0}
            duration={heroActive ? duration : displaySong?.duration_seconds || 0}
            title={displaySong?.title}
            artist={displaySong?.artist}
            album={displaySong?.album}
            playMode={playMode}
            playModeLabel={playModeLabel}
            labels={playerThemeLabels}
            onToggle={heroActive ? onTogglePlayback : heroCanResume && displaySong ? () => onResume(displaySong) : undefined}
            onPrevious={heroActive ? onPrevious : undefined}
            onNext={heroActive ? onNext : undefined}
            onCyclePlayMode={onCyclePlayMode}
            onSeek={heroActive ? onSeek : undefined}
          />
        ) : homePlayerStyle === "running-kitten" ? (
          <RunningKittenTurntable
            cover={coverUrl(displaySong)}
            playing={heroPlaying}
            progress={heroActive ? progress : 0}
            duration={heroActive ? duration : displaySong?.duration_seconds || 0}
            title={displaySong?.title}
            artist={displaySong?.artist}
            playMode={playMode}
            playModeLabel={playModeLabel}
            labels={playerThemeLabels}
            onToggle={heroActive ? onTogglePlayback : heroCanResume && displaySong ? () => onResume(displaySong) : undefined}
            onPrevious={heroActive ? onPrevious : undefined}
            onNext={heroActive ? onNext : undefined}
            onCyclePlayMode={onCyclePlayMode}
            onSeek={heroActive ? onSeek : undefined}
          />
        ) : homePlayerStyle === "walkman" ? (
          <WalkmanPlayer
            cover={coverUrl(displaySong)}
            playing={heroPlaying}
            progress={heroActive ? progress : 0}
            duration={heroActive ? duration : displaySong?.duration_seconds || 0}
            title={displaySong?.title}
            artist={displaySong?.artist}
            album={displaySong?.album}
            playMode={playMode}
            playModeLabel={playModeLabel}
            labels={playerThemeLabels}
            onToggle={heroActive ? onTogglePlayback : heroCanResume && displaySong ? () => onResume(displaySong) : undefined}
            onPrevious={heroActive ? onPrevious : undefined}
            onNext={heroActive ? onNext : undefined}
            onCyclePlayMode={onCyclePlayMode}
            onSeek={heroActive ? onSeek : undefined}
          />
        ) : homePlayerStyle === "singularity" ? (
          <SingularityPlayer
            playing={heroPlaying}
            progress={heroActive ? progress : 0}
            duration={heroActive ? duration : displaySong?.duration_seconds || 0}
            title={displaySong?.title}
            artist={displaySong?.artist}
            album={displaySong?.album}
            playMode={playMode}
            playModeLabel={playModeLabel}
            labels={playerThemeLabels}
            changeFieldLabel={t("changeVisualField")}
            onToggle={heroActive ? onTogglePlayback : heroCanResume && displaySong ? () => onResume(displaySong) : undefined}
            onPrevious={heroActive ? onPrevious : undefined}
            onNext={heroActive ? onNext : undefined}
            onCyclePlayMode={onCyclePlayMode}
            onSeek={heroActive ? onSeek : undefined}
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
            labels={playerThemeLabels}
            resetToneLabel={t("resetEqualizer")}
            onToggle={heroActive ? onTogglePlayback : heroCanResume && displaySong ? () => onResume(displaySong) : undefined}
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
          <p>{currentRadio ? t("liveRadio") : heroPlaying ? t("nowPlaying") : heroCanResume ? t("jumpBackIn") : t("quickStart")}</p>
          <h1 className={!currentRadio && !displaySong ? "hero-product-title" : undefined}>
            {currentRadio?.name ?? displaySong?.title ?? `${t("brand")} Music`}
          </h1>
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
              onClick={() => displaySong && (heroActive ? onTogglePlayback() : onResume(displaySong))}
            >
              {currentRadio ? <Record weight="fill" /> : heroPlaying ? <Pause weight="fill" /> : <Play weight="fill" />}
              {currentRadio ? t("liveRadio") : heroPlaying ? t("nowPlaying") : heroCanResume ? t("jumpBackIn") : t("play")}
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
            onOpenSongs={onOpenLibrary}
            onOpenAlbums={onOpenAlbums}
            onOpenArtists={onOpenArtists}
            onOpenPlaylists={onOpenPlaylists}
          />
        </section>

        <section className="quick-panel">
          <div className="section-head compact">
            <div>
              <h2>{t("latestSongs")}</h2>
              <p className="section-subtitle">{t("latestSongsHint")}</p>
            </div>
            <div className="recent-tabs" role="tablist" aria-label={t("latestSongs")}>
              <button className={recentTab === "played" ? "active" : ""} onClick={() => setRecentTab("played")}>
                {t("recentPlayed")}
              </button>
              <button className={recentTab === "added" ? "active" : ""} onClick={() => setRecentTab("added")}>
                {t("recentAdded")}
              </button>
            </div>
            {recentSongs[0] ? (
              <button onClick={() => onPlay(recentSongs[0], recentSongs)}>
                <Play weight="fill" /> {t("playAll")}
              </button>
            ) : null}
          </div>
          <div className="quick-song-list">
            {recentSongs.length ? (
              recentSongs.map((song) => (
                <button
                  key={song.id}
                  className={song.id === current?.id ? "active" : ""}
                  onClick={() => onPlay(song, recentSongs)}
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
        <section className="daily-discovery">
          <div className="daily-discovery-head">
            <div>
              <h2>{t("dailyMix")}</h2>
              <p className="section-subtitle">{t("dailyMixHint")}</p>
            </div>
            <div className="daily-view-toggle" role="group" aria-label={t("dailyMix")}>
              <button className={dailyView === "songs" ? "active" : ""} onClick={() => setDailyView("songs")}>{t("songs")}</button>
              <button className={dailyView === "albums" ? "active" : ""} onClick={() => setDailyView("albums")}>{t("albums")}</button>
              <button className={dailyView === "artists" ? "active" : ""} onClick={() => setDailyView("artists")}>{t("artists")}</button>
            </div>
          </div>
          <div className="daily-discovery-layout">
            <div className="daily-coverflow" aria-label={t("dailyMix")}>
              {dailyView === "albums" && featuredAlbums.length ? (
                featuredAlbums.map((album) => (
                  <button
                    key={album.id}
                    className="daily-cover-card"
                    onClick={() => onOpenAlbum(album)}
                  >
                    <span className="daily-cover-art">
                      <LazyCoverImage src={albumCoverUrl(album)} />
                      <Record weight="fill" />
                    </span>
                    <strong>{album.title}</strong>
                    <em>{album.artist}</em>
                  </button>
                ))
              ) : dailyView === "artists" && featuredArtists.length ? (
                featuredArtists.map((artist) => (
                  <button
                    key={artist.id}
                    className="daily-cover-card daily-artist-card"
                    onClick={() => onOpenArtist(artist.id, artist.name)}
                  >
                    <span className="daily-cover-art">
                      <LazyCoverImage src={artistCoverUrl(artist)} />
                      <Record weight="fill" />
                    </span>
                    <strong>{artist.name}</strong>
                    <em>{artist.song_count} {t("count")}</em>
                  </button>
                ))
              ) : (
                dailySpotlight.map((song) => (
                  <button
                    key={song.id}
                    className={song.id === current?.id ? "daily-cover-card active" : "daily-cover-card"}
                    onClick={() => onPlay(song, dailySource)}
                  >
                    <span className="daily-cover-art">
                      <LazyCoverImage src={coverUrl(song)} />
                      <Record weight="fill" />
                    </span>
                    <strong>{song.title}</strong>
                    <em>{song.artist}</em>
                  </button>
                ))
              )}
            </div>
            <div className="daily-song-panel">
              <div className="daily-song-panel-head">
                <h3>{t("dailyRecommendedSongs")}</h3>
                <button onClick={() => onPlay(dailySongs[0], dailySource)}>
                  <Play weight="fill" /> {t("playAll")}
                </button>
              </div>
              <div className="daily-song-list">
                {dailySongs.map((song) => (
                  <button
                    key={song.id}
                    className={song.id === current?.id ? "active" : ""}
                    onClick={() => onPlay(song, dailySource)}
                  >
                    <MiniCover song={song} playing={playing && song.id === current?.id} />
                    <span>
                      <strong>{song.title}</strong>
                      <small>{song.artist} · {song.album}</small>
                    </span>
                    <time>{formatDuration(song.duration_seconds)}</time>
                  </button>
                ))}
              </div>
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

function MobileMyView({
  user,
  stats,
  queueCount,
  t,
  onOpenFavorites,
  onOpenHistory,
  onOpenQueue,
  onOpenSettings,
  onOpenAbout,
}: {
  user: User;
  stats: LibraryStats | null;
  queueCount: number;
  t: ReturnType<typeof createT>;
  onOpenFavorites: () => void;
  onOpenHistory: () => void;
  onOpenQueue: () => void;
  onOpenSettings: () => void;
  onOpenAbout: () => void;
}) {
  const librarySummary = stats
    ? `${stats.songs} ${t("count")} · ${stats.albums} ${t("album")}`
    : t("localLibrary");
  const items = [
    {
      key: "favorites",
      label: t("favorites"),
      detail: t("favoritesHint"),
      icon: <Heart weight="regular" />,
      onClick: onOpenFavorites,
    },
    {
      key: "history",
      label: t("history"),
      detail: t("historyTimeline"),
      icon: <ClockCounterClockwise />,
      onClick: onOpenHistory,
    },
    {
      key: "queue",
      label: t("queue"),
      detail: queueCount ? `${queueCount} ${t("count")}` : t("emptyCollection"),
      icon: <Queue />,
      onClick: onOpenQueue,
    },
    {
      key: "settings",
      label: t("settings"),
      detail: t("profileSettings"),
      icon: <GearSix />,
      onClick: onOpenSettings,
    },
    {
      key: "about",
      label: t("about"),
      detail: t("brand"),
      icon: <Info />,
      onClick: onOpenAbout,
    },
  ];

  return (
    <section className="mobile-my-view" aria-label={t("my")}>
      <div className="mobile-my-header">
        <UserAvatar user={user} />
        <div>
          <strong>{user.nickname || user.username || t("brand")}</strong>
          <span>{librarySummary}</span>
        </div>
      </div>
      <div className="mobile-my-list">
        {items.map((item, index) => (
          <button
            key={item.key}
            type="button"
            className={index === 3 ? "mobile-my-item mobile-my-item-separated" : "mobile-my-item"}
            onClick={item.onClick}
          >
            <span className="mobile-my-icon" aria-hidden="true">
              {item.icon}
            </span>
            <span className="mobile-my-copy">
              <strong>{item.label}</strong>
              <small>{item.detail}</small>
            </span>
            <CaretRight weight="bold" aria-hidden="true" />
          </button>
        ))}
      </div>
    </section>
  );
}

function MiniArtwork({
  url,
  playing,
  className = "mini-art",
  children,
}: {
  url?: string;
  playing: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const [failedUrl, setFailedUrl] = useState("");
  useEffect(() => {
    if (url !== failedUrl) setFailedUrl("");
  }, [failedUrl, url]);
  const displayUrl = url && url !== failedUrl ? url : "";
  const style = displayUrl
    ? ({ "--cover-url": `url(${displayUrl})` } as React.CSSProperties)
    : undefined;
  return (
    <div
      className={className}
      data-playing={playing ? "true" : "false"}
      data-has-cover={displayUrl ? "true" : "false"}
      style={style}
    >
      <PaperShaderLayer variant="mini" playing={playing} cover={displayUrl} compact />
      {displayUrl ? (
        <img
          src={displayUrl}
          alt=""
          loading="eager"
          decoding="async"
          onError={() => setFailedUrl(displayUrl)}
        />
      ) : (
        <Record weight="fill" />
      )}
      {children}
    </div>
  );
}

function MiniCover({
  song,
  playing,
}: {
  song?: Song | null;
  playing: boolean;
}) {
  return <MiniArtwork url={coverUrl(song)} playing={playing} />;
}

function RadioMiniLogo({ station, playing }: { station: RadioStation; playing: boolean }) {
  return (
    <MiniArtwork url={station.favicon} playing={playing} className="mini-art radio-mini-art">
      <span aria-hidden="true" />
    </MiniArtwork>
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
  songPageSize,
  cardPageSize,
  onPlay,
  onFavoriteSong,
  onAdd,
  onInsertNext,
  offlineCache,
  onShareSong,
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
  songPageSize: number;
  cardPageSize: number;
  onPlay: (song: Song, list: Song[]) => void;
  onFavoriteSong: (song: Song) => void;
  onAdd: (song: Song) => void;
  onInsertNext: (songs: Song[]) => void;
  offlineCache: OfflineCacheControls;
  onShareSong?: (song: Song) => void;
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
  const [page, setPage] = useState(1);
  const hasAny = songs.length || albums.length || artists.length || radios.length;
  const pageSize = tab === "songs" ? songPageSize : cardPageSize;
  const pageItems = <T,>(items: T[]) => items.slice((page - 1) * pageSize, page * pageSize);
  const pageMeta = (total: number): PageLike => ({
    total,
    limit: pageSize,
    offset: (page - 1) * pageSize,
    page,
  });
  const setFavoriteTab = (nextTab: typeof tab) => {
    setTab(nextTab);
    setPage(1);
  };
  useEffect(() => {
    const total =
      tab === "songs"
        ? songs.length
        : tab === "albums"
          ? albums.length
          : tab === "artists"
            ? artists.length
            : radios.length;
    const maxPage = Math.max(1, Math.ceil(total / pageSize));
    if (page > maxPage) setPage(maxPage);
  }, [albums.length, artists.length, page, pageSize, radios.length, songs.length, tab]);
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
          onClick={() => setFavoriteTab("songs")}
        >
          {t("songs")} · {songs.length}
        </button>
        <button
          className={tab === "albums" ? "active" : ""}
          onClick={() => setFavoriteTab("albums")}
        >
          {t("albums")} · {albums.length}
        </button>
        <button
          className={tab === "artists" ? "active" : ""}
          onClick={() => setFavoriteTab("artists")}
        >
          {t("artists")} · {artists.length}
        </button>
        <button
          className={tab === "radios" ? "active" : ""}
          onClick={() => setFavoriteTab("radios")}
        >
          {t("onlineRadio")} · {radios.length}
        </button>
      </div>
      {!hasAny ? (
        <EmptyState
          variant="rich"
          icon={<Heart weight="regular" />}
          title={t("emptyFavorites")}
          description={t("emptyFavoritesHint")}
        />
      ) : tab === "songs" ? (
        <SongTable
          songs={pageItems(songs)}
          current={current}
          t={t}
          onPlay={onPlay}
          onFavorite={onFavoriteSong}
          onAdd={onAdd}
          onInsertNext={(song) => onInsertNext([song])}
          offlineCache={offlineCache}
          onShare={onShareSong}
        />
      ) : tab === "albums" ? (
        <>
        <CardGrid
          t={t}
          title={t("albums")}
          variant="album"
          items={pageItems(albums).map((album) => ({
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
        <PaginationControls page={pageMeta(albums.length)} itemCount={pageItems(albums).length} loading={false} t={t} onPageChange={setPage} />
        </>
      ) : tab === "artists" ? (
        <>
        <CardGrid
          t={t}
          title={t("artists")}
          variant="artist"
          items={pageItems(artists).map((artist) => ({
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
        <PaginationControls page={pageMeta(artists.length)} itemCount={pageItems(artists).length} loading={false} t={t} onPageChange={setPage} />
        </>
      ) : (
        <>
        <CardGrid
          t={t}
          title={t("onlineRadio")}
          variant="radio"
          items={pageItems(radios).map((station) => ({
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
        <PaginationControls page={pageMeta(radios.length)} itemCount={pageItems(radios).length} loading={false} t={t} onPageChange={setPage} />
        </>
      )}
      {tab === "songs" ? (
        <PaginationControls page={pageMeta(songs.length)} itemCount={pageItems(songs).length} loading={false} t={t} onPageChange={setPage} />
      ) : null}
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
    "smartisan-classic": "SMARTISAN",
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
        <PaperShaderLayer variant="player-mood" playing={playing && !lowBandwidth} compact />
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
      <PaperShaderLayer variant="player-mood" playing={playing && !lowBandwidth && !waveFailed} compact />
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
    "smartisan-classic": { wave: "rgba(154,0,0,.22)", progress: "#d94a43", cursor: "#5e88e8" },
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
  artistAlbumDisplayStyle,
  onArtistAlbumDisplayStyleChange,
  backLabel,
  onBack,
  onPlayAll,
  onPlay,
  onFavorite,
  onAdd,
  onInsertNext,
  offlineCache,
  onInsertCollection,
  onCacheCollection,
  onShareSong,
  onShareCollection,
  onEditMetadata,
  onFavoriteCollection,
  onOpenAlbum,
  onOpenAlbumCard,
  onPlayAlbumCard,
  onOpenArtist,
  onOpenCollectionArtist,
  onRetry,
}: {
  collection: Collection;
  current: Song | null;
  t: ReturnType<typeof createT>;
  artistAlbumDisplayStyle: ArtistAlbumDisplayStyle;
  onArtistAlbumDisplayStyleChange: (style: ArtistAlbumDisplayStyle) => void;
  backLabel?: string;
  onBack: () => void;
  onPlayAll: () => void;
  onPlay: (song: Song, list: Song[]) => void;
  onFavorite: (song: Song) => void;
  onAdd: (song: Song) => void;
  onInsertNext: (songs: Song[]) => void;
  offlineCache: OfflineCacheControls;
  onInsertCollection: () => void;
  onCacheCollection?: () => void;
  onShareSong?: (song: Song) => void;
  onShareCollection?: () => void;
  onEditMetadata?: () => void;
  onFavoriteCollection?: () => void;
  onOpenAlbum?: (song: Song) => void;
  onOpenAlbumCard?: (album: Album) => void;
  onPlayAlbumCard?: (album: Album) => void;
  onOpenArtist: (song: Song) => void;
  onOpenCollectionArtist?: () => void;
  onRetry?: () => void;
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
  const collectionCacheKnown = collection.songs.length > 0;
  const collectionFullyCached =
    collectionCacheKnown && collection.songs.every((song) => offlineCache.cachedSongIds.has(song.id));
  const collectionCaching =
    collectionCacheKnown && collection.songs.some((song) => offlineCache.cachingSongIds.has(song.id));
  const cacheCollectionLabel = collectionFullyCached ? t("offlineCacheAllReady") : t("offlineCacheAllAlbum");

  return (
    <section className="collection-view">
      <div className="collection-page-title">
        <span className="label">{label}</span>
        <span className="divider">/</span>
        <span className="current">{collection.title}</span>
      </div>
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
            {collection.type === "album" && onCacheCollection ? (
              <button
                className={collectionFullyCached ? "active" : ""}
                disabled={!hasResolvableSongs || collectionCaching || collectionFullyCached}
                onClick={onCacheCollection}
                title={cacheCollectionLabel}
                aria-label={cacheCollectionLabel}
              >
                {collectionFullyCached ? (
                  <CheckCircle weight="fill" />
                ) : collectionCaching ? (
                  <CircleNotch weight="bold" className="offline-cache-spinner" />
                ) : (
                  <DownloadSimple />
                )}
                {cacheCollectionLabel}
              </button>
            ) : null}
            {onFavoriteCollection ? (
              <button
                className={collection.favorite ? "active" : ""}
                onClick={onFavoriteCollection}
                aria-label={t(collection.favorite ? "removeFavorite" : "addFavorite")}
                aria-pressed={Boolean(collection.favorite)}
              >
                <Heart weight={collection.favorite ? "fill" : "regular"} /> {t("favorites")}
              </button>
            ) : null}
            {onShareCollection ? (
              <button onClick={onShareCollection}>
                <ShareNetwork /> {t("share")}
              </button>
            ) : null}
            {onEditMetadata ? (
              <button onClick={onEditMetadata}>
                <PencilSimple /> {t("editMetadata")}
              </button>
            ) : null}
          </div>
        </div>
      </div>
      {collection.type === "artist" ? (
        <div className="artist-collection-toolbar">
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
          {artistView === "albums" ? (
            <div
              className="artist-album-view-switcher"
              role="group"
              aria-label={t("artistAlbumViewLabel")}
            >
              <button
                type="button"
                className={artistAlbumDisplayStyle === "classic" ? "active" : ""}
                aria-pressed={artistAlbumDisplayStyle === "classic"}
                title={t("artistAlbumDisplayClassic")}
                onClick={() => onArtistAlbumDisplayStyleChange("classic")}
              >
                <SquaresFour aria-hidden="true" />
                <span>{t("artistAlbumDisplayClassic")}</span>
              </button>
              <button
                type="button"
                className={artistAlbumDisplayStyle === "showcase" ? "active" : ""}
                aria-pressed={artistAlbumDisplayStyle === "showcase"}
                title={t("artistAlbumDisplayShowcase")}
                onClick={() => onArtistAlbumDisplayStyleChange("showcase")}
              >
                <CardsThree aria-hidden="true" />
                <span>{t("artistAlbumDisplayShowcase")}</span>
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {collection.loading ? (
        <div className="collection-inline-status" role="status">
          {t("loadingContent")}
        </div>
      ) : null}
      {collection.error ? (
        <div className="collection-inline-status error" role="alert">
          <span>{collection.error}</span>
          {onRetry ? (
            <button type="button" className="collection-retry-btn" onClick={onRetry}>
              <ArrowClockwise weight="bold" /> {t("retry")}
            </button>
          ) : null}
        </div>
      ) : null}
      {collection.type === "artist" && artistView === "albums" ? (
        artistAlbums.length ? (
          <ArtistAlbumBrowser
            albums={artistAlbums}
            displayStyle={artistAlbumDisplayStyle}
            resetKey={collection.id || collection.title}
            t={t}
            onOpenAlbum={onOpenAlbumCard}
            onPlayAlbum={onPlayAlbumCard}
          />
        ) : collection.loading ? (
          <SkeletonSongList count={6} />
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
          offlineCache={offlineCache}
          onShare={onShareSong}
          onOpenAlbum={onOpenAlbum}
          onOpenArtist={onOpenArtist}
        />
      ) : collection.loading ? (
        <SkeletonSongList count={8} />
      ) : (
        <div className="empty collection-loading">{collection.error || t("emptyCollection")}</div>
      )}
    </section>
  );
}

function HistoryView({
  entries,
  loading,
  current,
  playing,
  t,
  onRefresh,
  onPlay,
  onResume,
  onFavorite,
  onAdd,
  onInsertNext,
  offlineCache,
  onShareSong,
  onOpenAlbum,
  onOpenArtist,
}: {
  entries: PlaybackHistoryEntry[];
  loading: boolean;
  current: Song | null;
  playing: boolean;
  t: ReturnType<typeof createT>;
  onRefresh: () => void;
  onPlay: (song: Song, list: Song[]) => void;
  onResume: (song: Song) => void;
  onFavorite: (song: Song) => void;
  onAdd: (song: Song) => void;
  onInsertNext: (songs: Song[]) => void;
  offlineCache: OfflineCacheControls;
  onShareSong?: (song: Song) => void;
  onOpenAlbum: (song: Song) => void;
  onOpenArtist: (song: Song) => void;
}) {
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const selectedKey = selectedDate ? localDateKey(selectedDate) : "";
  const datesWithHistory = useMemo(
    () => new Set(entries.map((entry) => localDateKey(historyEntryDate(entry)))),
    [entries],
  );
  const filteredEntries = useMemo(
    () => selectedKey
      ? entries.filter((entry) => localDateKey(historyEntryDate(entry)) === selectedKey)
      : entries,
    [entries, selectedKey],
  );
  const filteredSongs = useMemo(
    () => uniqueSongs(filteredEntries.map((entry) => entry.song), MAX_PLAYBACK_QUEUE_SIZE),
    [filteredEntries],
  );
  const groups = useMemo(() => {
    const grouped = new Map<string, PlaybackHistoryEntry[]>();
    for (const entry of filteredEntries) {
      const key = localDateKey(historyEntryDate(entry));
      grouped.set(key, [...(grouped.get(key) ?? []), entry]);
    }
    return Array.from(grouped.entries()).map(([key, items]) => ({ key, items }));
  }, [filteredEntries]);
  const offlineButtonState = (song: Song): OfflineCacheButtonState => {
    if (offlineCache.cachingSongIds.has(song.id)) return "caching";
    if (offlineCache.cachedSongIds.has(song.id)) return "cached";
    return "idle";
  };
  return (
    <section className="history-view">
      <div className="section-head history-head">
        <div>
          <h2>{t("history")}</h2>
          <p className="section-subtitle">{t("historyHint")}</p>
        </div>
        <div className="history-head-actions">
          {filteredSongs[0] ? (
            <button onClick={() => onPlay(filteredSongs[0], filteredSongs)}>
              <Play weight="fill" /> {t("playAll")}
            </button>
          ) : null}
          <button onClick={onRefresh} disabled={loading}>
            {loading ? <CircleNotch className="spin" /> : <ArrowClockwise />}
            {t("refresh")}
          </button>
        </div>
      </div>
      <div className="history-layout">
        <aside className="history-calendar-panel" aria-label={t("historyCalendar")}>
          <div className="history-calendar-head">
            <strong>{t("historyCalendar")}</strong>
            <span>{entries.length} {t("historyEvents")}</span>
          </div>
          <Calendar
            value={selectedDate}
            maxDate={new Date()}
            onChange={(value) => {
              const next = Array.isArray(value) ? value[0] : value;
              setSelectedDate(next instanceof Date ? next : null);
            }}
            tileClassName={({ date, view }) =>
              view === "month" && datesWithHistory.has(localDateKey(date)) ? "has-history" : undefined
            }
            tileContent={({ date, view }) =>
              view === "month" && datesWithHistory.has(localDateKey(date))
                ? <span className="history-calendar-dot" aria-hidden="true" />
                : null
            }
            prev2Label={null}
            next2Label={null}
          />
          <label className="history-date-input">
            <span>{t("historyDateFilter")}</span>
            <input
              type="date"
              value={selectedKey}
              max={localDateKey(new Date())}
              onChange={(event) => {
                const value = event.target.value;
                setSelectedDate(value ? new Date(`${value}T00:00:00`) : null);
              }}
            />
          </label>
          {selectedKey ? (
            <button className="history-clear-date" onClick={() => setSelectedDate(null)}>
              <X /> {t("clearDateFilter")}
            </button>
          ) : (
            <span className="history-all-dates">{t("historyAllDates")}</span>
          )}
        </aside>

        <div className="history-timeline" aria-label={t("historyTimeline")}>
          {loading && !entries.length ? (
            <SkeletonSongList count={6} />
          ) : groups.length ? (
            groups.map((group) => (
              <section key={group.key} className="history-day">
                <div className="history-day-marker">
                  <span />
                  <div>
                    <strong>{formatHistoryDayLabel(group.key, t)}</strong>
                    <small>{group.items.length} {t("historyEvents")}</small>
                  </div>
                </div>
                <div className="history-day-list">
                  {group.items.map((entry) => {
                    const song = entry.song;
                    const active = current?.id === song.id;
                    const progress = resumePosition(song) || entry.progress_seconds || 0;
                    const duration = entry.duration_seconds || song.duration_seconds || 0;
                    return (
                      <article key={entry.id} className={active ? "history-entry active" : "history-entry"}>
                        <time dateTime={entry.updated_at || entry.played_at}>
                          {formatHistoryTime(entry.updated_at || entry.played_at)}
                        </time>
                        <button className="history-entry-cover" onClick={() => onResume(song)} aria-label={t("resumeFromHistory")}>
                          <MiniCover song={song} playing={playing && active} />
                        </button>
                        <div className="history-entry-copy">
                          <button className="history-title-button" onClick={() => onResume(song)}>
                            {song.title}
                          </button>
                          <div className="history-entry-links">
                            {song.artist_id ? (
                              <button className="artist-link" onClick={() => onOpenArtist(song)}>{song.artist}</button>
                            ) : (
                              <span>{song.artist}</span>
                            )}
                            <span aria-hidden="true">·</span>
                            {song.album_id ? (
                              <button className="artist-link" onClick={() => onOpenAlbum(song)}>{song.album}</button>
                            ) : (
                              <span>{song.album}</span>
                            )}
                          </div>
                          <small>
                            {[
                              progress ? `${t("resumeFromHistory")} ${formatDuration(progress)}` : entry.completed ? t("historyCompleted") : "",
                              duration ? formatDuration(duration) : "",
                              entry.device_type,
                            ].filter(Boolean).join(" · ")}
                          </small>
                        </div>
                        <div className="history-entry-actions">
                          <button onClick={() => onResume(song)} title={t("resumeFromHistory")} aria-label={t("resumeFromHistory")}>
                            <Play weight="fill" />
                          </button>
                          <button onClick={() => onPlay(song, filteredSongs)} title={t("restartFromBeginning")} aria-label={t("restartFromBeginning")}>
                            <ArrowClockwise />
                          </button>
                          <button onClick={() => onInsertNext([song])} title={t("playNext")} aria-label={t("playNext")}>
                            <SkipForward />
                          </button>
                          <button
                            onClick={() => onFavorite(song)}
                            title={t(song.favorite ? "removeFavorite" : "addFavorite")}
                            aria-label={t(song.favorite ? "removeFavorite" : "addFavorite")}
                            aria-pressed={song.favorite}
                          >
                            <Heart weight={song.favorite ? "fill" : "regular"} />
                          </button>
                          <OfflineCacheButton
                            state={offlineButtonState(song)}
                            labels={{
                              cache: t("offlineCacheSong"),
                              caching: t("offlineCachePreparingShort"),
                              cached: t("offlineCacheReadyShort"),
                            }}
                            onClick={() => offlineCache.onCacheSong(song)}
                          />
                          <button onClick={() => onAdd(song)} title={t("addToPlaylist")} aria-label={t("addToPlaylist")}>
                            <PlaylistIcon />
                          </button>
                          {onShareSong ? (
                            <button onClick={() => onShareSong(song)} title={t("share")} aria-label={t("share")}>
                              <ShareNetwork />
                            </button>
                          ) : null}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))
          ) : (
            <EmptyState
              icon={<ClockCounterClockwise />}
              title={t("historyEmpty")}
              description={t("historyEmptyHint")}
              variant="rich"
            />
          )}
        </div>
      </div>
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
  libraryDirectories,
  onLibraryDirectoriesChange,
  mobileBasic,
  language,
  userRole,
  stats,
  songPage,
  pageLoading,
  searchQuery,
  sort,
  review,
  reviewCount,
  current,
  t,
  onPlay,
  onFavorite,
  onAdd,
  onInsertNext,
  offlineCache,
  onShareSong,
  onOpenAlbum,
  onOpenArtist,
  onEditMetadata,
  onScan,
  onUpload,
  onPlayFolder,
  onOpenRadio,
  onPlayRadio,
  onNetworkSourcesChange,
  onPlayNetworkTrack,
  scanStatus,
  onCancelScan,
  onDismissScan,
  onSongSearch,
  onPageChange,
  onSortChange,
  onReviewToggle,
  onMetadataCorrected,
}: {
  songs: Song[];
  folders: Folder[];
  networkSources: NetworkSource[];
  radioSources: RadioSource[];
  libraryDirectories: LibraryDirectory[];
  onLibraryDirectoriesChange: (directories: LibraryDirectory[]) => void;
  mobileBasic: boolean;
  language: Language;
  userRole: User["role"];
  stats: LibraryStats | null;
  songPage: SongPage | null;
  pageLoading: boolean;
  searchQuery: string;
  sort: SongSort;
  review: SongReview;
  reviewCount?: number;
  current: Song | null;
  t: ReturnType<typeof createT>;
  onPlay: (song: Song, list: Song[]) => void;
  onFavorite: (song: Song) => void;
  onAdd: (song: Song) => void;
  onInsertNext: (songs: Song[]) => void;
  offlineCache: OfflineCacheControls;
  onShareSong?: (song: Song) => void;
  onOpenAlbum: (song: Song) => void;
  onOpenArtist: (song: Song) => void;
  onEditMetadata?: (song: Song) => void;
  onScan: () => void;
  onUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  onPlayFolder: (folder: Folder) => void;
  onOpenRadio: (source?: RadioSource) => void;
  onPlayRadio: (source: RadioSource, groupSources?: RadioSource[]) => void;
  onNetworkSourcesChange: (sources: NetworkSource[]) => void;
  onPlayNetworkTrack: (track: NetworkTrack) => void;
  scanStatus: ScanStatus | null;
  onCancelScan: () => void;
  onDismissScan: () => void;
  onSongSearch: (value: string) => void;
  onPageChange: (page: number) => void | Promise<void>;
  onSortChange: (sort: SongSort) => void;
  onReviewToggle: () => void;
  onMetadataCorrected: (result: FolderMetadataCorrectionResult, path: string) => void | Promise<void>;
}) {
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [tab, setTabState] = useState<LibraryTab>(() => storedLibraryTab());
  const scanRunning = Boolean(scanStatus?.running);
  const activeTab = mobileBasic && tab !== "songs" && tab !== "folders" && tab !== "manage" ? "songs" : tab;
  const setTab = (nextTab: LibraryTab) => {
    if (mobileBasic && nextTab !== "songs" && nextTab !== "folders" && nextTab !== "manage") return;
    setTabState(nextTab);
    rememberLibraryTab(nextTab);
  };
  useEffect(() => {
    if (mobileBasic && tab !== "songs" && tab !== "folders" && tab !== "manage") {
      setTabState("songs");
      rememberLibraryTab("songs");
    }
  }, [mobileBasic, tab]);
  useEffect(() => {
    if (!searchQuery.trim()) return;
    setTabState("songs");
    rememberLibraryTab("songs");
  }, [searchQuery]);
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
  const songTotal = songPage?.total ?? stats?.songs ?? songs.length;
  return (
    <section className="library-view">
      <div className="section-head library-actions">
        <h2>{t("library")}</h2>
        <div>
          {activeTab === "songs" ? (
            <SongSearchBox t={t} value={searchQuery} onSearch={onSongSearch} />
          ) : null}
          {activeTab === "songs" ? (
            <LibrarySortControl
              value={sort}
              mobile={mobileBasic}
              labels={{ sort: t("sort"), addedDesc: t("sortAddedDesc"), addedAsc: t("sortAddedAsc"), filenameAsc: t("sortFilenameAsc"), filenameDesc: t("sortFilenameDesc") }}
              onChange={onSortChange}
            />
          ) : null}
          {activeTab === "songs" ? (
            <button type="button" className={review === "incomplete" ? "library-review-filter active" : "library-review-filter"} aria-pressed={review === "incomplete"} onClick={onReviewToggle}>
              <WarningCircle /> {t(reviewCount === 0 ? "libraryReviewComplete" : "libraryReview")}{reviewCount == null ? "" : ` · ${reviewCount}`}
            </button>
          ) : null}
          {activeTab === "songs" && selectedSongs.length ? (
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
          <button className="desktop-only-action" onClick={onScan} disabled={scanRunning}>
            <MagnifyingGlass /> {t("scan")}
          </button>
          <label className="upload desktop-only-action">
            <UploadSimple /> {t("upload")}
            <input
              type="file"
              accept="audio/*,.flac,.dsf,.dff,.dst,.ape,.wma,.cue"
              onChange={(event) => onUpload(event)}
            />
          </label>
        </div>
      </div>
      {scanStatus && !mobileBasic ? <ScanProgress status={scanStatus} t={t} onCancel={onCancelScan} onClose={onDismissScan} /> : null}
      <div className="collection-tabs library-tabs">
        <button
          className={activeTab === "songs" ? "active" : ""}
          onClick={() => setTab("songs")}
        >
          {t("localLibrary")} · {songTotal}
        </button>
        <button
          className={activeTab === "folders" ? "active" : ""}
          onClick={() => setTab("folders")}
        >
          {t("folderBrowser")} · {folders.length}
        </button>
        {mobileBasic ? (
          <button
            className={activeTab === "manage" ? "active" : ""}
            onClick={() => setTab("manage")}
          >
            {t("libraryDirectories")} · {libraryDirectories.length}
          </button>
        ) : null}
        {!mobileBasic ? (
          <>
            <button
              className={tab === "offline" ? "active" : ""}
              onClick={() => setTab("offline")}
            >
              {t("offlineCacheTab")} · {offlineCache.entries.length}
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
          </>
        ) : null}
      </div>
      {activeTab === "manage" ? (
        <LibraryDirectoryManager
          directories={libraryDirectories}
          onDirectoriesChange={onLibraryDirectoriesChange}
          language={language}
          userRole={userRole}
          t={t}
          scanStatus={scanStatus}
          onScan={onScan}
          onCancelScan={onCancelScan}
          onDismissScan={onDismissScan}
          onUpload={onUpload}
          compact={mobileBasic}
        />
      ) : activeTab === "network" ? (
        <NetworkLibrarySources
          configuredSources={networkSources}
          t={t}
          onSourcesChange={onNetworkSourcesChange}
          onPlayTrack={onPlayNetworkTrack}
        />
      ) : activeTab === "radio" ? (
        <LibraryRadioSources sources={radioSources} t={t} onOpenRadio={onOpenRadio} onPlayRadio={onPlayRadio} />
      ) : activeTab === "offline" ? (
        <OfflineLibraryPanel
          entries={offlineCache.entries}
          usage={offlineCache.usage}
          current={current}
          labels={{
            title: t("offlineCacheTab"),
            description: t("offlineCacheLibraryHint"),
            empty: t("offlineCacheEmpty"),
            play: t("play"),
            playNext: t("playNext"),
            addToPlaylist: t("addToPlaylist"),
            remove: t("offlineCacheRemove"),
            clearAll: t("clearOfflineCache"),
            cachedAt: t("offlineCacheCachedAt"),
            quality: t("quality"),
            entries: t("songs"),
          }}
          clearing={offlineCache.clearing}
          removingKeys={offlineCache.removingKeys}
          formatBytes={(bytes) => bytes > 0 ? formatBytes(bytes) : "0 KB"}
          formatDateTime={formatDateTime}
          onPlay={onPlay}
          onInsertNext={onInsertNext}
          onAdd={onAdd}
          onRemove={offlineCache.onRemoveSong}
          onClearAll={offlineCache.onClearAll}
        />
      ) : activeTab === "folders" ? (
        <FolderBrowser
          current={current}
          t={t}
          onPlay={onPlay}
          onFavorite={onFavorite}
          onAdd={onAdd}
          onInsertNext={onInsertNext}
          offlineCache={offlineCache}
          onShareSong={onShareSong}
          onOpenAlbum={onOpenAlbum}
          onOpenArtist={onOpenArtist}
          onPlayFolder={onPlayFolder}
          canCorrectMetadata={userRole === "admin"}
          onMetadataCorrected={onMetadataCorrected}
        />
      ) : pageLoading && activeTab === "songs" ? (
        <SkeletonSongList count={mobileBasic ? 6 : 8} />
      ) : songs.length ? (
        <>
          <SongTable
            songs={songs}
            current={current}
            t={t}
            onPlay={onPlay}
            onFavorite={onFavorite}
            onAdd={onAdd}
            onInsertNext={(song) => onInsertNext([song])}
            offlineCache={offlineCache}
            onShare={onShareSong}
            onOpenAlbum={onOpenAlbum}
            onOpenArtist={onOpenArtist}
            onEditMetadata={onEditMetadata}
            selectedIds={selected}
            onToggleSelected={toggleSelected}
          />
          <PaginationControls page={songPage} itemCount={songs.length} loading={pageLoading} t={t} onPageChange={onPageChange} />
        </>
      ) : review === "incomplete" ? (
        <div className="empty library-review-empty">
          <CheckCircle weight="fill" />
          <strong>{t("libraryReviewComplete")}</strong>
          <span>{t("libraryReviewCompleteHint")}</span>
          <button type="button" onClick={onReviewToggle}>{t("showAllSongs")}</button>
        </div>
      ) : (
        <EmptyLibrary t={t} mobileBasic={mobileBasic} onScan={onScan} onUpload={onUpload} scanStatus={scanStatus} />
      )}
    </section>
  );
}

function LibraryDirectoryManager({
  directories,
  onDirectoriesChange,
  language,
  userRole,
  t,
  scanStatus,
  onScan,
  onCancelScan,
  onDismissScan,
  onUpload,
  compact = false,
}: {
  directories: LibraryDirectory[];
  onDirectoriesChange: (directories: LibraryDirectory[]) => void;
  language: Language;
  userRole: User["role"];
  t: ReturnType<typeof createT>;
  scanStatus?: ScanStatus | null;
  onScan?: () => void;
  onCancelScan?: () => void;
  onDismissScan?: () => void;
  onUpload?: (event: ChangeEvent<HTMLInputElement>) => void;
  compact?: boolean;
}) {
  const [pathInput, setPathInput] = useState("");
  const [noteInput, setNoteInput] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const scanRunning = Boolean(scanStatus?.running);

  async function refreshDirectories() {
    onDirectoriesChange(await api.libraryDirectories().catch(() => []));
  }

  async function checkDirectories() {
    setChecking(true);
    setError("");
    try {
      onDirectoriesChange(await api.checkLibraryDirectories());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setChecking(false);
    }
  }

  async function addDirectory() {
    if (!pathInput.trim()) return;
    setError("");
    try {
      await api.addLibraryDirectory(pathInput.trim(), noteInput.trim());
      setPathInput("");
      setNoteInput("");
      await refreshDirectories();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function deleteDirectory(id: string) {
    setError("");
    try {
      await api.deleteLibraryDirectory(id);
      await refreshDirectories();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function updateDirectoryWatch(id: string, watchEnabled: boolean) {
    setError("");
    try {
      await api.updateLibraryDirectory(id, { watch_enabled: watchEnabled });
      await refreshDirectories();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className={compact ? "library-dir-card library-dir-card-compact" : "library-dir-card settings-wide-row"}>
      <div className="library-dir-head">
        <div>
          <strong>{t("libraryDirectories")}</strong>
          <span>{t("libraryDirectoriesHint")}</span>
        </div>
        <div className="library-dir-head-actions">
          <span>{directories.length} {t("folders")}</span>
          <button type="button" onClick={() => void checkDirectories()} disabled={checking}>
            {checking ? t("loading") : t("checkStatus")}
          </button>
        </div>
      </div>
      {compact ? (
        <div className="mobile-library-manage-actions">
          <button type="button" onClick={onScan} disabled={scanRunning}>
            <MagnifyingGlass /> {scanRunning ? t("scanning") : t("scan")}
          </button>
          {onUpload ? (
            <label className="upload">
              <UploadSimple /> {t("upload")}
              <input
                type="file"
                accept="audio/*,.flac,.dsf,.dff,.dst,.ape,.wma,.cue"
                onChange={(event) => onUpload(event)}
              />
            </label>
          ) : null}
        </div>
      ) : null}
      {scanStatus && compact && onCancelScan && onDismissScan ? (
        <ScanProgress status={scanStatus} t={t} onCancel={onCancelScan} onClose={onDismissScan} />
      ) : null}
      <div className="library-dir-list">
        {directories.map((dir) => (
          <div key={dir.id} className={dir.builtin ? "library-dir-row builtin" : "library-dir-row"}>
            <div>
              <strong>{dir.builtin ? t("envLibraryDirectory") : (dir.note || t("customLibraryDirectory"))}</strong>
              <span>{dir.path}</span>
              <small className={dir.status === "online" ? "dir-status online" : "dir-status"}>
                {libraryDirectoryStatusLabel(dir.status || "online", language)}
                {dir.builtin ? <b>{t("readOnly")}</b> : null}
                {dir.last_error ? ` · ${dir.last_error}` : ""}
              </small>
            </div>
            <div className="library-dir-actions">
              <label className="dir-watch-toggle" title={t("directoryWatchHint")}>
                <span>{t("directoryWatch")}</span>
                <input
                  type="checkbox"
                  checked={dir.watch_enabled}
                  disabled={dir.builtin && userRole !== "admin"}
                  onChange={(event) => void updateDirectoryWatch(dir.id, event.target.checked)}
                />
              </label>
              {dir.watch_enabled ? (
                <em>{dir.watch_active ? t("enabled") : t("disabled")}</em>
              ) : dir.builtin ? null : (
                <button type="button" className="danger" onClick={() => void deleteDirectory(dir.id)}>{t("remove")}</button>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="library-dir-form">
        <label>
          {t("customLibraryPath")}
          <input value={pathInput} placeholder="/mnt/music" onChange={(event) => setPathInput(event.target.value)} />
        </label>
        <label>
          {t("libraryDirectoryNote")}
          <input value={noteInput} placeholder={t("libraryDirectoryNotePlaceholder")} onChange={(event) => setNoteInput(event.target.value)} />
        </label>
        <button type="button" onClick={() => void addDirectory()} disabled={!pathInput.trim()}>
          <Plus /> {t("addLibraryDirectory")}
        </button>
      </div>
      {error ? <div className="settings-empty error">{error}</div> : null}
    </div>
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
  offlineCache,
  onShareSong,
  onOpenAlbum,
  onOpenArtist,
  onPlayFolder,
  canCorrectMetadata,
  onMetadataCorrected,
}: {
  current: Song | null;
  t: ReturnType<typeof createT>;
  onPlay: (song: Song, list: Song[]) => void;
  onFavorite: (song: Song) => void;
  onAdd: (song: Song) => void;
  onInsertNext: (songs: Song[]) => void;
  offlineCache: OfflineCacheControls;
  onShareSong?: (song: Song) => void;
  onOpenAlbum: (song: Song) => void;
  onOpenArtist: (song: Song) => void;
  onPlayFolder: (folder: Folder) => void;
  canCorrectMetadata: boolean;
  onMetadataCorrected: (result: FolderMetadataCorrectionResult, path: string) => void | Promise<void>;
}) {
  const [path, setPath] = useState(".");
  const [directory, setDirectory] = useState<FolderDirectory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [correctionOpen, setCorrectionOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void withTimeout(api.folderDirectory(path))
      .then((item) => {
        if (!cancelled) setDirectory(item);
      })
      .catch((err) => {
        if (!cancelled) setError(friendlyLoadError(err, t as unknown as (key: string) => string));
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
  const correctionAvailable = Boolean(currentFolder?.song_count && directory && directory.breadcrumbs.length > 1);

  const insertFolderNext = async (folder: Folder) => {
    const items = await api.folderSongs(folder.path, MAX_PLAYBACK_QUEUE_SIZE);
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
          {canCorrectMetadata ? (
            <button
              disabled={!correctionAvailable}
              onClick={() => setCorrectionOpen(true)}
            >
              <PencilSimple aria-hidden="true" /> {t("folderMetadataCorrect")}
            </button>
          ) : null}
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
                offlineCache={offlineCache}
                onShare={onShareSong}
                onOpenAlbum={onOpenAlbum}
                onOpenArtist={onOpenArtist}
              />
            ) : (
              <div className="empty mini-empty">{t("emptyCollection")}</div>
            )}
          </div>
        </>
      ) : null}
      {correctionOpen && directory ? (
        <FolderMetadataCorrectionDialog
          path={directory.path}
          folderName={directory.name}
          initialField={directory.breadcrumbs.length >= 3 ? "album" : "artist"}
          t={t}
          onClose={() => setCorrectionOpen(false)}
          onDatabaseUpdated={async (result) => {
            await onMetadataCorrected(result, directory.path);
            const refreshedDirectory = await api.folderDirectory(directory.path);
            setDirectory(refreshedDirectory);
          }}
        />
      ) : null}
    </section>
  );
}

function lyricLinePositionClass(
  index: number,
  activeIndex: number,
  activeGroupKey?: string,
  groupKey?: string,
) {
  if (activeIndex < 0) return "";
  if (index === activeIndex) return "live";
  if (activeGroupKey && groupKey === activeGroupKey) return "live-peer next next-1";
  const delta = index - activeIndex;
  if (delta < 0) return `past past-${Math.min(Math.abs(delta), 3)}`;
  const depth = Math.min(delta, 3);
  return `upcoming next next-${depth}${depth >= 2 ? " far-upcoming" : ""}`;
}

function renderLyricLineText(text: string, displayStyle: LyricsDisplayStyle, active: boolean): ReactNode {
  if (!active || (displayStyle !== "folia-tilt" && displayStyle !== "folia-cadenza")) return text;
  let glyphIndex = 0;
  return (text.match(/\S+|\s+/g) || [" "]).map((token, tokenIndex) => {
    if (/^\s+$/.test(token)) return <Fragment key={`space-${tokenIndex}`}>{token}</Fragment>;
    return (
      <span key={`word-${tokenIndex}`} className="lyric-word">
        {Array.from(token).map((char, charIndex) => {
          const currentGlyphIndex = glyphIndex;
          glyphIndex += 1;
          return (
            <span
              key={`${char}-${charIndex}`}
              className="lyric-glyph"
              style={{
                "--glyph-delay": `${currentGlyphIndex * 18}ms`,
                "--glyph-spark-delay": `${currentGlyphIndex * -42}ms`,
              } as React.CSSProperties}
            >
              {char}
            </span>
          );
        })}
      </span>
    );
  });
}

function FullLyrics({
  song,
  lines,
  activeLyric,
  lyricsSource,
  lyricsDisplayStyle,
  lyrics,
  loading,
  progress,
  lyricOffsetMs,
  onAdjustLyricOffset,
  onResetLyricOffset,
  t,
  scrollRef,
  onToggleView,
  onSeek,
  lyricsDragSeekEnabled,
  candidates,
  candidatesOpen,
  candidatesLoading,
  onOpenCandidates,
  onRefreshCandidates,
  onSelectCandidate,
  onCloseCandidates,
  onUserScroll,
  onOpenArtist,
  onOpenAlbum,
  onFavoriteSong,
  onEditMetadata,
}: {
  song: Song | null;
  lines: ReturnType<typeof parseLyricLines>;
  activeLyric: string;
  lyricsSource: string;
  lyricsDisplayStyle: LyricsDisplayStyle;
  lyrics: Lyrics | null;
  loading: boolean;
  progress: number;
  lyricOffsetMs: number;
  onAdjustLyricOffset: (deltaMs: number) => void;
  onResetLyricOffset: () => void;
  t: ReturnType<typeof createT>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onToggleView: () => void;
  onSeek: (seconds: number) => void;
  lyricsDragSeekEnabled: boolean;
  candidates: LyricCandidate[];
  candidatesOpen: boolean;
  candidatesLoading: boolean;
  onOpenCandidates: () => void;
  onRefreshCandidates: () => void;
  onSelectCandidate: (candidate: LyricCandidate) => void;
  onCloseCandidates: () => void;
  onUserScroll: () => void;
  onOpenArtist: (song: Song) => void;
  onOpenAlbum: (song: Song) => void;
  onFavoriteSong: (song: Song) => void;
  onEditMetadata: (song: Song) => void;
}) {
  const [seekTargetKey, setSeekTargetKey] = useState("");
  const [lyricsToolsTab, setLyricsToolsTab] = useState<"candidates" | "offset">("candidates");
  const userScrollUntil = useRef(0);
  const seekTimer = useRef<number | null>(null);
  const lyricsTitle = song?.title ?? `${t("brand")} Music`;
  const onlineLyrics = hasOnlineLyricsSource(lyricsSource) && lines.length > 0;
  const matchConfidence = lyricsMatchConfidence(song, lyrics, lines);
  const showMatchWarning = onlineLyrics && matchConfidence === "low";
  const lyricOffsetSeconds = lyricOffsetMs / 1000;
  const activeLyricIndex = useMemo(
    () => lines.findIndex((line) => line.key === activeLyric),
    [activeLyric, lines],
  );
  const activeLyricLine = activeLyricIndex >= 0 ? lines[activeLyricIndex] : null;
  const visualLyrics = lyricsDisplayStyle !== "classic";
  const foliaLyrics = lyricsDisplayStyle.startsWith("folia-");
  const songCoverUrl = coverUrl(song);
  const [coverTone, setCoverTone] = useState("");
  const backgroundStyle = useMemo(
    () =>
      ({
        ...(songCoverUrl ? { "--cover-url": `url(${songCoverUrl})` } : {}),
        ...(coverTone ? { "--lyrics-cover-tone": coverTone } : {}),
      }) as React.CSSProperties,
    [coverTone, songCoverUrl],
  );
  useEffect(() => {
    if (!songCoverUrl || !visualLyrics) {
      setCoverTone("");
      return;
    }
    let cancelled = false;
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.onload = () => {
      if (cancelled) return;
      const canvas = document.createElement("canvas");
      const size = 18;
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return;
      try {
        context.drawImage(image, 0, 0, size, size);
        const pixels = context.getImageData(0, 0, size, size).data;
        let red = 0;
        let green = 0;
        let blue = 0;
        let total = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          const alpha = pixels[index + 3] / 255;
          if (alpha < 0.45) continue;
          const r = pixels[index];
          const g = pixels[index + 1];
          const b = pixels[index + 2];
          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          const saturation = (max - min) / 255;
          const brightness = (r + g + b) / (255 * 3);
          const weight = alpha * (0.45 + saturation) * (0.55 + Math.min(brightness, 0.82));
          red += r * weight;
          green += g * weight;
          blue += b * weight;
          total += weight;
        }
        if (!cancelled && total > 0) {
          setCoverTone(
            `rgb(${Math.round(red / total)} ${Math.round(green / total)} ${Math.round(blue / total)})`,
          );
        }
      } catch {
        if (!cancelled) setCoverTone("");
      }
    };
    image.onerror = () => {
      if (!cancelled) setCoverTone("");
    };
    image.src = songCoverUrl;
    return () => {
      cancelled = true;
    };
  }, [songCoverUrl, visualLyrics]);
  useEffect(() => {
    return () => {
      if (seekTimer.current != null) window.clearTimeout(seekTimer.current);
    };
  }, []);
  const clearPendingLyricSeek = useCallback((clearTarget = false) => {
    if (seekTimer.current != null) {
      window.clearTimeout(seekTimer.current);
      seekTimer.current = null;
    }
    if (clearTarget) setSeekTargetKey((current) => (current ? "" : current));
  }, []);
  useEffect(() => {
    clearPendingLyricSeek(lyricsDragSeekEnabled);
  }, [clearPendingLyricSeek, lyricsDragSeekEnabled]);
  const syncSeekTargetFromScroll = () => {
    const container = scrollRef.current;
    if (!container) return;
    if (lyricsDragSeekEnabled && Date.now() > userScrollUntil.current) return;
    const anchor =
      container.getBoundingClientRect().top +
      container.clientHeight * LYRIC_ACTIVE_ANCHOR_RATIO;
    const nodes = Array.from(
      container.querySelectorAll<HTMLElement>("[data-lyric-key]"),
    );
    let best: { key: string; at: number; distance: number } | null = null;
    for (const node of nodes) {
      const at = Number(node.dataset.lyricAt);
      if (node.dataset.lyricTimed !== "true" || !Number.isFinite(at)) continue;
      const rect = node.getBoundingClientRect();
      const distance = Math.abs(rect.top + rect.height / 2 - anchor);
      if (!best || distance < best.distance) {
        best = { key: node.dataset.lyricKey || "", at, distance };
      }
    }
    if (!best) return;
    setSeekTargetKey(best.key);
    if (!lyricsDragSeekEnabled) {
      clearPendingLyricSeek();
      return;
    }
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
  const openLyricsTools = () => {
    setLyricsToolsTab("candidates");
    onOpenCandidates();
  };
  return (
    <section
      className="full-lyrics"
      data-display-style={lyricsDisplayStyle}
      data-folia-mode={foliaLyrics ? "true" : "false"}
      data-has-cover={songCoverUrl ? "true" : "false"}
      style={backgroundStyle}
    >
      {visualLyrics ? (
        <div className="lyrics-depth-stage" aria-hidden="true">
          <PaperShaderLayer variant="lyrics" playing={!loading} cover={songCoverUrl} />
          <span className="lyrics-depth-cover" />
          <span className="lyrics-depth-beam" />
          <span className="lyrics-depth-rings">
            {LYRICS_DEPTH_RINGS.map((index) => (
              <i
                key={index}
                style={{
                  "--lyrics-ring-index": index,
                  "--lyrics-ring-scale": (0.78 + index * 0.2).toFixed(2),
                  "--lyrics-ring-delay": `${index * -1.2}s`,
                } as React.CSSProperties}
              />
            ))}
          </span>
          <span className="lyrics-depth-particles">
            {LYRICS_DEPTH_PARTICLES.map((index) => (
              <i
                key={index}
                style={{
                  "--lyrics-particle-x": `${Math.round(8 + motionSeed(index, 1.3) * 84)}%`,
                  "--lyrics-particle-y": `${Math.round(10 + motionSeed(index, 2.7) * 78)}%`,
                  "--lyrics-particle-size": `${2 + Math.round(motionSeed(index, 4.2) * 4)}px`,
                  "--lyrics-particle-delay": `${index * -0.21}s`,
                  "--lyrics-particle-duration": `${4.6 + motionSeed(index, 7.9) * 4.8}s`,
                } as React.CSSProperties}
              />
            ))}
          </span>
          {foliaLyrics ? (
            <>
              <span className="lyrics-folia-poster" />
              <span className="lyrics-folia-fume-paper">
                {Array.from({ length: 5 }, (_, index) => (
                  <i
                    key={index}
                    style={{
                      "--folia-smoke-x": `${8 + index * 17}%`,
                      "--folia-smoke-y": `${14 + (index % 3) * 22}%`,
                      "--folia-smoke-delay": `${index * -0.8}s`,
                    } as React.CSSProperties}
                  />
                ))}
              </span>
              <span className="lyrics-folia-tilt-field">
                {Array.from({ length: 7 }, (_, index) => (
                  <i
                    key={index}
                    style={{
                      "--folia-tilt-x": `${6 + index * 13}%`,
                      "--folia-tilt-y": `${18 + (index % 4) * 17}%`,
                      "--folia-tilt-angle": `${-18 + index * 5}deg`,
                      "--folia-tilt-delay": `${index * -0.34}s`,
                    } as React.CSSProperties}
                  />
                ))}
              </span>
              <span className="lyrics-folia-cadenza-field">
                {Array.from({ length: 9 }, (_, index) => (
                  <i
                    key={index}
                    style={{
                      "--folia-beam-x": `${-16 + index * 15}%`,
                      "--folia-beam-y": `${12 + (index % 5) * 17}%`,
                      "--folia-beam-angle": `${-24 + index * 7}deg`,
                      "--folia-beam-delay": `${index * -0.22}s`,
                    } as React.CSSProperties}
                  />
                ))}
              </span>
            </>
          ) : null}
        </div>
      ) : null}
      <div className="full-lyrics-head">
        <button
          className="full-lyrics-cover-button"
          type="button"
          title={t("expandPlayer")}
          aria-label={t("expandPlayer")}
          onClick={onToggleView}
        >
          <MiniCover song={song} playing={false} />
        </button>
        <div className="lyrics-title-block">
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
            {showMatchWarning ? (
              <span className="lyrics-match-warn" title={t("lyricsMatchWarn")}>
                <WarningCircle weight="fill" />
                <span>{t("lyricsMatchWarn")}</span>
              </span>
            ) : null}
            <button
              className={song.favorite ? "lyrics-pick lyrics-favorite active" : "lyrics-pick lyrics-favorite"}
              onClick={() => onFavoriteSong(song)}
              aria-label={t(song.favorite ? "removeFavorite" : "addFavorite")}
              aria-pressed={song.favorite}
            >
              <Heart weight={song.favorite ? "fill" : "regular"} />
              <span>{t("favorites")}</span>
            </button>
            <button
              className={onlineLyrics ? "lyrics-pick icon-only has-source" : "lyrics-pick icon-only"}
              onClick={openLyricsTools}
              title={t("chooseLyrics")}
              aria-label={t("chooseLyrics")}
            >
              {onlineLyrics ? (
                <Cloud
                  className="lyrics-source-icon"
                  weight="fill"
                  aria-label={t("onlineLyrics")}
                />
              ) : null}
              <GearSix weight="bold" />
            </button>
            <button
              className="lyrics-pick icon-only"
              onClick={() => onEditMetadata(song)}
              title={t("editMetadata")}
              aria-label={t("editMetadata")}
            >
              <PencilSimple weight="bold" />
            </button>
          </div>
        ) : null}
      </div>
      {candidatesOpen ? (
        <div className="lyrics-candidates lyrics-tools">
          <div className="lyrics-tools-head">
            <strong>{t("chooseLyrics")}</strong>
            <span>
              <button type="button" onClick={onRefreshCandidates} disabled={candidatesLoading}><ArrowClockwise /> {t("refresh")}</button>
              <button onClick={onCloseCandidates}>{t("close")}</button>
            </span>
          </div>
          <div className="lyrics-tools-tabs" role="tablist" aria-label={t("chooseLyrics")}>
            <button
              type="button"
              role="tab"
              aria-selected={lyricsToolsTab === "candidates"}
              aria-controls="lyrics-candidates-panel"
              className={lyricsToolsTab === "candidates" ? "active" : ""}
              onClick={() => setLyricsToolsTab("candidates")}
            >
              {t("chooseLyrics")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={lyricsToolsTab === "offset"}
              aria-controls="lyrics-offset-panel"
              className={lyricsToolsTab === "offset" ? "active" : ""}
              onClick={() => setLyricsToolsTab("offset")}
            >
              <span>{t("lyricsOffset")}</span>
              <strong>{formatLyricOffset(lyricOffsetMs)}</strong>
            </button>
          </div>
          {lyricsToolsTab === "candidates" ? (
            <div id="lyrics-candidates-panel" className="lyrics-candidates-list" role="tabpanel">
              {candidatesLoading ? (
                <p>{t("matchingLyrics")}</p>
              ) : candidates.length ? (
                candidates.map((candidate, index) => (
                  <button
                    key={`${candidate.source}-${candidate.id}`}
                    type="button"
                    className="lyrics-candidate-item"
                    onClick={() => onSelectCandidate(candidate)}
                  >
                    <span className="lyrics-candidate-icon" aria-hidden="true">
                      <MusicNotes weight="fill" />
                    </span>
                    <span className="lyrics-candidate-copy">
                      <strong>{candidate.title}</strong>
                      <span>{candidate.artist || t("artist")}</span>
                    </span>
                    <span className="lyrics-candidate-meta">
                      <em title={candidate.source}>{candidate.source}</em>
                      <small>{t("candidate")} {index + 1}</small>
                    </span>
                  </button>
                ))
              ) : (
                <p>{t("noLyricsTitle")}</p>
              )}
            </div>
          ) : (
            <div
              id="lyrics-offset-panel"
              className="lyrics-offset-panel lyrics-offset-panel--embedded"
              role="tabpanel"
              aria-label={t("lyricsOffset")}
            >
              <div>
                <span>{t("lyricsOffset")}</span>
                <strong>{formatLyricOffset(lyricOffsetMs)}</strong>
              </div>
              <div className="lyrics-offset-actions">
                {LYRIC_OFFSET_STEP_MS.map((step) => (
                  <button
                    key={step}
                    type="button"
                    onClick={() => onAdjustLyricOffset(step)}
                    aria-label={`${step > 0 ? "+" : ""}${step} ms`}
                  >
                    {step < 0 ? <Minus /> : <Plus />}
                    <span>{step > 0 ? `+${step}` : step}ms</span>
                  </button>
                ))}
                <button
                  type="button"
                  className="lyrics-offset-reset"
                  onClick={onResetLyricOffset}
                  disabled={lyricOffsetMs === 0}
                >
                  <ArrowClockwise />
                  <span>{t("lyricsOffsetReset")}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}
      <div
        className={lines.length ? "full-lyrics-lines" : "full-lyrics-lines empty-state"}
        data-drag-seek={lyricsDragSeekEnabled ? "true" : "false"}
        ref={scrollRef}
        onScroll={syncSeekTargetFromScroll}
        onWheel={markUserScroll}
        onTouchMove={markUserScroll}
      >
        {lines.length ? (
          lines.map((line, index) => {
            const lyricTime = adjustedLyricTime(line, lyricOffsetSeconds);
            const showCursorPlay = !lyricsDragSeekEnabled && line.key === seekTargetKey && line.at >= 0;
            const nextTimedLine = lines
              .slice(index + 1)
              .find((candidate) => candidate.at >= 0 && adjustedLyricTime(candidate, lyricOffsetSeconds) > lyricTime);
            const nextLyricTime = nextTimedLine
              ? adjustedLyricTime(nextTimedLine, lyricOffsetSeconds)
              : lyricTime + 4;
            const isLive = line.key === activeLyric;
            const lyricProgress =
              isLive && line.at >= 0
                ? Math.max(0, Math.min(1, (progress - lyricTime) / Math.max(1.2, nextLyricTime - lyricTime)))
                : 0;
            const lineStyle = isLive
              ? ({ "--lyric-progress": `${Math.round(lyricProgress * 100)}%` } as React.CSSProperties)
              : undefined;
            return (
              <p
                key={line.key}
                data-lyric-key={line.key}
                data-lyric-at={lyricTime}
                data-lyric-timed={line.at >= 0 ? "true" : "false"}
                aria-current={isLive ? "true" : undefined}
                style={lineStyle}
                className={[
                  lyricLinePositionClass(index, activeLyricIndex, activeLyricLine?.groupKey, line.groupKey),
                  line.key === seekTargetKey ? "seek-target" : "",
                  showCursorPlay ? "has-cursor-action" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={lyricsDragSeekEnabled ? () => line.at >= 0 && onSeek(lyricTime) : undefined}
              >
                <span className="lyric-line-text" data-text={line.text}>
                  {renderLyricLineText(line.text, lyricsDisplayStyle, isLive)}
                </span>
                {showCursorPlay ? (
                  <button
                    type="button"
                    className="lyrics-cursor-play"
                    title={t("playFromLyric")}
                    aria-label={t("playFromLyric")}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSeek(lyricTime);
                    }}
                  >
                    <Play weight="fill" />
                  </button>
                ) : null}
              </p>
            );
          })
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
  onCancel,
  onClose,
  compact = false,
}: {
  status: ScanStatus;
  t: ReturnType<typeof createT>;
  onCancel?: () => void;
  onClose?: () => void;
  compact?: boolean;
}) {
  const currentName = status.current_path || status.current_dir || "—";
  const showCurrentPaths = status.running;
  return (
    <div className={compact ? "scan-progress compact" : "scan-progress"}>
      <div className="scan-progress-head">
        <strong>{status.running ? t("scanning") : status.canceled ? t("scanCanceled") : t("done")}</strong>
        {status.running && onCancel ? (
          <button type="button" onClick={onCancel}>{t("cancelScan")}</button>
        ) : onClose ? (
          <button type="button" onClick={onClose}>{t("close")}</button>
        ) : (
          <span>{t("scanStats")}</span>
        )}
      </div>
      <div className="scan-progress-stats">
        <span>{status.scanned}</span>
        <span>{status.added}</span>
        <span>{status.updated}</span>
        <span>{status.skipped}</span>
      </div>
      {showCurrentPaths ? (
        <>
          <p>
            <b>{t("scanCurrentDir")}</b>
            <span>{status.current_dir || "—"}</span>
          </p>
          <p>
            <b>{t("scanCurrentFile")}</b>
            <span>{currentName}</span>
          </p>
        </>
      ) : null}
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
  mobileBasic,
  onScan,
  onUpload,
  scanStatus,
}: {
  t: ReturnType<typeof createT>;
  mobileBasic?: boolean;
  onScan: () => void;
  onUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  scanStatus: ScanStatus | null;
}) {
  const scanRunning = Boolean(scanStatus?.running);
  return (
    <section className="empty-library">
      <div className="disc-art">
        <Record weight="fill" />
      </div>
      <h2>{t("emptyTitle")}</h2>
      <p>{t("emptyBody")}</p>
      {!mobileBasic ? (
        <>
          <div className="empty-actions">
            <button className="primary" onClick={onScan} disabled={scanRunning}>
              <MagnifyingGlass /> {t("scan")}
            </button>
            <label className="upload">
              <UploadSimple /> {t("upload")}
              <input
                type="file"
                accept="audio/*,.flac,.dsf,.dff,.dst,.ape,.wma,.cue"
                onChange={(event) => onUpload(event)}
              />
            </label>
          </div>
          <small>{t("scanHint")}</small>
          {scanStatus ? <ScanProgress status={scanStatus} t={t} compact /> : null}
        </>
      ) : null}
    </section>
  );
}

function RadioQueuePanel({
  stations,
  currentRadio,
  playing,
  modal = false,
  t,
  onPlay,
  onClose,
}: {
  stations: RadioStation[];
  currentRadio: RadioStation | null;
  playing: boolean;
  modal?: boolean;
  t: ReturnType<typeof createT>;
  onPlay: (station: RadioStation) => void;
  onClose: () => void;
}) {
  const dialogRef = useDialogLifecycle<HTMLDivElement>(onClose, modal);
  return (
    <div
      ref={modal ? dialogRef : undefined}
      className="queue-panel radio-queue-panel"
      role={modal ? "dialog" : undefined}
      aria-modal={modal ? "true" : undefined}
      aria-labelledby="radio-queue-title"
    >
      <div className="queue-head radio-queue-head">
        <strong id="radio-queue-title">{t("onlineRadio")}</strong>
        <button type="button" data-autofocus aria-label={t("close")} onClick={onClose}>×</button>
      </div>
      <div className="queue-list radio-queue-list">
        {stations.map((station, index) => {
          const active = sameRadioStation(station, currentRadio);
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
  modal = false,
  t,
  onPlay,
  onClose,
}: {
  queue: Song[];
  current: Song | null;
  modal?: boolean;
  t: ReturnType<typeof createT>;
  onPlay: (song: Song) => void;
  onClose: () => void;
}) {
  const dialogRef = useDialogLifecycle<HTMLDivElement>(onClose, modal);
  return (
    <div
      ref={modal ? dialogRef : undefined}
      className="queue-panel"
      role={modal ? "dialog" : undefined}
      aria-modal={modal ? "true" : undefined}
      aria-labelledby="queue-panel-title"
    >
      <div className="queue-head">
        <strong id="queue-panel-title">{t("queue")}</strong>
        <button type="button" data-autofocus aria-label={t("close")} onClick={onClose}>×</button>
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
  mode,
  minutes,
  left,
  songsLeft,
  onOpen,
  t,
}: {
  mode: SleepTimerMode;
  minutes: number;
  left: number;
  songsLeft: number;
  onOpen: () => void;
  t: ReturnType<typeof createT>;
}) {
  const active = mode !== "off";
  const minutesLeft = Math.max(1, Math.ceil(left / 60) || minutes);
  const badge =
    mode === "time"
      ? String(minutesLeft)
      : mode === "songs"
        ? String(Math.max(1, songsLeft))
        : mode === "album"
          ? t("sleepAlbumBadge")
          : "";
  const label =
    mode === "time"
      ? `${t("sleepTimer")}: ${formatSleepMinutesLabel(minutesLeft, t)}`
      : mode === "songs"
        ? `${t("sleepTimer")}: ${formatSleepSongsLabel(Math.max(1, songsLeft), t)}`
        : mode === "album"
          ? `${t("sleepTimer")}: ${t("sleepAfterCurrentAlbum")}`
          : t("sleepTimer");
  return (
    <button
      type="button"
      className={active ? "sleep-control active" : "sleep-control"}
      title={label}
      aria-label={label}
      aria-haspopup="dialog"
      onClick={onOpen}
    >
      <Timer />
      {active ? <span className="sleep-countdown">{badge}</span> : null}
    </button>
  );
}

function SleepTimerDialog({
  mode,
  minutes,
  left,
  songsLeft,
  albumTitle,
  canUseSongTimer,
  canUseAlbumTimer,
  t,
  onClose,
  onClear,
  onSetTime,
  onSetSongs,
  onSetAlbum,
}: {
  mode: SleepTimerMode;
  minutes: number;
  left: number;
  songsLeft: number;
  albumTitle: string;
  canUseSongTimer: boolean;
  canUseAlbumTimer: boolean;
  t: ReturnType<typeof createT>;
  onClose: () => void;
  onClear: () => void;
  onSetTime: (minutes: number) => void;
  onSetSongs: (count: number) => void;
  onSetAlbum: () => void;
}) {
  const [customMinutes, setCustomMinutes] = useState(minutes && !SLEEP_DURATION_PRESETS.includes(minutes as typeof SLEEP_DURATION_PRESETS[number]) ? String(minutes) : "45");
  const [customSongs, setCustomSongs] = useState(songsLeft && !SLEEP_SONG_PRESETS.includes(songsLeft as typeof SLEEP_SONG_PRESETS[number]) ? String(songsLeft) : "2");
  const dialogRef = useDialogLifecycle<HTMLDivElement>(onClose);
  const statusDetail =
    mode === "time"
      ? formatSleepMinutesLabel(Math.max(1, Math.ceil(left / 60) || minutes), t)
      : mode === "songs"
        ? formatSleepSongsLabel(Math.max(1, songsLeft), t)
        : mode === "album"
          ? albumTitle || t("album")
          : t("sleepNoTimer");
  const customMinutesValue = Number(customMinutes);
  const customSongsValue = Number(customSongs);
  const canApplyMinutes = Number.isFinite(customMinutesValue) && customMinutesValue >= 1;
  const canApplySongs = Number.isFinite(customSongsValue) && customSongsValue >= 1;

  return (
    <div className="modal-layer sleep-timer-layer" role="presentation">
      <button className="modal-scrim" type="button" aria-label={t("close")} onClick={onClose} />
      <div
        ref={dialogRef}
        className="modal-card sleep-timer-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sleep-timer-title"
      >
        <div className="modal-card-head">
          <div>
            <p>{t("nowPlaying")}</p>
            <h2 id="sleep-timer-title">{t("sleepTimer")}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label={t("close")}>
            <X />
            <span>{t("close")}</span>
          </button>
        </div>

        <div className="sleep-timer-status" data-active={mode !== "off"}>
          <Timer />
          <div>
            <strong>{mode === "off" ? t("sleepNoTimer") : t("sleepTimerEnabled")}</strong>
            <span>{statusDetail}</span>
          </div>
          <button type="button" onClick={onClear} disabled={mode === "off"}>
            {t("off")}
          </button>
        </div>

        <div className="sleep-timer-groups">
          <section className="sleep-timer-section">
            <div>
              <strong>{t("sleepByDuration")}</strong>
              <span>{t("sleepByDurationHint")}</span>
            </div>
            <div className="sleep-option-grid" role="group" aria-label={t("sleepByDuration")}>
              {SLEEP_DURATION_PRESETS.map((value) => (
                <button
                  key={value}
                  type="button"
                  className={mode === "time" && minutes === value ? "sleep-option selected" : "sleep-option"}
                  aria-pressed={mode === "time" && minutes === value}
                  onClick={() => onSetTime(value)}
                >
                  {mode === "time" && minutes === value ? <CheckCircle weight="fill" /> : <Timer />}
                  <span>{formatSleepMinutesLabel(value, t)}</span>
                </button>
              ))}
            </div>
            <form
              className="sleep-custom-row"
              onSubmit={(event) => {
                event.preventDefault();
                if (canApplyMinutes) onSetTime(customMinutesValue);
              }}
            >
              <label htmlFor="sleep-custom-minutes">{t("sleepCustomMinutes")}</label>
              <input
                id="sleep-custom-minutes"
                type="number"
                inputMode="numeric"
                min="1"
                max="1440"
                value={customMinutes}
                onChange={(event) => setCustomMinutes(event.target.value)}
              />
              <button type="submit" disabled={!canApplyMinutes}>{t("apply")}</button>
            </form>
          </section>

          <section className="sleep-timer-section">
            <div>
              <strong>{t("sleepBySongs")}</strong>
              <span>{canUseSongTimer ? t("sleepBySongsHint") : t("sleepSongsUnavailable")}</span>
            </div>
            <div className="sleep-option-grid sleep-song-grid" role="group" aria-label={t("sleepBySongs")}>
              {SLEEP_SONG_PRESETS.map((value) => (
                <button
                  key={value}
                  type="button"
                  className={mode === "songs" && songsLeft === value ? "sleep-option selected" : "sleep-option"}
                  aria-pressed={mode === "songs" && songsLeft === value}
                  disabled={!canUseSongTimer}
                  onClick={() => onSetSongs(value)}
                >
                  {mode === "songs" && songsLeft === value ? <CheckCircle weight="fill" /> : <MusicNotes />}
                  <span>{formatSleepSongsLabel(value, t)}</span>
                </button>
              ))}
            </div>
            <form
              className="sleep-custom-row"
              onSubmit={(event) => {
                event.preventDefault();
                if (canUseSongTimer && canApplySongs) onSetSongs(customSongsValue);
              }}
            >
              <label htmlFor="sleep-custom-songs">{t("sleepCustomSongs")}</label>
              <input
                id="sleep-custom-songs"
                type="number"
                inputMode="numeric"
                min="1"
                max="99"
                value={customSongs}
                disabled={!canUseSongTimer}
                onChange={(event) => setCustomSongs(event.target.value)}
              />
              <button type="submit" disabled={!canUseSongTimer || !canApplySongs}>{t("apply")}</button>
            </form>
          </section>

          <section className="sleep-timer-section sleep-album-section">
            <div>
              <strong>{t("sleepByAlbum")}</strong>
              <span>{canUseAlbumTimer ? t("sleepByAlbumHint") : t("sleepAlbumUnavailable")}</span>
            </div>
            <button
              type="button"
              className={mode === "album" ? "sleep-option sleep-album-option selected" : "sleep-option sleep-album-option"}
              aria-pressed={mode === "album"}
              disabled={!canUseAlbumTimer}
              onClick={onSetAlbum}
            >
              {mode === "album" ? <CheckCircle weight="fill" /> : <Disc />}
              <span>{t("sleepAfterCurrentAlbum")}</span>
              <small>{albumTitle || t("album")}</small>
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}

function formatSleepMinutesLabel(minutes: number, t: ReturnType<typeof createT>) {
  return minutes % 60 === 0
    ? `${minutes / 60} ${t("hours")}`
    : `${minutes} ${t("minutes")}`;
}

function formatSleepSongsLabel(count: number, t: ReturnType<typeof createT>) {
  return `${count} ${count === 1 ? t("sleepSongSingular") : t("sleepSongPlural")}`;
}

function formatLyricOffset(valueMs: number) {
  return `${valueMs > 0 ? "+" : ""}${valueMs} ms`;
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
  mobileViewport,
  homePlayerStyle,
  onHomePlayerStyleChange,
  mobileHomePlayerStyle,
  onMobileHomePlayerStyleChange,
  mineradioStageEnabled,
  onMineradioStageEnabledChange,
  artistAlbumDisplayStyle,
  onArtistAlbumDisplayStyleChange,
  lyricsDisplayStyle,
  onLyricsDisplayStyleChange,
  lyricsDragSeekEnabled,
  onLyricsDragSeekEnabledChange,
  persistentQueueEnabled,
  onPersistentQueueChange,
  uiSoundSettings,
  onUISoundSettingsChange,
  playbackHistorySettings,
  onPlaybackHistorySettingsChange,
  offlineUsage,
  autoCachePlayed,
  onAutoCachePlayedChange,
  onRefreshOfflineUsage,
  onManageOfflineCache,
  scrobblingSettings,
  onScrobblingSettingsChange,
  activeTab,
  onTabChange,
  onOpenAlbums,
  onOpenPlaylists,
  onUpdateProfile,
  pluginHostTheme,
  pluginHostPlayerState,
  onPluginHostCall,
  t,
}: {
  settings: Settings;
  setSettings: (settings: Settings) => void;
  libraryDirectories: LibraryDirectory[];
  onLibraryDirectoriesChange: (directories: LibraryDirectory[]) => void;
  user: User;
  resumeMode: ResumeMode;
  onResumeModeChange: (mode: ResumeMode) => void;
  mobileViewport: boolean;
  homePlayerStyle: HomePlayerStyle;
  onHomePlayerStyleChange: (style: HomePlayerStyle) => void;
  mobileHomePlayerStyle: MobileHomePlayerStyle;
  onMobileHomePlayerStyleChange: (style: MobileHomePlayerStyle) => void;
  mineradioStageEnabled: boolean;
  onMineradioStageEnabledChange: (enabled: boolean) => void;
  artistAlbumDisplayStyle: ArtistAlbumDisplayStyle;
  onArtistAlbumDisplayStyleChange: (style: ArtistAlbumDisplayStyle) => void;
  lyricsDisplayStyle: LyricsDisplayStyle;
  onLyricsDisplayStyleChange: (style: LyricsDisplayStyle) => void;
  lyricsDragSeekEnabled: boolean;
  onLyricsDragSeekEnabledChange: (enabled: boolean) => void;
  persistentQueueEnabled: boolean;
  onPersistentQueueChange: (enabled: boolean) => void;
  uiSoundSettings: UISoundSettings;
  onUISoundSettingsChange: (settings: UISoundSettings) => void;
  playbackHistorySettings: PlaybackHistorySettings;
  onPlaybackHistorySettingsChange: (settings: PlaybackHistorySettings) => void;
  offlineUsage: OfflineCacheUsage;
  autoCachePlayed: boolean;
  onAutoCachePlayedChange: (enabled: boolean) => void;
  onRefreshOfflineUsage: () => void;
  onManageOfflineCache: () => void;
  scrobblingSettings: ScrobblingSettings | null;
  onScrobblingSettingsChange: (settings: ScrobblingSettings) => void;
  activeTab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
  onOpenAlbums: () => void;
  onOpenPlaylists: () => void;
  onUpdateProfile: (nickname: string, avatarDataURL: string) => void;
  pluginHostTheme: "light" | "dark";
  pluginHostPlayerState: SongloftPlayerState;
  onPluginHostCall: (call: SongloftHostCall) => Promise<unknown>;
  t: ReturnType<typeof createT>;
}) {
  const settingsRootRef = useRef<HTMLElement | null>(null);
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
  const [subsonicCredential, setSubsonicCredential] = useState<SubsonicCredentialStatus | null>(null);
  const [subsonicUsername, setSubsonicUsername] = useState("");
  const [subsonicPassword, setSubsonicPassword] = useState("");
  const [subsonicCredentialLoading, setSubsonicCredentialLoading] = useState(false);
  const [subsonicCredentialError, setSubsonicCredentialError] = useState("");
  const [libraryChecking, setLibraryChecking] = useState(false);
  const [scrobbleToken, setScrobbleToken] = useState("");
  const [pluginSurfaceOpen, setPluginSurfaceOpen] = useState(false);
  const mcpEndpoint = `${window.location.origin}/api/mcp/sse`;
  const publicShareEntry = `${window.location.origin}/share/<token>`;
  const subsonicEndpoint = `${window.location.origin}/rest`;
  const mcpTokenExample = mcpToken?.token || mcpToken?.hint || "lark_mcp_...";
  const tabs: { id: SettingsTab; label: string }[] = [
    { id: "account", label: t("accountSettings") },
    { id: "playback", label: t("playbackAppearanceSettings") },
    { id: "library", label: t("mediaLibrarySettings") },
    { id: "services", label: t("servicesConnectionsSettings") },
    ...(user.role === "admin"
      ? [
          { id: "plugins" as const, label: t("pluginManagement") },
          { id: "system" as const, label: t("systemSettings") },
          { id: "users" as const, label: t("userManagement") },
        ]
      : []),
  ];
  const settingsActiveTab: SettingsTab = activeTab;

  useEffect(() => {
    setNickname(user.nickname || user.username);
    setAvatarDataURL(user.avatar_data_url || "");
  }, [user]);

  useEffect(() => {
    setWebFontFamily(settings.web_font_family || "");
  }, [settings.web_font_family]);

  useEffect(() => {
    if (settingsActiveTab !== "playback") return;
    setFontsLoading(true);
    void api
      .fonts()
      .then(setFonts)
      .catch(() => setFonts([]))
      .finally(() => setFontsLoading(false));
  }, [settingsActiveTab]);

  useEffect(() => {
    if (settingsActiveTab !== "users" || user.role !== "admin") return;
    setUsersLoading(true);
    void api
      .users()
      .then(setUsers)
      .catch(() => setUsers([]))
      .finally(() => setUsersLoading(false));
  }, [settingsActiveTab, user.role]);

  useEffect(() => {
    if (settingsActiveTab !== "services") return;
    void api
      .mcpToken()
      .then(setMcpToken)
      .catch(() => setMcpToken(null));
    void api
      .subsonicCredential()
      .then((status) => {
        setSubsonicCredential(status);
        setSubsonicUsername(status.username || "");
        setSubsonicCredentialError("");
      })
      .catch(() => setSubsonicCredential(null));
    void api
      .scrobblingSettings()
      .then(onScrobblingSettingsChange)
      .catch(() => undefined);
  }, [settingsActiveTab]);

  useEffect(() => {
    document.body.dataset.mcpHelpOpen = mcpHelpOpen ? "true" : "false";
    return () => {
      delete document.body.dataset.mcpHelpOpen;
    };
  }, [mcpHelpOpen]);

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

  async function saveSubsonicCredential() {
    if (subsonicCredentialLoading) return;
    setSubsonicCredentialLoading(true);
    setSubsonicCredentialError("");
    try {
      const status = await api.saveSubsonicCredential(subsonicUsername, subsonicPassword);
      setSubsonicCredential(status);
      setSubsonicUsername(status.username || subsonicUsername);
      setSubsonicPassword("");
    } catch (err) {
      setSubsonicCredentialError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubsonicCredentialLoading(false);
    }
  }

  async function deleteSubsonicCredential() {
    if (subsonicCredentialLoading) return;
    setSubsonicCredentialLoading(true);
    setSubsonicCredentialError("");
    try {
      const status = await api.deleteSubsonicCredential();
      setSubsonicCredential(status);
      setSubsonicUsername("");
      setSubsonicPassword("");
    } catch (err) {
      setSubsonicCredentialError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubsonicCredentialLoading(false);
    }
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

  function applyLyricsFont(font?: WebFont) {
    if (!font) {
      setSettings({ ...settings, lyrics_font_family: "", lyrics_font_url: "" });
      return;
    }
    setSettings({
      ...settings,
      lyrics_font_family: font.family,
      lyrics_font_url: sanitizeUploadedFontURL(font.url),
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

  async function checkLibraryDirectories() {
    setLibraryChecking(true);
    try {
      onLibraryDirectoriesChange(await api.checkLibraryDirectories());
    } finally {
      setLibraryChecking(false);
    }
  }

  async function saveScrobbling(next: ScrobblingSettings, token = "") {
    const saved = await api.saveScrobblingSettings({ ...next, token });
    onScrobblingSettingsChange(saved);
    if (token) setScrobbleToken("");
  }

  async function saveUISoundSettings(next: UISoundSettings) {
    const enabledChanged = next.enabled !== uiSoundSettings.enabled;
    const normalized = { enabled: next.enabled, volume: Math.max(0, Math.min(1, Number(next.volume) || 0)) };
    onUISoundSettingsChange(normalized);
    if (enabledChanged && !next.enabled) {
      playUISound("toggleOff");
    }
    setUISoundSettings(normalized);
    if (enabledChanged && next.enabled) {
      playUISound("toggleOn");
    }
    const saved = await api.saveUISoundSettings(normalized).catch(() => normalized);
    onUISoundSettingsChange(saved);
  }

  async function savePlaybackHistorySettings(next: PlaybackHistorySettings) {
    onPlaybackHistorySettingsChange(next);
    const saved = await api.savePlaybackHistorySettings(next).catch(() => next);
    onPlaybackHistorySettingsChange(saved);
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

  async function updateLibraryDirectoryWatch(id: string, watchEnabled: boolean) {
    setLibraryDirError("");
    try {
      await api.updateLibraryDirectory(id, { watch_enabled: watchEnabled });
      await refreshLibraryDirectories();
    } catch (err) {
      setLibraryDirError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <section className={`settings-page${pluginSurfaceOpen ? " plugin-runtime-page" : ""}`} ref={settingsRootRef}>
      {!pluginSurfaceOpen ? (
        <>
          <SettingsSearch
            root={settingsRootRef}
            tabs={tabs}
            label={t("searchSettings")}
            placeholder={t("searchSettingsPlaceholder")}
            emptyLabel={t("searchSettingsEmpty")}
            clearLabel={t("clearSettingsSearch")}
            onTabChange={onTabChange}
          />
          <SettingsNavigation
            activeTab={settingsActiveTab}
            tabs={tabs}
            label={t("settings")}
            onTabChange={onTabChange}
          />
        </>
      ) : null}

      {settingsActiveTab === "plugins" && user.role === "admin" ? (
        <div className="settings-grid settings-tab-panel" role="tabpanel">
          <PluginSettings
            t={t}
            theme={pluginHostTheme}
            playerState={pluginHostPlayerState}
            onHostCall={onPluginHostCall}
            onSurfaceChange={setPluginSurfaceOpen}
          />
        </div>
      ) : null}

      {(["account", "playback", "library", "services"] as SettingsTab[]).includes(settingsActiveTab) && (
        <div className="settings-grid settings-tab-panel" data-active-category={settingsActiveTab} role="tabpanel">
          <div className="profile-settings-card" data-settings-owner="account">
            <div className="profile-settings-head">
              <UserAvatar user={{ ...user, nickname, avatar_data_url: avatarDataURL }} />
              <div>
                <strong>{t("profileSettings")}</strong>
                <span>{user.username}</span>
              </div>
            </div>
            <label>
              {t("nickname")}
              <input value={nickname} onChange={(e) => setNickname(e.target.value)} />
            </label>
            <label className="upload avatar-upload">
              {t("avatar")}
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
          <SettingsSection
            wideRow
            owner="playback"
            title={t("playbackResumeSetting")}
            description={t("playbackResumeHint")}
          >
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
          </SettingsSection>
          {!mobileViewport ? (
            <>
              <SettingsSection
                wideRow
                owner="playback"
                title={t("homePlayerStyle")}
                description={t("homePlayerStyleHint")}
              >
                <div className="segmented-control segmented-control-fluid" role="group" aria-label={t("homePlayerStyle")}>
              <button
                type="button"
                className={homePlayerStyle === "vinyl" ? "active" : ""}
                onClick={() => onHomePlayerStyleChange("vinyl")}
              >
                {t("homePlayerVinyl")}
              </button>
              <button
                type="button"
                className={homePlayerStyle === "cassette" ? "active" : ""}
                onClick={() => onHomePlayerStyleChange("cassette")}
              >
                {t("homePlayerCassette")}
              </button>
              <button
                type="button"
                className={homePlayerStyle === "ipod" ? "active" : ""}
                onClick={() => onHomePlayerStyleChange("ipod")}
              >
                {t("homePlayerIpod")}
              </button>
              <button
                type="button"
                className={homePlayerStyle === "audio-scope" ? "active" : ""}
                onClick={() => onHomePlayerStyleChange("audio-scope")}
              >
                {t("homePlayerAudioScope")}
              </button>
              <button
                type="button"
                className={homePlayerStyle === "album-slide" ? "active" : ""}
                onClick={() => onHomePlayerStyleChange("album-slide")}
              >
                {t("homePlayerAlbumSlide")}
              </button>
              <button
                type="button"
                className={homePlayerStyle === "smartisan-turntable" ? "active" : ""}
                onClick={() => onHomePlayerStyleChange("smartisan-turntable")}
              >
                {t("homePlayerSmartisanTurntable")}
              </button>
              <button
                type="button"
                className={homePlayerStyle === "gramophone" ? "active" : ""}
                onClick={() => onHomePlayerStyleChange("gramophone")}
              >
                {t("homePlayerGramophone")}
              </button>
              <button
                type="button"
                className={homePlayerStyle === "running-kitten" ? "active" : ""}
                onClick={() => onHomePlayerStyleChange("running-kitten")}
              >
                {t("homePlayerRunningKitten")}
              </button>
              <button
                type="button"
                className={homePlayerStyle === "mineradio-stage" ? "active" : ""}
                onClick={() => onHomePlayerStyleChange("mineradio-stage")}
              >
                {t("homePlayerMineradioStage")}
              </button>
              <button
                type="button"
                className={homePlayerStyle === "walkman" ? "active" : ""}
                onClick={() => onHomePlayerStyleChange("walkman")}
              >
                {t("homePlayerWalkman")}
              </button>
              <button
                type="button"
                className={homePlayerStyle === "singularity" ? "active" : ""}
                onClick={() => onHomePlayerStyleChange("singularity")}
              >
                {t("homePlayerSingularity")}
              </button>
                </div>
              </SettingsSection>
              <SettingsSection
                wideRow
                owner="playback"
                title={t("mineradioStageEffects")}
                description={t("mineradioStageEffectsHint")}
              >
                <label className="switch-row">
                  <span>
                    <span>{t("mineradioStageEffectsSwitch")}</span>
                    <small>{t("mineradioStageEffectsSwitchHint")}</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={mineradioStageEnabled}
                    onChange={(event) => onMineradioStageEnabledChange(event.target.checked)}
                  />
                </label>
              </SettingsSection>
            </>
          ) : null}
          {mobileViewport ? (
          <SettingsSection
            wideRow
            owner="playback"
            title={t("mobileHomePlayerStyle")}
            description={t("mobileHomePlayerStyleHint")}
          >
            <div className="segmented-control segmented-control-fluid mobile-theme-picker" role="group" aria-label={t("mobileHomePlayerStyle")}>
              <button
                type="button"
                className={mobileHomePlayerStyle === "neon-console" ? "active" : ""}
                onClick={() => onMobileHomePlayerStyleChange("neon-console")}
              >
                {t("mobileHomePlayerNeonConsole")}
              </button>
              <button
                type="button"
                className={mobileHomePlayerStyle === "soft-vinyl" ? "active" : ""}
                onClick={() => onMobileHomePlayerStyleChange("soft-vinyl")}
              >
                {t("mobileHomePlayerSoftVinyl")}
              </button>
              <button
                type="button"
                className={mobileHomePlayerStyle === "gramophone" ? "active" : ""}
                onClick={() => onMobileHomePlayerStyleChange("gramophone")}
              >
                {t("mobileHomePlayerGramophone")}
              </button>
              <button
                type="button"
                className={mobileHomePlayerStyle === "indiewave" ? "active" : ""}
                onClick={() => onMobileHomePlayerStyleChange("indiewave")}
              >
                {t("mobileHomePlayerIndiewave")}
              </button>
              <button
                type="button"
                className={mobileHomePlayerStyle === "editorial-pulse" ? "active" : ""}
                onClick={() => onMobileHomePlayerStyleChange("editorial-pulse")}
              >
                {t("mobileHomePlayerEditorialPulse")}
              </button>
              <button
                type="button"
                className={mobileHomePlayerStyle === "stage-glass" ? "active" : ""}
                onClick={() => onMobileHomePlayerStyleChange("stage-glass")}
              >
                {t("mobileHomePlayerStageGlass")}
              </button>
              <button
                type="button"
                className={mobileHomePlayerStyle === "blue-halo" ? "active" : ""}
                onClick={() => onMobileHomePlayerStyleChange("blue-halo")}
              >
                {t("mobileHomePlayerBlueHalo")}
              </button>
              <button
                type="button"
                className={mobileHomePlayerStyle === "smartisan-classic" ? "active" : ""}
                onClick={() => onMobileHomePlayerStyleChange("smartisan-classic")}
              >
                {t("mobileHomePlayerSmartisanClassic")}
              </button>
            </div>
          </SettingsSection>
          ) : null}
          <SettingsSection
            wideRow
            owner="playback"
            title={t("artistAlbumDisplayStyle")}
            description={t("artistAlbumDisplayStyleHint")}
          >
            <div className="segmented-control" role="group" aria-label={t("artistAlbumDisplayStyle")}>
              <button
                type="button"
                className={artistAlbumDisplayStyle === "classic" ? "active" : ""}
                onClick={() => onArtistAlbumDisplayStyleChange("classic")}
              >
                {t("artistAlbumDisplayClassic")}
              </button>
              <button
                type="button"
                className={artistAlbumDisplayStyle === "showcase" ? "active" : ""}
                onClick={() => onArtistAlbumDisplayStyleChange("showcase")}
              >
                {t("artistAlbumDisplayShowcase")}
              </button>
            </div>
          </SettingsSection>
          <SettingsSection
            wideRow
            owner="playback"
            title={t("lyricsDisplayStyle")}
            description={t("lyricsDisplayStyleHint")}
          >
            <div className="segmented-control lyrics-style-control" role="group" aria-label={t("lyricsDisplayStyle")}>
              {LYRICS_DISPLAY_STYLE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={lyricsDisplayStyle === option.value ? "active" : ""}
                  onClick={() => onLyricsDisplayStyleChange(option.value)}
                >
                  {t(option.labelKey)}
                </button>
              ))}
            </div>
          </SettingsSection>
          <label className="switch-row settings-wide-row" data-settings-owner="playback">
            <span>
              <span>{t("lyricsDragSeek")}</span>
              <small>{t("lyricsDragSeekHint")}</small>
            </span>
            <input
              type="checkbox"
              checked={lyricsDragSeekEnabled}
              onChange={(e) => onLyricsDragSeekEnabledChange(e.target.checked)}
            />
          </label>
          <label className="switch-row settings-wide-row" data-settings-owner="playback">
            <span>
              <span>{t("persistentQueue")}</span>
              <small>{t("persistentQueueHint")}</small>
            </span>
            <input
              type="checkbox"
              checked={persistentQueueEnabled}
              onChange={(e) => onPersistentQueueChange(e.target.checked)}
            />
          </label>
          <OfflineSettingsCard
            owner="library"
            usage={offlineUsage}
            usageLabel={t("offlineCacheUsage")}
            description={t("offlineCacheUsageHint")}
            refreshLabel={t("refresh")}
            manageLabel={t("offlineCacheManage")}
            formatBytes={(bytes) => bytes > 0 ? formatBytes(bytes) : "0 KB"}
            onRefresh={onRefreshOfflineUsage}
            onManage={onManageOfflineCache}
          />
          <label className="switch-row settings-wide-row" data-settings-owner="library">
            <span>
              <span>{t("offlineCacheAutoPlayed")}</span>
              <small>{t("offlineCacheAutoPlayedHint")}</small>
            </span>
            <input
              type="checkbox"
              checked={autoCachePlayed}
              onChange={(e) => onAutoCachePlayedChange(e.target.checked)}
            />
          </label>
          <div className="switch-row settings-wide-row" data-settings-owner="playback">
            <span>
              <span>{t("uiSounds")}</span>
              <small>{t("uiSoundsHint")}</small>
            </span>
            <div className="settings-inline-actions">
              <button
                type="button"
                onClick={() => previewUISound()}
              >
                {t("previewUISound")}
              </button>
              <label className="ui-sound-volume">
                <span>{Math.round((uiSoundSettings.volume ?? 0.85) * 100)}%</span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={uiSoundSettings.volume ?? 0.85}
                  aria-label={t("uiSoundVolume")}
                  onChange={(e) => void saveUISoundSettings({ ...uiSoundSettings, volume: Number(e.target.value) })}
                />
              </label>
              <input
                type="checkbox"
                aria-label={t("uiSounds")}
                checked={uiSoundSettings.enabled}
                onChange={(e) => void saveUISoundSettings({ ...uiSoundSettings, enabled: e.target.checked })}
              />
            </div>
          </div>
          <label className="switch-row settings-wide-row" data-settings-owner="playback">
            <span>
              <span>{t("separatePlaybackHistory")}</span>
              <small>{t("separatePlaybackHistoryHint")}</small>
            </span>
            <input
              type="checkbox"
              checked={playbackHistorySettings.separate_by_device}
              onChange={(e) => void savePlaybackHistorySettings({ separate_by_device: e.target.checked })}
            />
          </label>
          {scrobblingSettings ? (
            <div className="scrobbling-card settings-wide-row" data-settings-owner="services">
              <div className="scrobbling-head">
                <div>
                  <strong>{t("scrobbling")}</strong>
                  <span>{t("scrobblingHint")}</span>
                </div>
                <span className={scrobblingSettings.enabled ? "status-pill active" : "status-pill"}>
                  {scrobblingSettings.enabled ? t("enabled") : t("disabled")}
                </span>
              </div>
              <label className="switch-row">
                <span>{t("enableScrobbling")}</span>
                <input
                  type="checkbox"
                  checked={scrobblingSettings.enabled}
                  onChange={(e) => void saveScrobbling({ ...scrobblingSettings, enabled: e.target.checked })}
                />
              </label>
              <div className="scrobbling-form">
                <label>
                  {t("provider")}
                  <select
                    value={scrobblingSettings.provider}
                    onChange={(e) => void saveScrobbling({ ...scrobblingSettings, provider: e.target.value })}
                  >
                    <option value="listenbrainz">ListenBrainz</option>
                    <option value="lastfm">Last.fm</option>
                  </select>
                </label>
                <label>
                  {t("token")}
                  <input
                    value={scrobbleToken}
                    placeholder={scrobblingSettings.token_hint || t("token")}
                    onChange={(event) => setScrobbleToken(event.target.value)}
                  />
                </label>
                <button type="button" onClick={() => void saveScrobbling(scrobblingSettings, scrobbleToken)}>
                  {t("save")}
                </button>
              </div>
              <div className="settings-mini-grid">
                <label>
                  {t("scrobbleMinSeconds")}
                  <input
                    type="number"
                    min={10}
                    max={240}
                    value={scrobblingSettings.min_seconds}
                    onChange={(event) =>
                      void saveScrobbling({ ...scrobblingSettings, min_seconds: Number(event.target.value) || 30 })
                    }
                  />
                </label>
                <label>
                  {t("scrobblePercent")}
                  <input
                    type="number"
                    min={10}
                    max={100}
                    value={scrobblingSettings.percent_gate}
                    onChange={(event) =>
                      void saveScrobbling({ ...scrobblingSettings, percent_gate: Number(event.target.value) || 50 })
                    }
                  />
                </label>
              </div>
            </div>
          ) : null}
          <div className="mcp-card settings-wide-row" data-settings-owner="services">
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
          <div className="subsonic-card settings-wide-row" data-settings-owner="services">
            <div className="subsonic-card-head">
              <div>
                <strong>{t("subsonicAccount")}</strong>
                <span>{t("subsonicAccountHint")}</span>
              </div>
              <span className={subsonicCredential?.configured ? "status-pill active" : "status-pill"}>
                {subsonicCredential?.configured
                  ? `${t("subsonicConfigured")} ${subsonicCredential.hint || ""}`
                  : t("subsonicNotConfigured")}
              </span>
            </div>
            <div className="subsonic-status-row">
              <span>{t("subsonicEndpoint")}</span>
              <code>{subsonicCredential?.endpoint || subsonicEndpoint}</code>
            </div>
            <div className="subsonic-form">
              <label>
                {t("subsonicUsername")}
                <input
                  value={subsonicUsername}
                  autoComplete="username"
                  placeholder={user.username}
                  onChange={(event) => setSubsonicUsername(event.target.value)}
                />
              </label>
              <label>
                {t("subsonicPassword")}
                <input
                  type="password"
                  value={subsonicPassword}
                  autoComplete="new-password"
                  placeholder={subsonicCredential?.configured ? "••••••••" : t("password")}
                  onChange={(event) => setSubsonicPassword(event.target.value)}
                />
              </label>
            </div>
            {subsonicCredentialError ? <div className="settings-error">{subsonicCredentialError}</div> : null}
            <div className="subsonic-actions">
              <button
                type="button"
                className="primary"
                disabled={subsonicCredentialLoading || !subsonicUsername.trim() || !subsonicPassword}
                onClick={() => void saveSubsonicCredential()}
              >
                {subsonicCredentialLoading ? t("loading") : t("saveSubsonicCredential")}
              </button>
              <button
                type="button"
                disabled={subsonicCredentialLoading || !subsonicCredential?.configured}
                onClick={() => void deleteSubsonicCredential()}
              >
                {t("deleteSubsonicCredential")}
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

      {settingsActiveTab === "users" && (
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

      {(["playback", "library", "services", "system"] as SettingsTab[]).includes(settingsActiveTab) && (
        <div className="settings-grid settings-tab-panel" data-active-category={settingsActiveTab} role="tabpanel">
          <label data-settings-owner="playback">
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
          <div className="settings-wide-row theme-swatch-grid-wrap" data-settings-owner="playback">
            <div className="theme-swatch-grid-head">
              <strong>{t("theme")}</strong>
              <span>{t("themeHint")}</span>
            </div>
            <div className="theme-swatch-grid">
              {[...darkThemes, ...lightThemes].map((theme) => (
                <button
                  key={theme.id}
                  type="button"
                  className={settings.theme === theme.id ? "theme-swatch active" : "theme-swatch"}
                  onClick={() => setSettings({ ...settings, theme: theme.id })}
                  aria-pressed={settings.theme === theme.id}
                  data-theme-id={theme.id}
                  title={t(theme.label)}
                >
                  <span className="theme-swatch-preview" />
                  <span className="theme-swatch-label">
                    <span className="theme-swatch-dot" data-mode={theme.mode} />
                    {t(theme.label)}
                  </span>
                </button>
              ))}
            </div>
          </div>
          {user.role === "admin" ? (
            <label className="switch-row settings-wide-row" data-settings-owner="system">
              <span>
                <span>{t("diagnosticsEnabled")}</span>
                <small>{t("diagnosticsHint")}</small>
              </span>
              <input
                type="checkbox"
                checked={settings.diagnostics_enabled}
                onChange={(e) =>
                  setSettings({ ...settings, diagnostics_enabled: e.target.checked })
                }
              />
            </label>
          ) : null}
          {user.role === "admin" ? (
            <label className="settings-number-row settings-wide-row" data-settings-owner="system">
              <span className="settings-label-with-info">
                <span>{t("playbackSourceRetention")}</span>
                <span
                  className="settings-info-icon"
                  role="img"
                  aria-label={t("playbackSourceRetentionHint")}
                  title={t("playbackSourceRetentionHint")}
                >
                  <Info />
                </span>
              </span>
              <span className="settings-number-input">
                <input
                  type="number"
                  min={1}
                  max={720}
                  step={1}
                  value={settings.playback_source_ttl_hours || 24}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      playback_source_ttl_hours: Math.max(1, Math.min(720, Number(e.target.value) || 24)),
                    })
                  }
                />
                <span>{t("hours")}</span>
              </span>
            </label>
          ) : null}
          {user.role === "admin" ? (
            <label className="settings-number-row settings-wide-row" data-settings-owner="system">
              <span className="settings-label-with-info">
                <span>{t("playbackHistoryRetention")}</span>
                <span
                  className="settings-info-icon"
                  role="img"
                  aria-label={t("playbackHistoryRetentionHint")}
                  title={t("playbackHistoryRetentionHint")}
                >
                  <Info />
                </span>
              </span>
              <span className="settings-number-input">
                <input
                  type="number"
                  min={0}
                  max={3650}
                  step={1}
                  value={settings.playback_history_retention_days ?? 0}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      playback_history_retention_days: Math.max(0, Math.min(3650, Number(e.target.value) || 0)),
                    })
                  }
                />
                <span>{settings.playback_history_retention_days ? t("days") : t("forever")}</span>
              </span>
            </label>
          ) : null}
          {user.role === "admin" ? (
            <div className="feature-settings-card settings-wide-row" data-settings-owner="library">
              <label className="switch-row">
                <span>
                  <span>{t("metadataGrouping")}</span>
                  <small>{t("metadataGroupingHint")}</small>
                </span>
                <input
                  type="checkbox"
                  checked={settings.metadata_grouping}
                  onChange={(e) => setSettings({ ...settings, metadata_grouping: e.target.checked })}
                />
              </label>
              <button type="button" className="feature-entry-button" onClick={onOpenAlbums}>
                {t("openFeatureEntry")} · {t("albums")}
              </button>
              <label className="switch-row">
                <span>
                  <span>{t("smartPlaylistFeature")}</span>
                  <small>{t("smartPlaylistFeatureHint")}</small>
                </span>
                <input
                  type="checkbox"
                  checked={settings.smart_playlists_enabled}
                  onChange={(e) => setSettings({ ...settings, smart_playlists_enabled: e.target.checked })}
                />
              </label>
              <button type="button" className="feature-entry-button" onClick={onOpenPlaylists}>
                {t("openFeatureEntry")} · {t("playlists")}
              </button>
              <label className="switch-row">
                <span>
                  <span>{t("libraryTagWriteback")}</span>
                  <small>{t("libraryTagWritebackHint")}</small>
                </span>
                <input
                  type="checkbox"
                  checked={settings.library_tag_writeback}
                  onChange={(e) => setSettings({ ...settings, library_tag_writeback: e.target.checked })}
                />
              </label>
              <label className="switch-row">
                <span>
                  <span>{t("libraryPathMetadataAssist")}</span>
                  <small>{t("libraryPathMetadataAssistHint")}</small>
                </span>
                <input
                  type="checkbox"
                  checked={settings.library_path_metadata_assist}
                  onChange={(e) => setSettings({ ...settings, library_path_metadata_assist: e.target.checked })}
                />
              </label>
            </div>
          ) : null}
          {user.role === "admin" ? (
            <label className="switch-row settings-wide-row" data-settings-owner="library">
              <span>
                <span>{t("lyricsAutoSave")}</span>
                <small>{t("lyricsAutoSaveHint")}</small>
              </span>
              <input
                type="checkbox"
                checked={settings.lyrics_auto_save_to_song_dir}
                onChange={(e) => setSettings({ ...settings, lyrics_auto_save_to_song_dir: e.target.checked })}
              />
            </label>
          ) : null}
          {user.role === "admin" ? (
            <div className="font-settings-card settings-wide-row" data-settings-owner="playback">
              <div>
                <strong>{t("lyricsSettings")}</strong>
                <span>{t("lyricsDisplayStyleHint")}</span>
              </div>
              <div className="settings-mini-grid">
                <label>
                  {t("lyricsFontFamily")}
                  <select
                    value={settings.lyrics_font_url || ""}
                    disabled={fontsLoading || fonts.length === 0}
                    onChange={(event) => {
                      const font = fonts.find((item) => item.url === event.target.value);
                      applyLyricsFont(font);
                    }}
                  >
                    <option value="">{t("lyricsFontFamilyPlaceholder")}</option>
                    {fonts.map((font) => (
                      <option key={font.name} value={font.url}>
                        {font.family}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t("lyricsFontSize")}
                  <input
                    type="number"
                    min={18}
                    max={72}
                    step={1}
                    value={settings.lyrics_font_size || ""}
                    placeholder={t("lyricsFontSizeDefault")}
                    onChange={(event) =>
                      setSettings({ ...settings, lyrics_font_size: normalizeLyricsFontSize(Number(event.target.value)) })
                    }
                  />
                </label>
              </div>
              <div className="font-current-row">
                <span>{t("currentFont")}</span>
                <strong style={{ fontFamily: settings.lyrics_font_family ? `"${settings.lyrics_font_family}", var(--app-font)` : undefined }}>
                  {settings.lyrics_font_family || t("defaultFont")}
                </strong>
              </div>
              {!fonts.length ? <div className="settings-empty compact-empty">{fontsLoading ? t("loading") : t("noFontsUploaded")}</div> : null}
              <div className="font-actions">
                <button
                  type="button"
                  onClick={() => {
                    setSettings({ ...settings, lyrics_font_family: "", lyrics_font_url: "", lyrics_font_size: 0 });
                  }}
                >
                  {t("useDefaultFont")}
                </button>
              </div>
            </div>
          ) : null}
          {user.role === "admin" ? (
            <div className="feature-settings-card settings-wide-row" data-settings-owner="services">
              <label className="switch-row">
                <span>
                  <span>{t("sharingFeature")}</span>
                  <small>{t("sharingFeatureHint")}</small>
                </span>
                <input
                  type="checkbox"
                  checked={settings.sharing_enabled}
                  onChange={(e) => setSettings({ ...settings, sharing_enabled: e.target.checked })}
                />
              </label>
              <label className="switch-row">
                <span>
                  <span>{t("subsonicServer")}</span>
                  <small>{t("subsonicServerHint")}</small>
                </span>
                <input
                  type="checkbox"
                  checked={settings.subsonic_server_enabled}
                  onChange={(e) => setSettings({ ...settings, subsonic_server_enabled: e.target.checked })}
                />
              </label>
              {!settings.no_dlna_option ? (
                <>
                  <label className="switch-row">
                    <span>
                      <span>{t("dlnaCast")}</span>
                      <small>{t("dlnaCastHint")}</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={settings.dlna_cast_enabled}
                      onChange={(e) => setSettings({ ...settings, dlna_cast_enabled: e.target.checked })}
                    />
                  </label>
                  <label className="switch-row">
                    <span>
                      <span>{t("dlnaLibrary")}</span>
                      <small>{t("dlnaLibraryHint")}</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={settings.dlna_library_enabled}
                      onChange={(e) => setSettings({ ...settings, dlna_library_enabled: e.target.checked })}
                    />
                  </label>
                </>
              ) : null}
              <div className="settings-mini-grid">
                <label>
                  {t("sharingEndpoint")}
                  <input readOnly value={publicShareEntry} />
                </label>
                <label>
                  {t("subsonicEndpoint")}
                  <input readOnly value={subsonicEndpoint} />
                </label>
                {!settings.no_dlna_option ? (
                  <>
                    <label>
                      {t("dlnaServerName")}
                      <input
                        value={settings.dlna_server_name}
                        placeholder="Lark"
                        onChange={(e) => setSettings({ ...settings, dlna_server_name: e.target.value })}
                      />
                    </label>
                    <label>
                      {t("dlnaMediaBaseURL")}
                      <input
                        value={settings.dlna_media_base_url}
                        placeholder={window.location.origin}
                        onChange={(e) => setSettings({ ...settings, dlna_media_base_url: e.target.value })}
                      />
                    </label>
                    <label>
                      {t("dlnaAllowedIPs")}
                      <input
                        value={settings.dlna_allowed_ips}
                        placeholder="192.168.1.20,*"
                        onChange={(e) => setSettings({ ...settings, dlna_allowed_ips: e.target.value })}
                      />
                    </label>
                    <label>
                      {t("dlnaInterfaces")}
                      <input
                        value={settings.dlna_interfaces}
                        placeholder="eth0,wlan0"
                        onChange={(e) => setSettings({ ...settings, dlna_interfaces: e.target.value })}
                      />
                    </label>
                  </>
                ) : null}
                <label>
                  {t("transcodePolicy")}
                  <select
                    value={settings.transcode_policy || "auto"}
                    onChange={(e) => setSettings({ ...settings, transcode_policy: e.target.value })}
                  >
                    <option value="auto">{t("transcodeAuto")}</option>
                    <option value="raw">{t("transcodeRaw")}</option>
                    <option value="transcode">{t("transcodeAlways")}</option>
                  </select>
                </label>
                <div className="bitrate-preset-field">
                  <strong>{t("transcodeQuality")}</strong>
                  <div className="bitrate-preset-list" role="radiogroup" aria-label={t("transcodeQuality")}>
                    {TRANSCODE_QUALITY_PRESETS.map((preset) => (
                      <label
                        key={preset.value}
                        className={
                          (settings.transcode_quality_kbps || 192) === preset.value
                            ? "bitrate-preset-option active"
                            : "bitrate-preset-option"
                        }
                      >
                        <input
                          type="radio"
                          name="transcode-quality"
                          value={preset.value}
                          checked={(settings.transcode_quality_kbps || 192) === preset.value}
                          onChange={() => setSettings({ ...settings, transcode_quality_kbps: preset.value })}
                        />
                        <span>
                          <b>{preset.value} kbps · {t(preset.labelKey)}</b>
                          <small>{t(preset.hintKey)}</small>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : null}
          <div className="font-settings-card settings-wide-row" data-settings-owner="playback">
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
          <div className="library-dir-card settings-wide-row" data-settings-owner="library">
            <div className="library-dir-head">
              <div>
                <strong>{t("libraryDirectories")}</strong>
                <span>{t("libraryDirectoriesHint")}</span>
              </div>
              <div className="library-dir-head-actions">
                <span>{libraryDirectories.length} {t("folders")}</span>
                <button type="button" onClick={() => void checkLibraryDirectories()} disabled={libraryChecking}>
                  {libraryChecking ? t("loading") : t("checkStatus")}
                </button>
              </div>
            </div>
            <div className="library-dir-list">
              {libraryDirectories.map((dir) => (
                <div key={dir.id} className={dir.builtin ? "library-dir-row builtin" : "library-dir-row"}>
                  <div>
                    <strong>{dir.builtin ? t("envLibraryDirectory") : (dir.note || t("customLibraryDirectory"))}</strong>
                    <span>{dir.path}</span>
                    <small className={dir.status === "online" ? "dir-status online" : "dir-status"}>
                      {libraryDirectoryStatusLabel(dir.status || "online", settings.language)}
                      {dir.builtin ? <b>{t("readOnly")}</b> : null}
                      {dir.last_error ? ` · ${dir.last_error}` : ""}
                    </small>
                  </div>
                  <div className="library-dir-actions">
                    <label className="dir-watch-toggle" title={t("directoryWatchHint")}>
                      <span>{t("directoryWatch")}</span>
                      <input
                        type="checkbox"
                        checked={dir.watch_enabled}
                        disabled={dir.builtin && user.role !== "admin"}
                        onChange={(event) => void updateLibraryDirectoryWatch(dir.id, event.target.checked)}
                      />
                    </label>
                    {dir.watch_enabled ? (
                      <em>{dir.watch_active ? t("enabled") : t("disabled")}</em>
                    ) : dir.builtin ? null : (
                      <button type="button" className="danger" onClick={() => void deleteLibraryDirectory(dir.id)}>{t("remove")}</button>
                    )}
                  </div>
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
type SongRowProps = {
  song: Song;
  index: number;
  active: boolean;
  selected: boolean;
  menuOpen: boolean;
  virtual: boolean;
  t: ReturnType<typeof createT>;
  offlineState: OfflineCacheButtonState;
  canSelect: boolean;
  canInsertNext: boolean;
  canShare: boolean;
  canOpenAlbum: boolean;
  canOpenArtist: boolean;
  canEditMetadata: boolean;
  hasOffline: boolean;
  onPlay: (song: Song) => void;
  onFavorite: (song: Song) => void;
  onAdd: (song: Song) => void;
  onInsertNext: (song: Song) => void;
  onShare: (song: Song) => void;
  onOpenAlbum: (song: Song) => void;
  onOpenArtist: (song: Song) => void;
  onEditMetadata: (song: Song) => void;
  onToggleSelected: (song: Song) => void;
  onCacheSong: (song: Song) => void;
  onToggleMenu: (song: Song) => void;
  registerMoreButton: (id: number, node: HTMLButtonElement | null) => void;
};

// SongRow is memoized so that during playback (current/progress changing) and other
// parent re-renders, only rows whose own data changed (active/selected/menuOpen/song)
// re-render — not all 220-500 rows. Handlers are stabilized by SongTable via a latest-
// ref so their identity never changes, keeping the shallow memo comparison effective.
const SongRow = memo(function SongRow({
  song, index, active, selected, menuOpen, virtual, t, offlineState,
  canSelect, canInsertNext, canShare, canOpenAlbum, canOpenArtist, hasOffline,
  onPlay, onFavorite, onAdd, onInsertNext, onShare, onOpenAlbum, onOpenArtist,
  canEditMetadata, onEditMetadata,
  onToggleSelected, onCacheSong, onToggleMenu, registerMoreButton,
}: SongRowProps) {
  return (
    <div
      className={active ? "song-row active" : "song-row"}
      style={virtual ? ({ top: index * SONG_ROW_HEIGHT } as React.CSSProperties) : undefined}
      onDoubleClick={() => onPlay(song)}
    >
      {canSelect ? (
        <label className="row-check" aria-label={`${t("selected")} ${song.title}`}>
          <input type="checkbox" checked={selected} onChange={() => onToggleSelected(song)} />
        </label>
      ) : active ? (
        <span className="song-row-eq" aria-label={t("playing")}>
          <i /><i /><i />
        </span>
      ) : (
        <span>{index + 1}</span>
      )}
      <button onClick={() => onPlay(song)} aria-label={t("play")}>
        <Play weight="fill" />
      </button>
      <div>
        <strong>{song.title}</strong>
        <small className="song-mobile-meta">
          {[song.artist, song.album].filter(Boolean).join(" · ")}
        </small>
        {song.metadata_issues?.length ? (canEditMetadata ? (
          <button type="button" className="song-metadata-issues" onClick={() => onEditMetadata(song)}>
            {song.metadata_issues.map((issue) => t(issue === "missing_title" ? "missingTitle" : issue === "missing_artist" ? "missingArtist" : "missingAlbum")).join(" · ")}
          </button>
        ) : <small className="song-metadata-issues">{song.metadata_issues.map((issue) => t(issue === "missing_title" ? "missingTitle" : issue === "missing_artist" ? "missingArtist" : "missingAlbum")).join(" · ")}</small>) : null}
        {canOpenArtist && song.artist_id ? (
          <button className="artist-link" onClick={() => onOpenArtist(song)}>{song.artist}</button>
        ) : (
          <small>{song.artist}</small>
        )}
      </div>
      <div className="song-album">
        {canOpenAlbum && song.album_id ? (
          <button className="artist-link" onClick={() => onOpenAlbum(song)}>{song.album}</button>
        ) : (
          song.album
        )}
      </div>
      <div className={QUALITY_CLASS} title={formatQuality(song)}>{formatQuality(song)}</div>
      <div className="song-duration">{formatDuration(song.duration_seconds)}</div>
      <div className="song-row-actions" aria-label={t("selected")}>
        <button
          onClick={() => onFavorite(song)}
          title={t(song.favorite ? "removeFavorite" : "addFavorite")}
          aria-label={t(song.favorite ? "removeFavorite" : "addFavorite")}
          aria-pressed={song.favorite}
        >
          <Heart weight={song.favorite ? "fill" : "regular"} />
        </button>
        <span className="song-row-actions-primary">
          {canInsertNext ? (
            <button onClick={() => onInsertNext(song)} title={t("playNext")} aria-label={t("playNext")}>
              <SkipForward />
            </button>
          ) : null}
          {hasOffline ? (
            <OfflineCacheButton
              state={offlineState}
              labels={{
                cache: t("offlineCacheSong"),
                caching: t("offlineCachePreparingShort"),
                cached: t("offlineCacheReadyShort"),
              }}
              onClick={() => onCacheSong(song)}
            />
          ) : null}
          <button onClick={() => onAdd(song)} title={t("addToPlaylist")} aria-label={t("addToPlaylist")}>
            <PlaylistIcon />
          </button>
          {canShare ? (
            <button onClick={() => onShare(song)} title={t("share")} aria-label={t("share")}>
              <ShareNetwork />
            </button>
          ) : null}
        </span>
        <span className="song-row-actions-more">
          <button
            ref={(node) => { registerMoreButton(song.id, node); }}
            onClick={() => onToggleMenu(song)}
            title={t("more")}
            aria-label={t("more")}
            aria-expanded={menuOpen}
            className={menuOpen ? "active" : ""}
          >
            <DotsThree weight="bold" />
          </button>
        </span>
      </div>
    </div>
  );
});

function SongTable({
  songs,
  current,
  t,
  onPlay,
  onFavorite,
  onAdd,
  onInsertNext,
  offlineCache,
  onShare,
  onOpenAlbum,
  onOpenArtist,
  onEditMetadata,
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
  offlineCache?: OfflineCacheControls;
  onShare?: (song: Song) => void;
  onOpenAlbum?: (song: Song) => void;
  onOpenArtist?: (song: Song) => void;
  onEditMetadata?: (song: Song) => void;
  selectedIds?: Set<number>;
  onToggleSelected?: (song: Song) => void;
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const pendingScrollTopRef = useRef(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(520);
  const [moreMenuSongId, setMoreMenuSongId] = useState<number | null>(null);
  const moreButtonRefs = useRef(new Map<number, HTMLButtonElement | null>());
  const [moreMenuPos, setMoreMenuPos] = useState<{ right: number; top: number } | null>(null);
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
  useEffect(() => {
    if (moreMenuSongId == null) return;
    const updatePos = () => {
      const btn = moreButtonRefs.current.get(moreMenuSongId);
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      setMoreMenuPos({ right: window.innerWidth - r.right, top: r.bottom + 6 });
    };
    const close = () => setMoreMenuSongId(null);
    const onPointer = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".song-row-more-menu, .song-row-actions-more")) return;
      close();
    };
    updatePos();
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", updatePos);
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("touchstart", onPointer, { passive: true });
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", updatePos);
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("touchstart", onPointer);
    };
  }, [moreMenuSongId]);
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
  const offlineButtonState = (song: Song): OfflineCacheButtonState => {
    if (offlineCache?.cachingSongIds.has(song.id)) return "caching";
    if (offlineCache?.cachedSongIds.has(song.id)) return "cached";
    return "idle";
  };
  // Stabilize the callbacks via a latest-ref so SongRow's memo comparison stays
  // effective (stable identities) while always invoking the freshest props/closures.
  const latest = useRef({ songs, current, onPlay, onFavorite, onAdd, onInsertNext, onShare, onOpenAlbum, onOpenArtist, onEditMetadata, onToggleSelected, offlineCache });
  useEffect(() => {
    latest.current = { songs, current, onPlay, onFavorite, onAdd, onInsertNext, onShare, onOpenAlbum, onOpenArtist, onEditMetadata, onToggleSelected, offlineCache };
  });
  const rowPlay = useCallback((song: Song) => latest.current.onPlay(song, latest.current.songs), []);
  const rowFavorite = useCallback((song: Song) => latest.current.onFavorite(song), []);
  const rowAdd = useCallback((song: Song) => latest.current.onAdd(song), []);
  const rowInsertNext = useCallback((song: Song) => latest.current.onInsertNext?.(song), []);
  const rowShare = useCallback((song: Song) => latest.current.onShare?.(song), []);
  const rowOpenAlbum = useCallback((song: Song) => latest.current.onOpenAlbum?.(song), []);
  const rowOpenArtist = useCallback((song: Song) => latest.current.onOpenArtist?.(song), []);
  const rowEditMetadata = useCallback((song: Song) => latest.current.onEditMetadata?.(song), []);
  const rowToggleSelected = useCallback((song: Song) => latest.current.onToggleSelected?.(song), []);
  const rowCacheSong = useCallback((song: Song) => latest.current.offlineCache?.onCacheSong(song), []);
  const rowToggleMenu = useCallback((song: Song) => setMoreMenuSongId((cur) => (cur === song.id ? null : song.id)), []);
  const registerMoreButton = useCallback((id: number, node: HTMLButtonElement | null) => { moreButtonRefs.current.set(id, node); }, []);
  const renderRow = (song: Song, absoluteIndex: number) => (
    <SongRow
      key={song.id}
      song={song}
      index={absoluteIndex}
      active={current?.id === song.id}
      selected={selectedIds?.has(song.id) ?? false}
      menuOpen={moreMenuSongId === song.id}
      virtual={virtual}
      t={t}
      offlineState={offlineButtonState(song)}
      canSelect={!!onToggleSelected}
      canInsertNext={!!onInsertNext}
      canShare={!!onShare}
      canOpenAlbum={!!onOpenAlbum}
      canOpenArtist={!!onOpenArtist}
      canEditMetadata={!!onEditMetadata}
      hasOffline={!!offlineCache}
      onPlay={rowPlay}
      onFavorite={rowFavorite}
      onAdd={rowAdd}
      onInsertNext={rowInsertNext}
      onShare={rowShare}
      onOpenAlbum={rowOpenAlbum}
      onOpenArtist={rowOpenArtist}
      onEditMetadata={rowEditMetadata}
      onToggleSelected={rowToggleSelected}
      onCacheSong={rowCacheSong}
      onToggleMenu={rowToggleMenu}
      registerMoreButton={registerMoreButton}
    />
  );
  if (!songs.length) return <div className="empty">{t("noSongs")}</div>;
  const columnHeader = (
    <div className="song-table-header" aria-hidden="true">
      <span>#</span>
      <span />
      <span>{t("songs")}</span>
      <span>{t("artist")}</span>
      <span>{t("album")}</span>
      <span />
      <span />
    </div>
  );
  const moreMenuSong = moreMenuSongId != null ? songs.find((s) => s.id === moreMenuSongId) : null;
  const moreMenu = moreMenuSong && moreMenuPos ? (
    <div
      className="song-row-more-menu"
      role="menu"
      style={{ right: moreMenuPos.right, top: moreMenuPos.top }}
      onClick={(event) => event.stopPropagation()}
    >
      {onInsertNext ? (
        <button role="menuitem" onClick={() => { onInsertNext(moreMenuSong); setMoreMenuSongId(null); }}>
          <SkipForward />
          <span>{t("playNext")}</span>
        </button>
      ) : null}
      {offlineCache ? (
        <button role="menuitem" onClick={() => { offlineCache.onCacheSong(moreMenuSong); setMoreMenuSongId(null); }}>
          <DownloadSimple />
          <span>{offlineButtonState(moreMenuSong) === "cached" ? t("offlineCacheReadyShort") : t("offlineCacheSong")}</span>
        </button>
      ) : null}
      <button role="menuitem" onClick={() => { onAdd(moreMenuSong); setMoreMenuSongId(null); }}>
        <PlaylistIcon />
        <span>{t("addToPlaylist")}</span>
      </button>
      {onShare ? (
        <button role="menuitem" onClick={() => { onShare(moreMenuSong); setMoreMenuSongId(null); }}>
          <ShareNetwork />
          <span>{t("share")}</span>
        </button>
      ) : null}
      {onEditMetadata ? (
        <button role="menuitem" onClick={() => { onEditMetadata(moreMenuSong); setMoreMenuSongId(null); }}>
          <PencilSimple />
          <span>{t("editMetadata")}</span>
        </button>
      ) : null}
    </div>
  ) : null;
  if (virtual) {
    return (
      <section
        className="song-table virtual"
        ref={scrollerRef}
        onScroll={handleVirtualScroll}
      >
        {columnHeader}
        <div
          className="song-table-spacer"
          style={{ height: songs.length * SONG_ROW_HEIGHT }}
        >
          {windowed.items.map((song, offset) =>
            renderRow(song, windowed.start + offset),
          )}
        </div>
        {moreMenu}
      </section>
    );
  }
  return (
    <section className="song-table">
      {columnHeader}
      {songs.map((song, index) => renderRow(song, index))}
      {moreMenu}
    </section>
  );
}

function ArtistInitialFilter({
  active,
  available,
  loading,
  t,
  onSelect,
}: {
  active: string;
  available: string[];
  loading: boolean;
  t: ReturnType<typeof createT>;
  onSelect: (initial: string) => void;
}) {
  const availableSet = new Set(available);
  return (
    <div
      className="artist-initial-filter"
      role="group"
      aria-label={t("artistInitials")}
      aria-busy={loading}
    >
      <button
        type="button"
        className={active ? "" : "active"}
        aria-pressed={!active}
        onClick={() => active && onSelect(active)}
      >
        {t("allInitials")}
      </button>
      {ARTIST_INITIALS.map((initial) => {
        const enabled = availableSet.has(initial);
        return (
          <button
            type="button"
            key={initial}
            className={active === initial ? "active" : ""}
            disabled={!enabled && active !== initial}
            aria-pressed={active === initial}
            onClick={() => onSelect(initial)}
          >
            {initial}
          </button>
        );
      })}
    </div>
  );
}
