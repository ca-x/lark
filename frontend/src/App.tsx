import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Disc,
  GearSix,
  Heart,
  House,
  ListBullets,
  MagnifyingGlass,
  MusicNotes,
  Pause,
  Play,
  Playlist as PlaylistIcon,
  Plus,
  Record,
  Repeat,
  RepeatOnce,
  Shuffle,
  SkipBack,
  SkipForward,
  SpeakerHigh,
  Timer,
  UploadSimple,
} from "@phosphor-icons/react";
import { api } from "./services/api";
import type {
  Album,
  Artist,
  AuthStatus,
  Language,
  Lyrics,
  Playlist,
  ScanStatus,
  Settings,
  Song,
  Theme,
  User,
} from "./types";
import { createT } from "./i18n";

const defaultSettings: Settings = {
  language: "zh-CN",
  theme: "deep-space",
  sleep_timer_mins: 0,
  library_path: "",
  netease_fallback: true,
  registration_enabled: false,
};

type View =
  | "home"
  | "library"
  | "playlists"
  | "albums"
  | "artists"
  | "collection"
  | "settings";
type PlayMode = "sequence" | "shuffle" | "repeat-one";
type ThemeLabel =
  | "deepSpace"
  | "amberFilm"
  | "neonCoral"
  | "arcticAurora"
  | "carbonVolt"
  | "milkPorcelain"
  | "oatLatte"
  | "mintSoda"
  | "sakuraWashi"
  | "duskAmber";
type Collection = {
  type: "playlist" | "album" | "artist";
  title: string;
  subtitle: string;
  songs: Song[];
  artistId?: number;
  artistName?: string;
};
const themes: { id: Theme; label: ThemeLabel }[] = [
  { id: "deep-space", label: "deepSpace" },
  { id: "amber-film", label: "amberFilm" },
  { id: "neon-coral", label: "neonCoral" },
  { id: "arctic-aurora", label: "arcticAurora" },
  { id: "carbon-volt", label: "carbonVolt" },
  { id: "milk-porcelain", label: "milkPorcelain" },
  { id: "oat-latte", label: "oatLatte" },
  { id: "mint-soda", label: "mintSoda" },
  { id: "sakura-washi", label: "sakuraWashi" },
  { id: "dusk-amber", label: "duskAmber" },
];
const themeAliases: Record<string, Theme> = {
  spotify: "deep-space",
  apple: "arctic-aurora",
  vinyl: "amber-film",
  roon: "deep-space",
  netease: "neon-coral",
  midnight: "deep-space",
  paper: "amber-film",
  porcelain: "milk-porcelain",
  latte: "oat-latte",
  mint: "mint-soda",
  sakura: "sakura-washi",
  amber: "dusk-amber",
};
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

function coverUrl(song?: Song | null) {
  return song ? `/api/songs/${song.id}/cover` : undefined;
}

