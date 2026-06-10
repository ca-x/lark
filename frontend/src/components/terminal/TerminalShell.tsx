import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { createT } from "../../i18n";
import { api } from "../../services/api";
import type {
  Album,
  AlbumPage,
  HealthInfo,
  LibraryStats,
  NetworkTrack,
  RadioStation,
  Settings,
  Song,
  SongPage,
  TerminalShellTheme,
  User,
} from "../../types";
import type { LyricLine } from "../../utils/app";
import { formatBytes, formatDuration, formatQuality } from "../../utils/app";
import "./TerminalShell.css";

type ShellTab = "home" | "search" | "library" | "favorites" | "queue" | "console";
type LibrarySection = "songs" | "albums";
type FavoriteSection = "songs" | "albums";

const shellDict = {
  "zh-CN": {
    homeTab: "首页",
    searchTab: "搜索",
    libraryTab: "曲库",
    favoritesTab: "收藏",
    queueTab: "队列",
    consoleTab: "控制台",
    shellContent: "跳到 Shell 内容",
    shellTabs: "Shell 标签",
    connected: "已连接",
    offline: "离线",
    limited: "弱连接",
    running: "播放中",
    paused: "已暂停",
    idle: "空闲",
    rows: "行",
    nowPlaying: "正在播放",
    recent: "最近",
    dailyMix: "每日推荐",
    searchIndex: "歌曲索引",
    querying: "查询中...",
    results: "结果",
    matches: "条匹配",
    librarySource: "本地来源",
    songsTab: "[歌曲]",
    albumsTab: "[专辑]",
    total: "总计",
    loaded: "已载入",
    loading: "加载中",
    favoriteSongs: "收藏歌曲",
    favoriteAlbums: "收藏专辑",
    personal: "个人",
    source: "来源",
    current: "当前",
    songQueue: "歌曲队列",
    connection: "连接",
    libraryStats: "曲库统计",
    audio: "音频",
    interface: "界面",
    index: "索引",
    active: "活跃",
    standby: "待机",
    user: "用户",
    role: "角色",
    network: "网络",
    library: "曲库",
    songs: "歌曲",
    albums: "专辑",
    artists: "歌手",
    playlists: "歌单",
    mode: "模式",
    volume: "音量",
    progress: "进度",
    trackSize: "曲目大小",
    graphicalMode: "返回图形界面",
    themePreset: "主题预设",
    unknownArtist: "未知歌手",
    unknownAlbum: "未知专辑",
    noActiveSource: "没有活动播放源",
    notConfigured: "未配置",
    online: "在线",
    radio: "电台",
    networkSource: "网络曲库",
    prev: "上一页",
    next: "下一页",
    run: "运行",
    searchPlaceholder: "曲目、歌手、专辑、格式",
    searchPrompt: "/ 搜索",
    lyricsFollow: "$ 歌词跟随",
    favoriteSong: "收藏歌曲",
    unfavoriteSong: "取消收藏歌曲",
    favoriteAlbum: "收藏专辑",
    unfavoriteAlbum: "取消收藏专辑",
    title: "标题",
    artist: "艺人",
    album: "专辑",
    year: "年份",
    format: "格式",
    time: "时长",
    shellTheme: "Shell 主题",
    shellThemeHint: "只影响终端模式，不会修改标准界面的站点主题。",
    operatorTheme: "控制台操作员",
    operatorThemeHint: "默认主题，适合专业曲库管理和长时间浏览。",
    duskTheme: "暮色环境",
    duskThemeHint: "低对比度夜间主题，适合放松听歌和弱浏览。",
    phosphorTheme: "磷光绿屏",
    phosphorThemeHint: "单主色专注模式，尽量降低视觉噪声。",
    ashgrayTheme: "冷灰工作台",
    ashgrayThemeHint: "近乎无色的白天工作台，适合多窗口切换。",
    embersTheme: "暗火余烬",
    embersThemeHint: "深赭石和琥珀强调，适合古典、爵士和晚间深听。",
  },
  "en-US": {
    homeTab: "Home",
    searchTab: "Search",
    libraryTab: "Library",
    favoritesTab: "Favorites",
    queueTab: "Queue",
    consoleTab: "Console",
    shellContent: "Skip to shell content",
    shellTabs: "Shell tabs",
    connected: "connected",
    offline: "offline",
    limited: "limited",
    running: "running",
    paused: "paused",
    idle: "idle",
    rows: "rows",
    nowPlaying: "Now playing",
    recent: "Recent",
    dailyMix: "Daily mix",
    searchIndex: "song index",
    querying: "querying...",
    results: "Results",
    matches: "matches",
    librarySource: "local source",
    songsTab: "[Songs]",
    albumsTab: "[Albums]",
    total: "total",
    loaded: "loaded",
    loading: "loading",
    favoriteSongs: "Favorite songs",
    favoriteAlbums: "Favorite albums",
    personal: "personal",
    source: "source",
    current: "current",
    songQueue: "song queue",
    connection: "Connection",
    libraryStats: "Library stats",
    audio: "Audio",
    interface: "Interface",
    index: "index",
    active: "active",
    standby: "standby",
    user: "user",
    role: "role",
    network: "network",
    library: "library",
    songs: "songs",
    albums: "albums",
    artists: "artists",
    playlists: "playlists",
    mode: "mode",
    volume: "volume",
    progress: "progress",
    trackSize: "track size",
    graphicalMode: "Return to graphical mode",
    themePreset: "Theme preset",
    unknownArtist: "unknown artist",
    unknownAlbum: "unknown album",
    noActiveSource: "no active source",
    notConfigured: "not configured",
    online: "online",
    radio: "radio",
    networkSource: "network",
    prev: "prev",
    next: "next",
    run: "RUN",
    searchPlaceholder: "track, artist, album, format",
    searchPrompt: "/ search",
    lyricsFollow: "$ lyrics.follow",
    favoriteSong: "Favorite song",
    unfavoriteSong: "Unfavorite song",
    favoriteAlbum: "Favorite album",
    unfavoriteAlbum: "Unfavorite album",
    title: "Title",
    artist: "Artist",
    album: "Album",
    year: "Year",
    format: "Fmt",
    time: "Time",
    shellTheme: "Shell theme",
    shellThemeHint: "Affects Terminal Mode only and does not change the Standard UI site theme.",
    operatorTheme: "Operator Console",
    operatorThemeHint: "Default console for professional library management and long browsing.",
    duskTheme: "Dusk Ambient",
    duskThemeHint: "Low-contrast night theme for relaxed listening and light browsing.",
    phosphorTheme: "Phosphor Green",
    phosphorThemeHint: "Single-color focus mode with minimal visual noise.",
    ashgrayTheme: "Ash Gray",
    ashgrayThemeHint: "Nearly colorless daytime workstation for multi-window sessions.",
    embersTheme: "Embers",
    embersThemeHint: "Deep umber with amber accents for classical, jazz, and evening listening.",
  },
} as const;

type ShellTextKey = keyof (typeof shellDict)["zh-CN"];

const SHELL_TABS: { id: ShellTab; labelKey: ShellTextKey; key: string }[] = [
  { id: "home", labelKey: "homeTab", key: "1" },
  { id: "search", labelKey: "searchTab", key: "2" },
  { id: "library", labelKey: "libraryTab", key: "3" },
  { id: "favorites", labelKey: "favoritesTab", key: "4" },
  { id: "queue", labelKey: "queueTab", key: "5" },
  { id: "console", labelKey: "consoleTab", key: "6" },
];

type ShellThemePreset = {
  id: TerminalShellTheme;
  labelKey: ShellTextKey;
  hintKey: ShellTextKey;
  sample: string;
  progressFilled: string;
  progressEmpty: string;
  volumeFilled: string;
  volumeEmpty: string;
};

const SHELL_THEMES: ShellThemePreset[] = [
  { id: "operator", labelKey: "operatorTheme", hintKey: "operatorThemeHint", sample: "#0d0e10 / #5b8af5", progressFilled: "█", progressEmpty: "░", volumeFilled: "▪", volumeEmpty: "·" },
  { id: "dusk", labelKey: "duskTheme", hintKey: "duskThemeHint", sample: "#0f0f14 / #89b4fa", progressFilled: "━", progressEmpty: "╌", volumeFilled: "▪", volumeEmpty: "·" },
  { id: "phosphor", labelKey: "phosphorTheme", hintKey: "phosphorThemeHint", sample: "#070b07 / #9ede9e", progressFilled: "█", progressEmpty: "░", volumeFilled: "|", volumeEmpty: "." },
  { id: "ashgray", labelKey: "ashgrayTheme", hintKey: "ashgrayThemeHint", sample: "#111213 / #7ab3c2", progressFilled: "▬", progressEmpty: "─", volumeFilled: "▪", volumeEmpty: "·" },
  { id: "embers", labelKey: "embersTheme", hintKey: "embersThemeHint", sample: "#0e0b09 / #c8914a", progressFilled: "█", progressEmpty: "░", volumeFilled: "▪", volumeEmpty: "·" },
];

function createShellT(language: Settings["language"]) {
  const table = shellDict[language] ?? shellDict["zh-CN"];
  return (key: ShellTextKey) => table[key];
}