function formatDuration(seconds: number) {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}`;
}

function formatQuality(song: Song) {
  const bits = song.bit_depth ? `${song.bit_depth}bit` : "";
  const rate = song.sample_rate
    ? `${(song.sample_rate / 1000).toFixed(song.sample_rate % 1000 ? 1 : 0)}kHz`
    : "";
  return (
    [song.format.toUpperCase(), bits, rate].filter(Boolean).join(" · ") ||
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

  return parsed.sort((a, b) => {
    if (a.at < 0 && b.at < 0) return a.order - b.order;
    if (a.at < 0) return 1;
    if (b.at < 0) return -1;
    return a.at - b.at || a.order - b.order;
  });
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  const [songs, setSongs] = useState<Song[]>([]);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [artists, setArtists] = useState<Artist[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [queue, setQueue] = useState<Song[]>([]);
  const [collection, setCollection] = useState<Collection | null>(null);
  const [current, setCurrent] = useState<Song | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playMode, setPlayMode] = useState<PlayMode>("sequence");
  const [view, setView] = useState<View>("home");
  const [query, setQuery] = useState("");
  const [lyrics, setLyrics] = useState<Lyrics | null>(null);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [lyricsFullScreen, setLyricsFullScreen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [scanStatus, setScanStatus] = useState<ScanStatus | null>(null);
  const [sleepTimerMins, setSleepTimerMins] = useState(0);
  const [sleepLeft, setSleepLeft] = useState(0);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lyricsScrollRef = useRef<HTMLDivElement | null>(null);
  const lyricFollowPausedUntil = useRef(0);
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

  useEffect(() => {
    void bootstrap();
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.lang = settings.language;
    document.title = `${t("brand")} Music`;
  }, [settings.theme, settings.language, t]);
  useEffect(() => {
    if (!current) return;
    setProgress(0);
    setDuration(current.duration_seconds || 0);
    setLyrics(null);
    setLyricsLoading(true);
    void api
      .lyrics(current.id)
      .then(setLyrics)
      .catch(() => setLyrics(null))
      .finally(() => setLyricsLoading(false));
  }, [current]);
  useEffect(() => {
    if (!audioRef.current) return;
    if (playing) void audioRef.current.play().catch(() => setPlaying(false));
    else audioRef.current.pause();
  }, [playing, current]);
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
      if (status.initialized && status.user) {
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
    await refreshAll();
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
    setAlbums([]);
    setArtists([]);
    setPlaylists([]);
    setQueue([]);
    setCurrent(null);
    setPlaying(false);
    await bootstrap();
  }

  async function refreshAll() {
    const [songItems, albumItems, artistItems, playlistItems] =
      await Promise.all([
        api.songs(query),
        api.albums(),
        api.artists(),
        api.playlists(),
      ]);
    setSongs(songItems);
    setAlbums(albumItems);
    setArtists(artistItems);
    setPlaylists(playlistItems);
    setQueue(songItems);
    setCurrent((old) => old ?? songItems[0] ?? null);
  }

  async function playSong(song: Song, list = songs) {
    const sameSong = current?.id === song.id;
    setCurrent(song);
    setQueue(list.length ? list : [song]);
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
    }
    setPlaying(true);
    await api.markPlayed(song.id).catch(() => undefined);
  }

  function next(delta: 1 | -1, ended = false) {
    if (!current || queue.length === 0) return;
    if (ended && playMode === "repeat-one") {
      const audio = audioRef.current;
      if (audio) {
        audio.currentTime = 0;
        setProgress(0);
        const mediaDuration = audio.duration;
        setDuration(
          Number.isFinite(mediaDuration) && mediaDuration > 0
            ? mediaDuration
            : current.duration_seconds || 0,
        );
        void audio
          .play()
          .then(() => setPlaying(true))
          .catch(() => setPlaying(false));
      } else {
        setPlaying(true);
      }
      void api.markPlayed(current.id).catch(() => undefined);
      return;
    }
    const idx = queue.findIndex((song) => song.id === current.id);
    const target =
      playMode === "shuffle" && queue.length > 1
        ? queue[randomQueueIndex(queue.length, Math.max(0, idx))]
        : queue[(idx + delta + queue.length) % queue.length];
    if (target.id === current.id && audioRef.current) {
      audioRef.current.currentTime = 0;
      setProgress(0);
      const mediaDuration = audioRef.current.duration;
      setDuration(
        Number.isFinite(mediaDuration) && mediaDuration > 0
          ? mediaDuration
          : target.duration_seconds || 0,
      );
      void audioRef.current
        .play()
        .then(() => setPlaying(true))
        .catch(() => setPlaying(false));
      return;
    }
    void playSong(target, queue);
  }

  function insertNextBatch(items: Song[]) {
    const batch = items.filter(Boolean);
    if (!batch.length) return;
    if (!current) {
      setQueue(batch);
      void playSong(batch[0], batch);
      setMessage(t("queueInserted"));
      return;
    }
    setQueue((old) => {
      const base = old.length ? old : [current];
      const idx = Math.max(
        0,
        base.findIndex((song) => song.id === current.id),
      );
      return [...base.slice(0, idx + 1), ...batch, ...base.slice(idx + 1)];
    });
    setMessage(t("queueInserted"));
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
    setMessage(`${t("scanning")}...`);
    const poll = window.setInterval(() => {
      void api.scanStatus().then(setScanStatus).catch(() => undefined);
    }, 500);
    try {
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
      setMessage(
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
    setMessage(`Uploading ${file.name}...`);
    await api.upload(file);
    setMessage(t("done"));
    await refreshAll();
  }

  async function saveSettings(nextSettings: Settings) {
    setSettings(nextSettings);
    await api.saveSettings(nextSettings).catch(() => undefined);
  }

  async function toggleFavorite(song: Song) {
    const updated = await api.favoriteSong(song.id);
    setSongs((old) =>
      old.map((item) => (item.id === updated.id ? updated : item)),
    );
    if (current?.id === updated.id) setCurrent(updated);
  }

  async function createPlaylist() {
    const name = window.prompt(t("createPlaylist"))?.trim();
    if (!name) return;
    await api.createPlaylist(name, "", settings.theme);
    setPlaylists(await api.playlists());
  }

  async function addToPlaylist(song: Song) {
    if (playlists.length === 0) await createPlaylist();
    const latest = await api.playlists();
    setPlaylists(latest);
    const choice = window.prompt(
      `${t("pickPlaylist")}:\n${latest.map((p) => `${p.id}: ${p.name}`).join("\n")}`,
    );
    const id = Number(choice);
    if (!id) return;
    await api.addToPlaylist(id, song.id);
    setMessage(t("done"));
  }

  async function openPlaylist(playlist: Playlist) {
    const items = await api.playlistSongs(playlist.id);
    setCollection({
      type: "playlist",
      title: playlist.name,
      subtitle: `${items.length} ${t("count")}`,
      songs: items,
    });
    setView("collection");
  }

  async function openAlbum(album: Album) {
    const items = await api.albumSongs(album.id);
    setCollection({
      type: "album",
      title: album.title,
      subtitle: `${album.artist} · ${items.length} ${t("count")}`,
      songs: items,
      artistId: album.artist_id,
      artistName: album.artist,
    });
    setView("collection");
  }

  async function openArtistById(id: number, fallbackName = "") {
    if (!id) return;
    const items = await api.artistSongs(id);
    const artist = artists.find((item) => item.id === id);
    const title =
      artist?.name || fallbackName || items[0]?.artist || t("artists");
    setCollection({
      type: "artist",
      title,
      subtitle: `${items.length} ${t("count")}`,
      songs: items,
      artistId: id,
      artistName: title,
    });
    setView("collection");
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

  const nav = [
    { id: "home", label: t("home"), icon: <House /> },
    { id: "library", label: t("library"), icon: <MusicNotes /> },
    { id: "playlists", label: t("playlists"), icon: <PlaylistIcon /> },
    { id: "albums", label: t("albums"), icon: <Disc /> },
    { id: "artists", label: t("artists"), icon: <Record /> },
    { id: "settings", label: t("settings"), icon: <GearSix /> },
  ] as const;
  const activeNav = (id: (typeof nav)[number]["id"]) =>
    view === id ||
    (view === "collection" &&
      collection?.type === "playlist" &&
      id === "playlists") ||
    (view === "collection" &&
      collection?.type === "album" &&
      id === "albums") ||
    (view === "collection" &&
      collection?.type === "artist" &&
      id === "artists");
  const heroSong = current ?? songs[0];
  const playModeLabel =
    playMode === "sequence"
      ? t("playModeSequence")
      : playMode === "shuffle"
        ? t("playModeShuffle")
        : t("playModeRepeatOne");
  const playableDuration = duration || current?.duration_seconds || 0;
  const screenTitle =
    collection && view === "collection"
      ? collection.title
      : (nav.find((item) => item.id === view)?.label ?? t("brand"));
  const playerStyle = coverUrl(current)
    ? ({ "--cover-url": `url(${coverUrl(current)})` } as React.CSSProperties)
    : undefined;

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
                if (item.id === "library") void api.songs(query).then(setSongs);
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
            onUserScroll={() => {
              lyricFollowPausedUntil.current = Date.now() + 2500;
            }}
          />
        ) : (
          <>
            <header className="topbar">
              <div className="top-title">
                <span>{t("brand")}</span>
                <h1>{screenTitle}</h1>
              </div>
              <label className="search">
                <MagnifyingGlass />
                <input
                  value={query}
                  placeholder={t("search")}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void api.songs(query).then(setSongs);
                  }}
                />
              </label>
            </header>
            {message && <div className="message">{message}</div>}

            {view === "home" && (
              <HomeView
                songs={songs}
                albums={albums}
                artists={artists}
                playlists={playlists}
                heroSong={heroSong}
                current={current}
                playing={playing}
                t={t}
                onPlay={playSong}
                onPlayAlbum={playAlbum}
                onOpenAlbum={openAlbum}
                onPlayArtist={playArtist}
                onOpenArtist={openArtistById}
                onPlayPlaylist={playPlaylist}
                onOpenPlaylist={openPlaylist}
                onCreatePlaylist={createPlaylist}
              />
            )}

            {view === "library" && (
              <LibraryView
                songs={songs}
                current={current}
                t={t}
                onPlay={playSong}
                onFavorite={toggleFavorite}
                onAdd={addToPlaylist}
                onInsertNext={(items) => insertNextBatch(items)}
                onOpenArtist={(song) =>
                  void openArtistById(song.artist_id, song.artist)
                }
                onScan={() => void scan()}
                onUpload={upload}
                scanStatus={scanStatus}
              />
            )}
            {view === "collection" && collection && (
              <CollectionView
                collection={collection}
                current={current}
                t={t}
                onBack={() =>
                  setView(
                    collection.type === "playlist"
                      ? "playlists"
                      : collection.type === "album"
                        ? "albums"
                        : "artists",
                  )
                }
                onPlayAll={() =>
                  collection.songs[0] &&
                  void playSong(collection.songs[0], collection.songs)
                }
                onPlay={playSong}
                onFavorite={toggleFavorite}
                onAdd={addToPlaylist}
                onInsertNext={(items) => insertNextBatch(items)}
                onOpenArtist={(song) =>
                  void openArtistById(song.artist_id, song.artist)
                }
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
                  <button onClick={() => void createPlaylist()}>
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
                items={albums.map((a) => ({
                  id: a.id,
                  title: a.title,
                  subtitle: `${a.song_count} ${t("count")}`,
                  meta: a.artist,
                  theme: settings.theme,
                  onClick: () => void openAlbum(a),
                  onMetaClick: a.artist_id
                    ? () => void openArtistById(a.artist_id, a.artist)
                    : undefined,
                  onPlay: () => void playAlbum(a),
                }))}
              />
            )}
            {view === "artists" && (
              <CardGrid
                t={t}
                title={t("artists")}
                items={artists.map((a) => ({
                  id: a.id,
                  title: a.name,
                  subtitle: `${a.song_count} ${t("count")} · ${a.album_count} ${t("album")}`,
                  theme: settings.theme,
                  onClick: () => void openArtistById(a.id, a.name),
                  onPlay: () => void playArtist(a),
                }))}
              />
            )}
            {view === "settings" && (
              <SettingsPanel
                settings={settings}
                setSettings={(s) => void saveSettings(s)}
                user={auth.user}
                onLogout={() => void logout()}
                t={t}
              />
            )}
          </>
        )}
      </main>

      <footer className="player" style={playerStyle}>
        <PlayerMood theme={settings.theme} playing={playing} />
        <div className="now">
          <button
            className="cover-button"
            title={t("lyrics")}
            aria-label={t("lyrics")}
            onClick={() => setLyricsFullScreen((value) => !value)}
          >
            <MiniCover song={current} playing={playing} />
          </button>
          <div>
            <strong>{current?.title ?? t("nowPlaying")}</strong>
            <span>
              {current ? `${current.artist} · ${formatQuality(current)}` : "—"}
            </span>
          </div>
          <span className="now-pulse" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <button
            disabled={!current}
            onClick={() => current && void toggleFavorite(current)}
          >
            <Heart weight={current?.favorite ? "fill" : "regular"} />
          </button>
        </div>
        <div className="transport">
          <div className="transport-controls">
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
            <div className="playback-buttons">
              <button aria-label={t("previous")} onClick={() => next(-1)}>
                <SkipBack weight="fill" />
              </button>
              <button
                className="play"
                aria-label={playing ? t("pause") : t("play")}
                disabled={!current}
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
            disabled={!playableDuration}
            onChange={(e) => {
              if (audioRef.current) {
                const nextTime = Number(e.target.value);
                audioRef.current.currentTime = nextTime;
                setProgress(nextTime);
              }
            }}
          />
          <span>
            {formatDuration(progress)} / {formatDuration(playableDuration)}
          </span>
        </div>
        <div className="volume">
          <button
            className={queueOpen ? "queue-toggle active" : "queue-toggle"}
            title={t("queue")}
            aria-label={t("queue")}
            onClick={() => setQueueOpen((value) => !value)}
          >
            <ListBullets />
          </button>
          <SleepTimerControl
            value={sleepTimerMins}
            left={sleepLeft}
            onChange={setSleepTimerMins}
            t={t}
          />
          <SpeakerHigh />
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            defaultValue="0.85"
            onChange={(e) => {
              if (audioRef.current)
                audioRef.current.volume = Number(e.target.value);
            }}
          />
        </div>
        {queueOpen && (
          <div className="queue-layer">
            <button
              className="queue-scrim"
              aria-label={t("close")}
              onClick={() => setQueueOpen(false)}
            />
            <QueuePanel
              queue={queue}
              current={current}
              t={t}
              onPlay={(song) => void playSong(song, queue)}
              onClose={() => setQueueOpen(false)}
            />
          </div>
        )}
        <audio
          ref={audioRef}
          preload="metadata"
          src={
            current ? `/api/songs/${current.id}/stream?mode=auto` : undefined
          }
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration;
            setDuration(
              Number.isFinite(d) && d > 0 ? d : current?.duration_seconds || 0,
            );
          }}
          onDurationChange={(e) => {
            const d = e.currentTarget.duration;
            setDuration(
              Number.isFinite(d) && d > 0 ? d : current?.duration_seconds || 0,
            );
          }}
          onTimeUpdate={(e) => setProgress(e.currentTarget.currentTime)}
          onSeeking={(e) => setProgress(e.currentTarget.currentTime)}
          onEnded={() => next(1, true)}
        />
      </footer>
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
        {mode === "loading" ? (
          <div className="auth-loading" aria-label={title} />
        ) : (
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
        )}
      </div>
    </div>
  );
}

function HomeView({
  songs,
  albums,
  artists,
  playlists,
  heroSong,
  current,
  playing,
  t,
  onPlay,
  onPlayAlbum,
  onOpenAlbum,
  onPlayArtist,
  onOpenArtist,
  onPlayPlaylist,
  onOpenPlaylist,
  onCreatePlaylist,
}: {
  songs: Song[];
  albums: Album[];
  artists: Artist[];
  playlists: Playlist[];
  heroSong?: Song | null;
  current: Song | null;
  playing: boolean;
  t: ReturnType<typeof createT>;
  onPlay: (song: Song, list?: Song[]) => void;
  onPlayAlbum: (album: Album) => void;
  onOpenAlbum: (album: Album) => void;
  onPlayArtist: (artist: Artist) => void;
  onOpenArtist: (id: number, fallbackName?: string) => void;
  onPlayPlaylist: (playlist: Playlist) => void;
  onOpenPlaylist: (playlist: Playlist) => void;
  onCreatePlaylist: () => void;
}) {
  const latestSongs = songs.slice(0, 5);
  const featuredAlbums = albums.slice(0, 4);
  const featuredArtists = artists.slice(0, 4);
  const featuredPlaylists = playlists.slice(0, 3);
  return (
    <section className="home-view">
      <section className="hero">
        <Turntable
          song={heroSong}
          playing={playing && current?.id === heroSong?.id}
        />
        <div>
          <p>{t("jumpBackIn")}</p>
          <h1>{heroSong?.title ?? `${t("brand")} Music`}</h1>
          <h2>
            {heroSong ? `${heroSong.artist} · ${heroSong.album}` : t("noSongs")}
          </h2>
          <div className="hero-actions">
            <button
              className="primary"
              disabled={!heroSong}
              onClick={() => heroSong && onPlay(heroSong)}
            >
              <Play weight="fill" /> {t("play")}
            </button>
            {heroSong?.artist_id ? (
              <button
                onClick={() =>
                  onOpenArtist(heroSong.artist_id, heroSong.artist)
                }
              >
                <Record /> {t("artist")}
              </button>
            ) : null}
          </div>
        </div>
      </section>

      <div className="home-dashboard">
        <section className="summary-panel">
          <div className="section-head compact">
            <h2>{t("librarySummary")}</h2>
          </div>
          <div className="summary-stats">
            <button
              onClick={() => latestSongs[0] && onPlay(latestSongs[0], songs)}
            >
              <strong>{songs.length}</strong>
              <span>{t("count")}</span>
            </button>
            <button
              onClick={() =>
                featuredAlbums[0] && onOpenAlbum(featuredAlbums[0])
              }
            >
              <strong>{albums.length}</strong>
              <span>{t("albums")}</span>
            </button>
            <button
              onClick={() =>
                featuredArtists[0] &&
                onOpenArtist(featuredArtists[0].id, featuredArtists[0].name)
              }
            >
              <strong>{artists.length}</strong>
              <span>{t("artists")}</span>
            </button>
            <button
              onClick={() =>
                featuredPlaylists[0]
                  ? onOpenPlaylist(featuredPlaylists[0])
                  : onCreatePlaylist()
              }
            >
              <strong>{playlists.length}</strong>
              <span>{t("playlists")}</span>
            </button>
          </div>
          <p>{t("manageHint")}</p>
        </section>

        <section className="quick-panel">
          <div className="section-head compact">
            <h2>{t("latestSongs")}</h2>
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
                      onClick={() => onOpenAlbum(album)}
                    >
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
                      onClick={() => onOpenArtist(artist.id, artist.name)}
                    >
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

function Turntable({
  song,
  playing,
  decorative = false,
}: {
  song?: Song | null;
  playing: boolean;
  decorative?: boolean;
}) {
  const style = coverUrl(song)
    ? ({ "--cover-url": `url(${coverUrl(song)})` } as React.CSSProperties)
    : undefined;
  return (
    <div
      className={decorative ? "turntable decorative" : "turntable"}
      data-playing={playing ? "true" : "false"}
      style={style}
    >
      <div className="vinyl-disc">
        <Record weight="fill" />
      </div>
      <div className="tonearm">
        <span />
      </div>
      <div className="turntable-status">{playing ? "PLAY" : "PAUSE"}</div>
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
  const style = coverUrl(song)
    ? ({ "--cover-url": `url(${coverUrl(song)})` } as React.CSSProperties)
    : undefined;
  return (
    <div
      className="mini-art"
      data-playing={playing ? "true" : "false"}
      style={style}
    >
      <Record weight="fill" />
    </div>
  );
}

function PlayerMood({ theme, playing }: { theme: Theme; playing: boolean }) {
  const labels: Record<Theme, string> = {
    "deep-space": "HI-FI ORBIT",
    "amber-film": "VU TAPE",
    "neon-coral": "SPECTRUM",
    "arctic-aurora": "AURORA",
    "carbon-volt": "BPM 128",
    "milk-porcelain": "MINIMAL",
    "oat-latte": "WAVEFORM",
    "mint-soda": "FRESH",
    "sakura-washi": "WASHI",
    "dusk-amber": "19:42",
  };
  return (
    <div
      className="player-mood"
      data-theme-key={theme}
      data-playing={playing ? "true" : "false"}
      aria-hidden="true"
    >
      <span>{labels[theme]}</span>
      <div>
        {Array.from({ length: 16 }, (_, index) => (
          <i key={index} style={{ "--i": index } as React.CSSProperties} />
        ))}
      </div>
      <em>{theme === "carbon-volt" ? "74%" : "LIVE"}</em>
    </div>
  );
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
  onBack,
  onPlayAll,
  onPlay,
  onFavorite,
  onAdd,
  onInsertNext,
  onOpenArtist,
  onOpenCollectionArtist,
}: {
  collection: Collection;
  current: Song | null;
  t: ReturnType<typeof createT>;
  onBack: () => void;
  onPlayAll: () => void;
  onPlay: (song: Song, list: Song[]) => void;
  onFavorite: (song: Song) => void;
  onAdd: (song: Song) => void;
  onInsertNext: (songs: Song[]) => void;
  onOpenArtist: (song: Song) => void;
  onOpenCollectionArtist?: () => void;
}) {
  const label = collectionLabel(collection.type, t);
  return (
    <section className="collection-view">
      <button className="back-button" onClick={onBack}>
        ← {label}
      </button>
      <div className="collection-hero">
        <CollectionCover collection={collection} />
        <div>
          <p>{label}</p>
          <h1>{collection.title}</h1>
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
              disabled={!collection.songs.length}
              onClick={onPlayAll}
            >
              <Play weight="fill" /> {t("playAll")}
            </button>
            <button
              disabled={!collection.songs.length}
              onClick={() => onInsertNext(collection.songs)}
            >
              <SkipForward /> {t("insertNext")}
            </button>
          </div>
        </div>
      </div>
      <SongTable
        songs={collection.songs}
        current={current}
        t={t}
        onPlay={onPlay}
        onFavorite={onFavorite}
        onAdd={onAdd}
        onInsertNext={(song) => onInsertNext([song])}
        onOpenArtist={onOpenArtist}
      />
    </section>
  );
}

function CollectionCover({ collection }: { collection: Collection }) {
  const firstSong = collection.songs[0];
  const style = coverUrl(firstSong)
    ? ({ "--cover-url": `url(${coverUrl(firstSong)})` } as React.CSSProperties)
    : undefined;
  return (
    <div className="cover collection-cover" style={style}>
      <Record weight="fill" />
    </div>
  );
}

function LibraryView({
  songs,
  current,
  t,
  onPlay,
  onFavorite,
  onAdd,
  onInsertNext,
  onOpenArtist,
  onScan,
  onUpload,
  scanStatus,
}: {
  songs: Song[];
  current: Song | null;
  t: ReturnType<typeof createT>;
  onPlay: (song: Song, list: Song[]) => void;
  onFavorite: (song: Song) => void;
  onAdd: (song: Song) => void;
  onInsertNext: (songs: Song[]) => void;
  onOpenArtist: (song: Song) => void;
  onScan: () => void;
  onUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  scanStatus: ScanStatus | null;
}) {
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
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
          {selectedSongs.length ? (
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
      {songs.length ? (
        <SongTable
          songs={songs}
          current={current}
          t={t}
          onPlay={onPlay}
          onFavorite={onFavorite}
          onAdd={onAdd}
          onInsertNext={(song) => onInsertNext([song])}
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

function FullLyrics({
  song,
  lines,
  activeLyric,
  loading,
  t,
  scrollRef,
  onUserScroll,
}: {
  song: Song | null;
  lines: ReturnType<typeof parseLyricLines>;
  activeLyric: string;
  loading: boolean;
  t: ReturnType<typeof createT>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onUserScroll: () => void;
}) {
  return (
    <section className="full-lyrics">
      <Turntable song={song} playing={false} decorative />
      <div className="full-lyrics-head">
        <MiniCover song={song} playing={false} />
        <div>
          <p>{t("nowPlaying")}</p>
          <h1>{song?.title ?? `${t("brand")} Music`}</h1>
          <span>{song ? `${song.artist} · ${song.album}` : "—"}</span>
        </div>
      </div>
      <div
        className="full-lyrics-lines"
        ref={scrollRef}
        onWheel={onUserScroll}
        onTouchMove={onUserScroll}
      >
        {lines.length ? (
          lines.map((line) => (
            <p
              key={line.key}
              data-lyric-key={line.key}
              className={line.key === activeLyric ? "live" : ""}
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
      {value ? <span>{Math.ceil(left / 60)}</span> : null}
    </label>
  );
}

function SettingsPanel({
  settings,
  setSettings,
  user,
  onLogout,
  t,
}: {
  settings: Settings;
  setSettings: (settings: Settings) => void;
  user: User;
  onLogout: () => void;
  t: ReturnType<typeof createT>;
}) {
  const darkThemes = themes.slice(0, 5);
  const lightThemes = themes.slice(5);
  return (
    <section className="settings-grid">
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
      <label>
        {t("libraryPath")}
        <input readOnly value={settings.library_path} />
      </label>
      {user.role === "admin" ? (
        <label className="switch-row">
          <span>{settings.language === "zh-CN" ? "允许新用户注册" : "Allow registration"}</span>
          <input
            type="checkbox"
            checked={settings.registration_enabled}
            onChange={(e) =>
              setSettings({ ...settings, registration_enabled: e.target.checked })
            }
          />
        </label>
      ) : null}
      <div className="account-card">
        <div>
          <strong>{user.username}</strong>
          <span>{user.role === "admin" ? "Admin" : "User"}</span>
        </div>
        <button onClick={onLogout}>{settings.language === "zh-CN" ? "退出登录" : "Log out"}</button>
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
  onOpenArtist?: (song: Song) => void;
  selectedIds?: Set<number>;
  onToggleSelected?: (song: Song) => void;
}) {
  if (!songs.length) return <div className="empty">{t("noSongs")}</div>;
  return (
    <section className="song-table">
      {songs.map((song, index) => (
        <div
          key={song.id}
          className={current?.id === song.id ? "song-row active" : "song-row"}
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
            <span>{index + 1}</span>
          )}
          <button onClick={() => onPlay(song, songs)} aria-label={t("play")}>
            <Play weight="fill" />
          </button>
          <div>
            <strong>{song.title}</strong>
            {onOpenArtist && song.artist_id ? (
              <button
                className="artist-link"
                onClick={() => onOpenArtist(song)}
              >
                {song.artist}
              </button>
            ) : (
              <small>{song.artist}</small>
            )}
          </div>
          <div>{song.album}</div>
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
      ))}
    </section>
  );
}

function CardGrid({
  t,
  title,
  items,
  action,
}: {
  t: ReturnType<typeof createT>;
  title: string;
  items: {
    id: number;
    title: string;
    subtitle: string;
    meta?: string;
    theme: string;
    onClick: () => void;
    onMetaClick?: () => void;
    onPlay?: () => void;
  }[];
  action?: React.ReactNode;
}) {
  return (
    <section>
      <div className="section-head">
        <h2>{title}</h2>
        {action}
      </div>
      {items.length ? (
        <div className="cards">
          {items.map((item) => (
            <button
              className={`media-card ${item.theme}`}
              key={item.id}
              onClick={item.onClick}
            >
              <div className="cover">
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
          ))}
        </div>
      ) : (
        <div className="empty">{t("emptyCollection")}</div>
      )}
    </section>
  );
}