export type TerminalShellProps = {
  user: User;
  settings: Settings;
  health: HealthInfo | null;
  libraryStats: LibraryStats | null;
  networkReachable: boolean;
  offlineMode: boolean;
  songs: Song[];
  librarySongPage: SongPage | null;
  libraryPageLoading: boolean;
  albums: Album[];
  albumPage: AlbumPage | null;
  albumPageLoading: boolean;
  favoriteSongs: Song[];
  favoriteAlbums: Album[];
  recentPlayedSongs: Song[];
  dailyMix: Song[];
  queue: Song[];
  current: Song | null;
  currentRadio: RadioStation | null;
  currentNetworkTrack: NetworkTrack | null;
  playing: boolean;
  progress: number;
  duration: number;
  volume: number;
  playModeLabel: string;
  lyricLines: LyricLine[];
  activeLyric: string;
  lyricsLoading: boolean;
  shellTheme: TerminalShellTheme;
  t: ReturnType<typeof createT>;
  onShellThemeChange: (theme: TerminalShellTheme) => void;
  onExit: () => void;
  onPlaySong: (song: Song, list?: Song[]) => void;
  onPlayQueueSong: (song: Song) => void;
  onPlayAlbum: (album: Album) => void;
  onFavoriteSong: (song: Song) => void;
  onFavoriteAlbum: (album: Album) => void;
  onTogglePlayback: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onSeek: (seconds: number) => void;
  onVolume: (volume: number) => void;
  onLoadLibrarySongsPage: (page: number, search?: string) => void;
  onLoadAlbumPage: (page: number) => void;
};

type PanelProps = {
  title: string;
  meta?: string;
  children: ReactNode;
  className?: string;
};

function ShellPanel({ title, meta, children, className = "" }: PanelProps) {
  return (
    <section className={`ts-panel ${className}`.trim()}>
      <div className="ts-panel-head">
        <h2>{title}</h2>
        {meta ? <span>{meta}</span> : null}
      </div>
      {children}
    </section>
  );
}

function isEditableTarget(target: EventTarget | null) {
  const element = target instanceof HTMLElement ? target : null;
  return Boolean(element?.closest("input, textarea, select, [contenteditable='true']"));
}

function pageCount(page: Pick<SongPage | AlbumPage, "total" | "limit"> | null | undefined) {
  if (!page?.limit) return 1;
  return Math.max(1, Math.ceil(page.total / page.limit));
}

function clampIndex(index: number, length: number) {
  if (length <= 0) return 0;
  return Math.max(0, Math.min(length - 1, index));
}

function progressBar(progress: number, duration: number, theme: ShellThemePreset, width = 28) {
  const ratio = duration > 0 ? Math.max(0, Math.min(1, progress / duration)) : 0;
  const filled = Math.round(ratio * width);
  return `${theme.progressFilled.repeat(filled)}${theme.progressEmpty.repeat(Math.max(0, width - filled))}`;
}

function volumeBar(volume: number, theme: ShellThemePreset, width = 5) {
  const filled = Math.round(Math.max(0, Math.min(1, volume)) * width);
  return `${theme.volumeFilled.repeat(filled)}${theme.volumeEmpty.repeat(Math.max(0, width - filled))}`;
}

function songDetail(song: Song) {
  return [song.artist, song.album, formatQuality(song)].filter(Boolean).join(" · ");
}

function activeTitle(current: Song | null, radio: RadioStation | null, networkTrack: NetworkTrack | null, fallback: string) {
  return current?.title || networkTrack?.title || radio?.name || fallback;
}

function activeSubtitle(
  current: Song | null,
  radio: RadioStation | null,
  networkTrack: NetworkTrack | null,
  s: ReturnType<typeof createShellT>,
) {
  if (current) return [current.artist, current.album].filter(Boolean).join(" · ");
  if (networkTrack) return [networkTrack.artist, networkTrack.album, networkTrack.provider].filter(Boolean).join(" · ");
  if (radio) return [radio.country, radio.codec || radio.tags, radio.bitrate ? `${radio.bitrate}kbps` : ""].filter(Boolean).join(" · ");
  return s("idle");
}

function activeLyrics(lines: LyricLine[], activeKey: string) {
  if (!lines.length) return [];
  const index = lines.findIndex((line) => line.key === activeKey);
  if (index < 0) return lines.slice(0, 5);
  return lines.slice(Math.max(0, index - 2), index + 3);
}

export function TerminalShell({
  user,
  settings,
  health,
  libraryStats,
  networkReachable,
  offlineMode,
  songs,
  librarySongPage,
  libraryPageLoading,
  albums,
  albumPage,
  albumPageLoading,
  favoriteSongs,
  favoriteAlbums,
  recentPlayedSongs,
  dailyMix,
  queue,
  current,
  currentRadio,
  currentNetworkTrack,
  playing,
  progress,
  duration,
  volume,
  playModeLabel,
  lyricLines,
  activeLyric,
  lyricsLoading,
  shellTheme,
  t,
  onShellThemeChange,
  onExit,
  onPlaySong,
  onPlayQueueSong,
  onPlayAlbum,
  onFavoriteSong,
  onFavoriteAlbum,
  onTogglePlayback,
  onPrevious,
  onNext,
  onSeek,
  onVolume,
  onLoadLibrarySongsPage,
  onLoadAlbumPage,
}: TerminalShellProps) {
  const [activeTab, setActiveTab] = useState<ShellTab>("home");
  const [librarySection, setLibrarySection] = useState<LibrarySection>("songs");
  const [favoriteSection, setFavoriteSection] = useState<FavoriteSection>("songs");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchPage, setSearchPage] = useState<SongPage | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const shellMainRef = useRef<HTMLElement | null>(null);
  const lyricsRef = useRef<HTMLDivElement | null>(null);
  const s = useMemo(() => createShellT(settings.language), [settings.language]);
  const activeTheme = useMemo(
    () => SHELL_THEMES.find((theme) => theme.id === shellTheme) ?? SHELL_THEMES[0],
    [shellTheme],
  );

  const libraryRows = librarySongPage?.items?.length ? librarySongPage.items : songs;
  const recommendedRows = dailyMix.length ? dailyMix : songs.slice(0, 8);
  const currentDuration = duration || current?.duration_seconds || currentNetworkTrack?.duration_seconds || 0;
  const nowTitle = activeTitle(current, currentRadio, currentNetworkTrack, t("nowPlaying"));
  const nowSubtitle = activeSubtitle(current, currentRadio, currentNetworkTrack, s);
  const visibleLyrics = activeLyrics(lyricLines, activeLyric);
  const connectionKey = offlineMode ? "offline" : networkReachable ? "connected" : "limited";
  const connectionLabel = s(connectionKey);

  const selectShellTheme = useCallback((theme: TerminalShellTheme) => {
    onShellThemeChange(theme);
  }, [onShellThemeChange]);

  useEffect(() => {
    shellMainRef.current?.focus();
  }, []);

  const activeRows = useMemo(() => {
    if (activeTab === "search") return searchPage?.items ?? [];
    if (activeTab === "library" && librarySection === "songs") return libraryRows;
    if (activeTab === "favorites" && favoriteSection === "songs") return favoriteSongs;
    if (activeTab === "queue") return queue;
    if (activeTab === "home") return recentPlayedSongs.length ? recentPlayedSongs : recommendedRows;
    return [];
  }, [
    activeTab,
    favoriteSection,
    favoriteSongs,
    libraryRows,
    librarySection,
    queue,
    recentPlayedSongs,
    recommendedRows,
    searchPage,
  ]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [
    activeTab,
    librarySection,
    favoriteSection,
    searchPage?.page,
    librarySongPage?.page,
    albumPage?.page,
    favoriteSongs.length,
    favoriteAlbums.length,
    queue.length,
  ]);

  useEffect(() => {
    if (!lyricsOpen || !activeLyric) return;
    const node = lyricsRef.current?.querySelector<HTMLElement>(`[data-lyric-key="${CSS.escape(activeLyric)}"]`);
    node?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeLyric, lyricsOpen]);

  const runSearch = useCallback(async (page = 1, value = searchQuery) => {
    const query = value.trim();
    setSearchQuery(value);
    setSearchLoading(true);
    setSearchError("");
    try {
      setSearchPage(await api.songsPage(query, page, 24));
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : t("loadFailed"));
    } finally {
      setSearchLoading(false);
    }
  }, [searchQuery, t]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape" && event.shiftKey) {
        event.preventDefault();
        onExit();
        return;
      }
      if (lyricsOpen && event.key === "Escape") {
        event.preventDefault();
        setLyricsOpen(false);
        return;
      }

      const editing = isEditableTarget(event.target);
      if (editing) {
        if (event.key === "Escape") {
          event.preventDefault();
          (event.target as HTMLElement).blur();
        }
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const digit = Number(event.key);
      if (digit >= 1 && digit <= SHELL_TABS.length) {
        event.preventDefault();
        setActiveTab(SHELL_TABS[digit - 1].id);
        return;
      }

      const key = event.key.toLowerCase();
      if (event.key === "/") {
        event.preventDefault();
        setActiveTab("search");
        window.setTimeout(() => searchInputRef.current?.focus(), 0);
        return;
      }
      if (event.key === " ") {
        event.preventDefault();
        onTogglePlayback();
        return;
      }
      if (event.key === "ArrowLeft" && currentDuration > 0 && !currentRadio) {
        event.preventDefault();
        onSeek(Math.max(0, progress - (event.shiftKey ? 30 : 5)));
        return;
      }
      if (event.key === "ArrowRight" && currentDuration > 0 && !currentRadio) {
        event.preventDefault();
        onSeek(Math.min(currentDuration, progress + (event.shiftKey ? 30 : 5)));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        onVolume(Math.min(1, volume + 0.05));
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        onVolume(Math.max(0, volume - 0.05));
        return;
      }
      if (key === "l") {
        event.preventDefault();
        setLyricsOpen((value) => !value);
        return;
      }
      if (key === "n") {
        event.preventDefault();
        onNext();
        return;
      }
      if (key === "p") {
        event.preventDefault();
        onPrevious();
        return;
      }
      if (key === "f") {
        const song = activeRows[selectedIndex] || current;
        if (!song) return;
        event.preventDefault();
        onFavoriteSong(song);
        return;
      }
      if (key === "j" || key === "k") {
        event.preventDefault();
        setSelectedIndex((index) => clampIndex(index + (key === "j" ? 1 : -1), activeRows.length));
        return;
      }
      if (event.key === "Enter") {
        const song = activeRows[selectedIndex];
        if (!song) return;
        event.preventDefault();
        if (activeTab === "queue") onPlayQueueSong(song);
        else onPlaySong(song, activeRows);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    activeRows,
    activeTab,
    currentDuration,
    currentRadio,
    lyricsOpen,
    onExit,
    onFavoriteSong,
    onPlayQueueSong,
    onPlaySong,
    onNext,
    onPrevious,
    onSeek,
    onTogglePlayback,
    onVolume,
    progress,
    selectedIndex,
    volume,
  ]);

  const renderSongRows = (items: Song[], options: { baseIndex?: number; source: Song[]; queueRows?: boolean } = { source: items }) => {
    const baseIndex = options.baseIndex ?? 0;
    return items.map((song, index) => {
      const globalIndex = baseIndex + index;
      const selected = activeRows === options.source && selectedIndex === globalIndex;
      const active = current?.id === song.id;
      return (
        <div
          key={`${song.id}-${index}`}
          className={`ts-table-row ts-song-row${active ? " active" : ""}${selected ? " selected" : ""}`}
          aria-current={active ? "true" : undefined}
        >
          <button
            type="button"
            className="ts-row-main"
            onClick={() => options.queueRows ? onPlayQueueSong(song) : onPlaySong(song, options.source)}
          >
            <span className="ts-row-marker">{active ? "►" : selected ? "›" : ""}</span>
            <span className="ts-row-index">{String(globalIndex + 1).padStart(2, "0")}</span>
            <strong title={song.title}>{song.title || song.file_name}</strong>
            <span title={song.artist}>{song.artist || s("unknownArtist")}</span>
            <span title={song.album}>{song.album || s("unknownAlbum")}</span>
            <span>{song.format ? song.format.toUpperCase() : "AUDIO"}</span>
            <time>{formatDuration(song.duration_seconds)}</time>
          </button>
          <button
            type="button"
            className={song.favorite ? "ts-inline-action active" : "ts-inline-action"}
            aria-label={song.favorite ? s("unfavoriteSong") : s("favoriteSong")}
            onClick={() => {
              onFavoriteSong(song);
            }}
          >
            {song.favorite ? "♥" : "♡"}
          </button>
        </div>
      );
    });
  };

  const renderAlbumRows = (items: Album[]) => (
    <div className="ts-table ts-album-table" role="table" aria-label={t("albums")}>
      <div className="ts-table-row ts-table-header" role="row">
        <span />
        <span>#</span>
        <span>{s("album")}</span>
        <span>{s("artist")}</span>
        <span>{s("year")}</span>
        <span>{s("songs")}</span>
        <span />
      </div>
      {items.map((album, index) => (
        <div
          key={album.id}
          className="ts-table-row"
        >
          <button type="button" className="ts-row-main" onClick={() => onPlayAlbum(album)}>
            <span className="ts-row-marker">▸</span>
            <span className="ts-row-index">{String(index + 1).padStart(2, "0")}</span>
            <strong title={album.title}>{album.title}</strong>
            <span title={album.artist}>{album.artist || album.album_artist || s("unknownArtist")}</span>
            <span>{album.year || "----"}</span>
            <span>{album.song_count}</span>
          </button>
          <button
            type="button"
            className={album.favorite ? "ts-inline-action active" : "ts-inline-action"}
            aria-label={album.favorite ? s("unfavoriteAlbum") : s("favoriteAlbum")}
            onClick={() => {
              onFavoriteAlbum(album);
            }}
          >
            {album.favorite ? "♥" : "♡"}
          </button>
        </div>
      ))}
    </div>
  );

  const renderSongTable = (items: Song[], source = items, queueRows = false) => (
    <div className="ts-table ts-song-table" role="table" aria-label={t("songs")}>
      <div className="ts-table-row ts-table-header" role="row">
        <span />
        <span>#</span>
        <span>{s("title")}</span>
        <span>{s("artist")}</span>
        <span>{s("album")}</span>
        <span>{s("format")}</span>
        <span>{s("time")}</span>
        <span />
      </div>
      {items.length ? renderSongRows(items, { source, queueRows }) : <div className="ts-empty">{t("emptyCollection")}</div>}
    </div>
  );

  return (
    <div className="terminal-shell" data-connection={connectionKey} data-shell-theme={shellTheme}>
      <a className="ts-skip-link" href="#terminal-main">{s("shellContent")}</a>
      <header className="ts-topbar">
        <div className="ts-brand">
          <span aria-hidden="true">&gt;_</span>
          <strong>LARK SHELL</strong>
        </div>
        <nav className="ts-tabs" aria-label={s("shellTabs")}>
          {SHELL_TABS.map((tab) => (
            <button
              type="button"
              key={tab.id}
              className={activeTab === tab.id ? "active" : ""}
              aria-current={activeTab === tab.id ? "page" : undefined}
              onClick={() => setActiveTab(tab.id)}
            >
              <span>{tab.key}</span>
              {s(tab.labelKey)}
            </button>
          ))}
        </nav>
        <div className="ts-status">
          <span>{connectionLabel}</span>
          <span>{user.nickname || user.username}</span>
          <button type="button" onClick={onExit} aria-label={t("switchToStandardUI")}>
            [{t("standardUI")}]
          </button>
        </div>
      </header>

      <main id="terminal-main" className="ts-main" ref={shellMainRef} tabIndex={-1}>
        {activeTab === "home" ? (
          <div className="ts-grid ts-home-grid">
            <ShellPanel title={s("nowPlaying").toUpperCase()} meta={playing ? s("running") : s("paused")} className="ts-now-panel">
              <div className="ts-now-block">
                <span className="ts-command">$ playback.status</span>
                <h1>{nowTitle}</h1>
                <p>{nowSubtitle || s("noActiveSource")}</p>
                {current ? <code>{songDetail(current)}</code> : null}
              </div>
              <div className="ts-lyrics-preview">
                {lyricsLoading ? <span>{t("matchingLyrics")}</span> : null}
                {!lyricsLoading && !visibleLyrics.length ? <span>{t("noLyrics")}</span> : null}
                {visibleLyrics.map((line) => (
                  <span key={line.key} className={line.key === activeLyric ? "active" : ""}>
                    {line.key === activeLyric ? "► " : "  "}
                    {line.text}
                  </span>
                ))}
              </div>
            </ShellPanel>
            <ShellPanel title={s("recent").toUpperCase()} meta={`${recentPlayedSongs.length} ${s("rows")}`}>
              {renderSongTable(recentPlayedSongs.slice(0, 10), recentPlayedSongs)}
            </ShellPanel>
            <ShellPanel title={s("dailyMix").toUpperCase()} meta={`${recommendedRows.length} ${s("rows")}`}>
              {renderSongTable(recommendedRows.slice(0, 10), recommendedRows)}
            </ShellPanel>
          </div>
        ) : null}

        {activeTab === "search" ? (
          <div className="ts-stack">
            <ShellPanel title={s("searchTab").toUpperCase()} meta={searchLoading ? s("querying") : s("searchIndex")}>
              <form
                className="ts-search-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void runSearch(1);
                }}
              >
                <label htmlFor="terminal-search">{s("searchPrompt")}</label>
                <input
                  id="terminal-search"
                  ref={searchInputRef}
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder={s("searchPlaceholder")}
                />
                <button type="submit">{s("run")}</button>
              </form>
              {searchError ? <div className="ts-error">{searchError}</div> : null}
            </ShellPanel>
            <ShellPanel
              title={s("results").toUpperCase()}
              meta={searchPage ? `${searchPage.total} ${s("matches")}` : s("idle")}
            >
              {renderSongTable(searchPage?.items ?? [], searchPage?.items ?? [])}
              {searchPage ? (
                <div className="ts-pager">
                  <button type="button" disabled={searchPage.page <= 1 || searchLoading} onClick={() => void runSearch(searchPage.page - 1)}>
                    {s("prev")}
                  </button>
                  <span>{searchPage.page} / {pageCount(searchPage)}</span>
                  <button type="button" disabled={searchPage.page >= pageCount(searchPage) || searchLoading} onClick={() => void runSearch(searchPage.page + 1)}>
                    {s("next")}
                  </button>
                </div>
              ) : null}
            </ShellPanel>
          </div>
        ) : null}

        {activeTab === "library" ? (
          <div className="ts-stack">
            <ShellPanel title={s("libraryTab").toUpperCase()} meta={libraryStats ? `${libraryStats.songs} ${s("songs")} · ${libraryStats.albums} ${s("albums")}` : s("librarySource")}>
              <div className="ts-subtabs" role="tablist" aria-label={t("library")}>
                <button type="button" className={librarySection === "songs" ? "active" : ""} onClick={() => setLibrarySection("songs")}>{s("songsTab")}</button>
                <button type="button" className={librarySection === "albums" ? "active" : ""} onClick={() => setLibrarySection("albums")}>{s("albumsTab")}</button>
              </div>
            </ShellPanel>
            {librarySection === "songs" ? (
              <ShellPanel title={s("songs").toUpperCase()} meta={libraryPageLoading ? s("loading") : librarySongPage ? `${librarySongPage.total} ${s("total")}` : `${libraryRows.length} ${s("loaded")}`}>
                {renderSongTable(libraryRows, libraryRows)}
                {librarySongPage ? (
                  <div className="ts-pager">
                    <button type="button" disabled={librarySongPage.page <= 1 || libraryPageLoading} onClick={() => onLoadLibrarySongsPage(librarySongPage.page - 1)}>
                      {s("prev")}
                    </button>
                    <span>{librarySongPage.page} / {pageCount(librarySongPage)}</span>
                    <button type="button" disabled={librarySongPage.page >= pageCount(librarySongPage) || libraryPageLoading} onClick={() => onLoadLibrarySongsPage(librarySongPage.page + 1)}>
                      {s("next")}
                    </button>
                  </div>
                ) : null}
              </ShellPanel>
            ) : (
              <ShellPanel title={s("albums").toUpperCase()} meta={albumPageLoading ? s("loading") : albumPage ? `${albumPage.total} ${s("total")}` : `${albums.length} ${s("loaded")}`}>
                {albums.length ? renderAlbumRows(albums) : <div className="ts-empty">{t("emptyCollection")}</div>}
                {albumPage ? (
                  <div className="ts-pager">
                    <button type="button" disabled={albumPage.page <= 1 || albumPageLoading} onClick={() => onLoadAlbumPage(albumPage.page - 1)}>
                      {s("prev")}
                    </button>
                    <span>{albumPage.page} / {pageCount(albumPage)}</span>
                    <button type="button" disabled={albumPage.page >= pageCount(albumPage) || albumPageLoading} onClick={() => onLoadAlbumPage(albumPage.page + 1)}>
                      {s("next")}
                    </button>
                  </div>
                ) : null}
              </ShellPanel>
            )}
          </div>
        ) : null}

        {activeTab === "favorites" ? (
          <div className="ts-stack">
            <ShellPanel title={s("favoritesTab").toUpperCase()} meta={`${favoriteSongs.length} ${s("songs")} · ${favoriteAlbums.length} ${s("albums")}`}>
              <div className="ts-subtabs" role="tablist" aria-label={t("favorites")}>
                <button type="button" className={favoriteSection === "songs" ? "active" : ""} onClick={() => setFavoriteSection("songs")}>{s("songsTab")}</button>
                <button type="button" className={favoriteSection === "albums" ? "active" : ""} onClick={() => setFavoriteSection("albums")}>{s("albumsTab")}</button>
              </div>
            </ShellPanel>
            <ShellPanel title={favoriteSection === "songs" ? s("favoriteSongs").toUpperCase() : s("favoriteAlbums").toUpperCase()} meta={s("personal")}>
              {favoriteSection === "songs"
                ? renderSongTable(favoriteSongs, favoriteSongs)
                : favoriteAlbums.length
                  ? renderAlbumRows(favoriteAlbums)
                  : <div className="ts-empty">{t("emptyFavorites")}</div>}
            </ShellPanel>
          </div>
        ) : null}

        {activeTab === "queue" ? (
          <div className="ts-stack">
            <ShellPanel title={s("queueTab").toUpperCase()} meta={`${queue.length} ${s("rows")} · ${playModeLabel}`}>
              <div className="ts-queue-banner">
                <span>{s("source")}</span>
                <strong>{currentRadio ? s("radio") : currentNetworkTrack ? s("networkSource") : current ? s("songQueue") : s("idle")}</strong>
                <span>{s("current")}</span>
                <strong>{nowTitle}</strong>
              </div>
              {renderSongTable(queue, queue, true)}
            </ShellPanel>
          </div>
        ) : null}

        {activeTab === "console" ? (
          <div className="ts-grid ts-console-grid">
            <ShellPanel title={s("connection").toUpperCase()} meta={connectionLabel}>
              <dl className="ts-kv">
                <div><dt>{s("user")}</dt><dd>{user.nickname || user.username}</dd></div>
                <div><dt>{s("role")}</dt><dd>{user.role}</dd></div>
                <div><dt>{s("network")}</dt><dd>{networkReachable ? s("online") : s("offline")}</dd></div>
                <div><dt>{s("library")}</dt><dd>{health?.library || settings.library_path || s("notConfigured")}</dd></div>
              </dl>
            </ShellPanel>
            <ShellPanel title={s("libraryStats").toUpperCase()} meta={s("index")}>
              <dl className="ts-kv">
                <div><dt>{s("songs")}</dt><dd>{libraryStats?.songs ?? songs.length}</dd></div>
                <div><dt>{s("albums")}</dt><dd>{libraryStats?.albums ?? albums.length}</dd></div>
                <div><dt>{s("artists")}</dt><dd>{libraryStats?.artists ?? "n/a"}</dd></div>
                <div><dt>{s("playlists")}</dt><dd>{libraryStats?.playlists ?? "n/a"}</dd></div>
              </dl>
            </ShellPanel>
            <ShellPanel title={s("audio").toUpperCase()} meta={playing ? s("active") : s("standby")}>
              <dl className="ts-kv">
                <div><dt>{s("mode")}</dt><dd>{playModeLabel}</dd></div>
                <div><dt>{s("volume")}</dt><dd>{Math.round(volume * 100)}%</dd></div>
                <div><dt>{s("progress")}</dt><dd>{formatDuration(progress)} / {formatDuration(currentDuration)}</dd></div>
                <div><dt>{s("trackSize")}</dt><dd>{current ? formatBytes(current.size_bytes) : "n/a"}</dd></div>
              </dl>
            </ShellPanel>
            <ShellPanel title={s("shellTheme").toUpperCase()} meta={s("themePreset")}>
              <div className="ts-theme-picker" role="radiogroup" aria-label={s("shellTheme")}>
                {SHELL_THEMES.map((theme) => (
                  <button
                    key={theme.id}
                    type="button"
                    role="radio"
                    aria-checked={shellTheme === theme.id}
                    className={shellTheme === theme.id ? "active" : ""}
                    onClick={() => selectShellTheme(theme.id)}
                  >
                    <span>{shellTheme === theme.id ? "►" : " "}</span>
                    <strong>{s(theme.labelKey)}</strong>
                    <code>{theme.sample}</code>
                    <small>{s(theme.hintKey)}</small>
                  </button>
                ))}
              </div>
              <p className="ts-panel-note">{s("shellThemeHint")}</p>
            </ShellPanel>
            <ShellPanel title={s("interface").toUpperCase()} meta={s("mode")}>
              <button type="button" className="ts-switch-card" onClick={onExit}>
                <span>► {t("switchToStandardUI")}</span>
                <small>{s("graphicalMode")}</small>
              </button>
            </ShellPanel>
          </div>
        ) : null}
      </main>

      <footer className="ts-player">
        <div className="ts-player-row ts-player-primary">
          <div className="ts-player-track">
            <span>{playing ? "▶" : "Ⅱ"}</span>
            <div>
              <strong title={nowTitle}>{nowTitle}</strong>
              <small title={nowSubtitle}>{nowSubtitle || s("idle")}</small>
            </div>
          </div>
          <div className="ts-player-controls">
            <button type="button" aria-label={t("previous")} onClick={onPrevious}>⏮</button>
            <button type="button" className="primary" aria-label={playing ? t("pause") : t("play")} onClick={onTogglePlayback}>
              {playing ? "⏸" : "▶"}
            </button>
            <button type="button" aria-label={t("next")} onClick={onNext}>⏭</button>
            <button type="button" aria-label={t("lyrics")} onClick={() => setLyricsOpen(true)}>[L]</button>
          </div>
          <div className="ts-player-right">
            <span>{s("volume").toUpperCase()} {volumeBar(volume, activeTheme)}</span>
            <span>{s("queueTab").toUpperCase()}({queue.length})</span>
            <button type="button" aria-label={t("switchToStandardUI")} onClick={onExit}>[UI]</button>
          </div>
        </div>
        <div className="ts-player-row ts-progress-row">
          <span>{progressBar(progress, currentDuration, activeTheme)}</span>
          <time>{formatDuration(progress)} / {formatDuration(currentDuration)}</time>
          <input
            type="range"
            min="0"
            max={currentDuration || 0}
            value={Math.min(progress, currentDuration || progress || 0)}
            step="0.01"
            disabled={!currentDuration || Boolean(currentRadio)}
            aria-label={t("position")}
            onChange={(event) => onSeek(Number(event.currentTarget.value))}
          />
          <input
            type="range"
            min="0"
            max="1"
            value={volume}
            step="0.01"
            aria-label={t("volume")}
            onChange={(event) => onVolume(Number(event.currentTarget.value))}
          />
        </div>
      </footer>

      {lyricsOpen ? (
        <div className="ts-overlay" role="dialog" aria-modal="true" aria-labelledby="ts-lyrics-title">
          <div className="ts-lyrics" ref={lyricsRef}>
            <div className="ts-overlay-head">
              <div>
                <span>{s("lyricsFollow")}</span>
                <h2 id="ts-lyrics-title">{current?.title || t("lyrics")}</h2>
              </div>
              <button type="button" onClick={() => setLyricsOpen(false)} aria-label={t("close")}>[Esc]</button>
            </div>
            <div className="ts-lyrics-lines">
              {!lyricLines.length ? <p>{lyricsLoading ? t("matchingLyrics") : t("noLyrics")}</p> : null}
              {lyricLines.map((line) => (
                <div
                  key={line.key}
                  data-lyric-key={line.key}
                  className={line.key === activeLyric ? "active" : ""}
                >
                  <span>{line.key === activeLyric ? "►" : String(line.order + 1).padStart(2, "0")}</span>
                  <p>{line.text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
