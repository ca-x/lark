import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Disc,
  GearSix,
  Heart,
  MagnifyingGlass,
  MusicNotes,
  Pause,
  Play,
  Queue,
  SignOut,
  SkipBack,
  SkipForward,
  SpeakerHigh,
  TextAlignLeft,
  User,
} from "@phosphor-icons/react";
import { CassetteDeck } from "../../../frontend/src/components/player-themes/CassetteDeck";
import { VinylTurntable } from "../../../frontend/src/components/player-themes/VinylTurntable";
import { isMyGo, locale as mygoLocale, onLocaleChange } from "mygo-runtime";
import { messages } from "./locales";
import {
  Desktop,
  events,
  type Album,
  type Artist,
  type ConnectionStatus,
  type DeepLink,
  type Song,
} from "./mygo";

type Section = "songs" | "albums" | "artists" | "favorites";
type FavoriteSection = "songs" | "albums" | "artists";
type Detail =
  | { kind: "album"; item: Album }
  | { kind: "artist"; item: Artist }
  | null;
type Theme = "classic" | "vinyl" | "cassette";
type PlaybackEngine = { kind: "native" | "web"; songID: number };

const SONG_PAGE_SIZE = 80;
const GRID_PAGE_SIZE = 48;
const t = (key: keyof typeof messages) => messages[key]();

function mediaURL(
  kind: "song" | "song-cover" | "album-cover" | "artist-cover",
  id: number,
  version = 0,
) {
  const base =
    window.location.protocol === "http:"
      ? "http://larkmedia.localhost"
      : "larkmedia://localhost";
  return `${base}/${kind}/${id}${version ? `?v=${version}` : ""}`;
}

function duration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function Cover({
  kind,
  id,
  version = 0,
  className = "",
}: {
  kind: "song-cover" | "album-cover" | "artist-cover";
  id: number;
  version?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [kind, id, version]);
  return (
    <span className={`desktop-cover ${className}`}>
      {failed ? (
        <MusicNotes aria-hidden="true" />
      ) : (
        <img
          src={mediaURL(kind, id, version)}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}

function ConnectScreen({
  initialServer,
  initialError,
  hasSession,
  onConnected,
}: {
  initialServer: string;
  initialError?: string;
  hasSession: boolean;
  onConnected: (value: ConnectionStatus) => void;
}) {
  const [server, setServer] = useState(initialServer);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [allowInsecure, setAllowInsecure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError || "");
  useEffect(() => setServer(initialServer), [initialServer]);
  useEffect(() => setError(initialError || ""), [initialError]);
  async function retry() {
    setBusy(true);
    setError("");
    try {
      const value = await Desktop.status();
      if (value.connected) onConnected(value);
      else setError(value.error || t("connectionUnavailable"));
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const connected = await Desktop.connect(
        server,
        username,
        password,
        allowInsecure,
      );
      setPassword("");
      onConnected(connected);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="connect-page" data-busy={busy ? "true" : "false"}>
      <div className="connect-art" aria-hidden="true">
        <div className="connect-record">
          <div />
        </div>
        <span>{t("recordTagline")}</span>
      </div>
      <form className="connect-form" onSubmit={(event) => void submit(event)}>
        <div className="connect-logo">
          <MusicNotes weight="fill" /> {t("appName")}
        </div>
        <p className="eyebrow">{t("connectEyebrow")}</p>
        <h1>{t("connectTitle")}</h1>
        <p className="connect-intro">{t("connectIntro")}</p>
        <label>
          {t("serverAddress")}
          <input
            autoFocus
            required
            type="url"
            value={server}
            onChange={(event) => setServer(event.target.value)}
            placeholder="https://music.example.com"
            autoComplete="url"
          />
        </label>
        <div className="connect-credentials">
          <label>
            {t("username")}
            <input
              required
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
            />
          </label>
          <label>
            {t("password")}
            <input
              required
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
            />
          </label>
        </div>
        <label className="connect-checkbox">
          <input
            type="checkbox"
            checked={allowInsecure}
            onChange={(event) => setAllowInsecure(event.target.checked)}
          />
          {t("allowLocalHttp")}
        </label>
        {error ? (
          <p className="connect-error" role="alert">
            {error}
          </p>
        ) : null}
        {hasSession ? (
          <button
            type="button"
            className="connect-retry"
            disabled={busy}
            onClick={() => void retry()}
          >
            {t("retryConnection")}
          </button>
        ) : null}
        <button className="connect-submit" disabled={busy}>
          {busy ? t("connecting") : t("connectAction")} <ArrowRight />
        </button>
        <small>{t("sessionHint")}</small>
      </form>
    </main>
  );
}

export function App() {
  const [localeRevision, forceLocale] = useState(0);
  const [connection, setConnection] = useState<ConnectionStatus | null>(null);
  const [section, setSection] = useState<Section>("songs");
  const [favoriteSection, setFavoriteSection] =
    useState<FavoriteSection>("songs");
  const [detail, setDetail] = useState<Detail>(null);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [songs, setSongs] = useState<Song[]>([]);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [artists, setArtists] = useState<Artist[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [queue, setQueue] = useState<Song[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [engine, setEngine] = useState<PlaybackEngine | null>(null);
  const [progress, setProgress] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [theme, setTheme] = useState<Theme>("classic");
  const [lyrics, setLyrics] = useState("");
  const [showLyrics, setShowLyrics] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [closeBehavior, setCloseBehavior] = useState<"tray" | "quit">("tray");
  const [pendingLink, setPendingLink] = useState<DeepLink | null>(null);
  const [serverSwitch, setServerSwitch] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const progressSavedAt = useRef(0);
  const requestId = useRef(0);
  const current = queue[queueIndex] ?? null;
  const activeTab = section === "favorites" ? favoriteSection : section;
  const isFavorites = section === "favorites";

  useEffect(() => {
    document.documentElement.lang = isMyGo()
      ? mygoLocale()
      : navigator.language;
    if (!isMyGo()) return;
    return onLocaleChange((tag) => {
      document.documentElement.lang = tag;
      forceLocale((value) => value + 1);
    });
  }, []);

  useEffect(() => {
    document.title = t("appName");
  }, [localeRevision]);

  useEffect(() => {
    void Desktop.status()
      .then((value) => {
        setConnection(value);
        setTheme((value.theme as Theme) || "classic");
        setCloseBehavior(value.close_behavior === "quit" ? "quit" : "tray");
      })
      .catch((cause) =>
        setConnection({
          connected: false,
          has_session: false,
          server_url: "",
          error: errorText(cause),
          theme: "classic",
          close_behavior: "tray",
        }),
      );
    void Desktop.pendingLink()
      .then((link) => {
        if (link) setPendingLink(link);
      })
      .catch(() => {});
    return isMyGo() ? events.desktopOpenLink.on(setPendingLink) : undefined;
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!connection?.connected) return;
    const id = ++requestId.current;
    setLoading(true);
    setError("");
    const load = async () => {
      if (detail?.kind === "album") {
        const page = await Desktop.albumSongs(detail.item.id);
        return {
          songs: page.items,
          albums: [],
          artists: [],
          total: page.total,
        };
      }
      if (detail?.kind === "artist") {
        const [page, artistAlbums] = await Promise.all([
          Desktop.artistSongs(detail.item.id),
          Desktop.albums(false, detail.item.id, GRID_PAGE_SIZE, 0),
        ]);
        return {
          songs: page.items,
          albums: artistAlbums.items,
          artists: [],
          total: page.total,
        };
      }
      if (activeTab === "songs") {
        const page = await Desktop.songs(
          search,
          isFavorites,
          SONG_PAGE_SIZE,
          offset,
        );
        return {
          songs: page.items,
          albums: [],
          artists: [],
          total: page.total,
        };
      }
      if (activeTab === "albums") {
        const page = await Desktop.albums(
          isFavorites,
          0,
          GRID_PAGE_SIZE,
          offset,
        );
        return {
          songs: [],
          albums: page.items,
          artists: [],
          total: page.total,
        };
      }
      const page = await Desktop.artists(isFavorites, GRID_PAGE_SIZE, offset);
      return { songs: [], albums: [], artists: page.items, total: page.total };
    };
    void load()
      .then((data) => {
        if (id !== requestId.current) return;
        setSongs(data.songs);
        setAlbums(data.albums);
        setArtists(data.artists);
        setTotal(data.total);
      })
      .catch((cause) => {
        if (id === requestId.current) void reportError(cause);
      })
      .finally(() => {
        if (id === requestId.current) setLoading(false);
      });
  }, [connection?.connected, activeTab, isFavorites, search, offset, detail]);

  useEffect(() => {
    if (!connection?.connected || !current || !audioRef.current) return;
    const audio = audioRef.current;
    const song = current;
    let cancelled = false;
    setEngine(null);
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    setProgress(0);
    progressSavedAt.current = 0;
    void Desktop.markPlayed(song.id).catch(() => {});
    void (async () => {
      await Desktop.nativeStop();
      if (cancelled) return;
      const supported = ["mp3", "wav", "wave", "ogg", "oga", "vorbis"].includes(
        song.format.toLowerCase(),
      );
      if (supported) {
        try {
          await Desktop.startNative(song.id, volume);
          if (cancelled) return;
          setEngine({ kind: "native", songID: song.id });
          return;
        } catch {
          /* Keep FLAC, CUE and unsupported streams on the WebView path. */
        }
      }
      if (cancelled) return;
      audio.src = mediaURL("song", song.id);
      audio.load();
      setEngine({ kind: "web", songID: song.id });
    })().catch((cause) => {
      if (!cancelled) setError(errorText(cause));
    });
    return () => {
      cancelled = true;
    };
  }, [current?.id, connection?.connected]);

  useEffect(() => {
    if (connection?.connected) return;
    audioRef.current?.pause();
    void Desktop.nativeStop();
    setPlaying(false);
  }, [connection?.connected]);

  useEffect(() => {
    if (!current || engine?.songID !== current.id) return;
    if (engine.kind === "native") {
      void (playing ? Desktop.nativePlay() : Desktop.nativePause()).catch(
        (cause) => void reportError(cause),
      );
    } else {
      const audio = audioRef.current;
      if (!audio) return;
      if (playing)
        void audio.play().catch((cause) => {
          setPlaying(false);
          setError(errorText(cause));
        });
      else audio.pause();
    }
  }, [playing, current?.id, engine]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
    if (engine?.kind === "native")
      void Desktop.nativeVolume(volume).catch(() => {});
  }, [volume, engine?.kind]);

  useEffect(() => {
    if (!current?.has_lyrics) {
      setLyrics("");
      return;
    }
    void Desktop.lyrics(current.id)
      .then(setLyrics)
      .catch(() => setLyrics(""));
  }, [current?.id, current?.has_lyrics]);

  useEffect(() => {
    if (!navigator.mediaSession || !current) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: current.title,
      artist: current.artist,
      album: current.album,
      artwork: [
        {
          src: mediaURL("song-cover", current.id, current.cover_version),
          sizes: "512x512",
        },
      ],
    });
    navigator.mediaSession.playbackState = playing ? "playing" : "paused";
  }, [current?.id, playing]);

  const playSong = useCallback((song: Song, list: Song[]) => {
    setQueue(list);
    setQueueIndex(
      Math.max(
        0,
        list.findIndex((item) => item.id === song.id),
      ),
    );
    setPlaying(true);
  }, []);

  const next = useCallback(
    (direction: number) => {
      if (!queue.length) return;
      setQueueIndex(
        (index) => (index + direction + queue.length) % queue.length,
      );
      setPlaying(true);
    },
    [queue],
  );

  useEffect(() => {
    if (!current || engine?.kind !== "native" || engine.songID !== current.id)
      return;
    let checking = false;
    const timer = window.setInterval(() => {
      if (checking) return;
      checking = true;
      void Desktop.nativeStatus()
        .then((state) => {
          if (state.song_id !== current.id) return;
          setProgress(state.position_seconds);
          if (
            playing &&
            !state.playing &&
            state.duration_seconds > 0 &&
            state.position_seconds >= state.duration_seconds - 0.4
          )
            next(1);
          if (
            playing &&
            state.position_seconds - progressSavedAt.current >= 15
          ) {
            progressSavedAt.current = state.position_seconds;
            void Desktop.saveProgress(
              current.id,
              state.position_seconds,
              state.duration_seconds,
              false,
            ).catch(() => {});
          }
        })
        .catch(() => {})
        .finally(() => {
          checking = false;
        });
    }, 400);
    return () => window.clearInterval(timer);
  }, [current?.id, engine, playing, next]);

  useEffect(() => {
    if (!isMyGo()) return;
    return events.desktopTrayCommand.on(({ action }) => {
      if (action === "toggle") setPlaying((value) => !value);
      if (action === "previous") next(-1);
      if (action === "next") next(1);
    });
  }, [next]);

  useEffect(() => {
    if (!navigator.mediaSession) return;
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ["play", () => setPlaying(true)],
      ["pause", () => setPlaying(false)],
      ["previoustrack", () => next(-1)],
      ["nexttrack", () => next(1)],
      [
        "seekto",
        (details) => {
          if (details.seekTime != null) seek(details.seekTime);
        },
      ],
    ];
    for (const [name, handler] of handlers) {
      try {
        navigator.mediaSession.setActionHandler(name, handler);
      } catch {
        /* Platform does not offer this action. */
      }
    }
    return () => {
      for (const [name] of handlers)
        try {
          navigator.mediaSession.setActionHandler(name, null);
        } catch {
          /* Platform does not offer this action. */
        }
    };
  }, [next]);

  const openLink = useCallback(
    async (link: DeepLink) => {
      if (!connection?.connected) return;
      if (
        link.server &&
        new URL(link.server).origin !== new URL(connection.server_url).origin
      ) {
        setServerSwitch(link.server);
        return;
      }
      if (link.kind === "song") {
        const song = await Desktop.song(link.id);
        playSong(song, [song]);
      } else if (link.kind === "album") {
        const album = await Desktop.album(link.id);
        setDetail({ kind: "album", item: album });
        setSection("albums");
      }
      setPendingLink(null);
    },
    [connection, playSong],
  );

  useEffect(() => {
    if (pendingLink && connection?.connected)
      void openLink(pendingLink).catch((cause) => void reportError(cause));
  }, [pendingLink, connection?.connected, openLink]);

  useEffect(() => {
    if (!serverSwitch) return;
    const button = document.querySelector<HTMLButtonElement>(
      ".server-switch-dialog button",
    );
    button?.focus();
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setServerSwitch(null);
        setPendingLink(null);
      }
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [serverSwitch]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (
        event.code === "Space" &&
        !(event.target instanceof HTMLInputElement) &&
        !(event.target instanceof HTMLTextAreaElement) &&
        !(event.target instanceof HTMLButtonElement)
      ) {
        event.preventDefault();
        setPlaying((value) => !value);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  function switchSection(nextSection: Section) {
    setSection(nextSection);
    setDetail(null);
    setOffset(0);
    setQuery("");
  }

  async function reportError(cause: unknown) {
    const message = errorText(cause);
    if (/Unauthenticated|session expired/i.test(message)) {
      try {
        const status = await Desktop.status();
        if (!status.connected) {
          setConnection(status);
          return;
        }
      } catch {
        /* Show the original request failure below. */
      }
    }
    setError(message);
  }

  async function toggleFavorite(
    kind: "song" | "album" | "artist",
    id: number,
    favorite: boolean,
  ) {
    let nextValue: boolean;
    try {
      nextValue = await Desktop.favorite(kind, id, !favorite);
    } catch (cause) {
      await reportError(cause);
      return;
    }
    if (kind === "song") {
      setSongs((items) =>
        items.map((item) =>
          item.id === id ? { ...item, favorite: nextValue } : item,
        ),
      );
      setQueue((items) =>
        items.map((item) =>
          item.id === id ? { ...item, favorite: nextValue } : item,
        ),
      );
    }
    if (kind === "album") {
      setAlbums((items) =>
        items.map((item) =>
          item.id === id ? { ...item, favorite: nextValue } : item,
        ),
      );
      setDetail((value) =>
        value?.kind === "album" && value.item.id === id
          ? { ...value, item: { ...value.item, favorite: nextValue } }
          : value,
      );
    }
    if (kind === "artist") {
      setArtists((items) =>
        items.map((item) =>
          item.id === id ? { ...item, favorite: nextValue } : item,
        ),
      );
      setDetail((value) =>
        value?.kind === "artist" && value.item.id === id
          ? { ...value, item: { ...value.item, favorite: nextValue } }
          : value,
      );
    }
  }

  function seek(seconds: number) {
    if (engine?.kind === "native")
      void Desktop.nativeSeek(seconds).catch(
        (cause) => void reportError(cause),
      );
    else if (audioRef.current) audioRef.current.currentTime = seconds;
    setProgress(seconds);
  }

  function saveProgress(completed: boolean) {
    if (!current) return;
    void Desktop.saveProgress(
      current.id,
      engine?.kind === "native" ? progress : audioRef.current?.currentTime || 0,
      audioRef.current &&
        engine?.kind === "web" &&
        Number.isFinite(audioRef.current.duration)
        ? audioRef.current.duration
        : current.duration_seconds,
      completed,
    ).catch(() => {});
  }

  if (!connection)
    return (
      <div className="boot-screen">
        {t("appName")} <span>{t("openingLibrary")}</span>
      </div>
    );
  if (!connection.connected)
    return (
      <ConnectScreen
        initialServer={connection.server_url}
        initialError={connection.error}
        hasSession={connection.has_session}
        onConnected={(value) => {
          setConnection(value);
          setTheme((value.theme as Theme) || "classic");
          setCloseBehavior(value.close_behavior === "quit" ? "quit" : "tray");
        }}
      />
    );

  const list = songs;
  return (
    <div className="desktop-shell">
      <aside className="desktop-sidebar">
        <div className="desktop-brand">
          <span className="brand-symbol">
            <MusicNotes weight="fill" />
          </span>
          <span>
            {t("appName")} <small>DESKTOP</small>
          </span>
        </div>
        <div className="nav-group-label">{t("myMusic")}</div>
        <nav aria-label={t("myMusic")}>
          <button
            className={section === "songs" ? "active" : ""}
            onClick={() => switchSection("songs")}
          >
            <MusicNotes /> {t("library")}
          </button>
          <button
            className={section === "albums" ? "active" : ""}
            onClick={() => switchSection("albums")}
          >
            <Disc /> {t("albums")}
          </button>
          <button
            className={section === "artists" ? "active" : ""}
            onClick={() => switchSection("artists")}
          >
            <User /> {t("artists")}
          </button>
          <button
            className={section === "favorites" ? "active" : ""}
            onClick={() => switchSection("favorites")}
          >
            <Heart /> {t("favorites")}
          </button>
        </nav>
        <div className="sidebar-bottom">
          <span className="server-name" title={connection.server_url}>
            {new URL(connection.server_url).host}
          </span>
          <button
            title={t("settings")}
            aria-label={t("settings")}
            onClick={() => setShowSettings(true)}
          >
            <GearSix />
          </button>
          <button
            title={t("signOut")}
            aria-label={t("signOut")}
            onClick={() => {
              void Desktop.disconnect()
                .then(() => {
                  setPlaying(false);
                  setConnection({
                    connected: false,
                    has_session: false,
                    server_url: connection.server_url,
                    theme,
                    close_behavior: closeBehavior,
                  });
                })
                .catch((cause) => void reportError(cause));
            }}
          >
            <SignOut />
          </button>
        </div>
      </aside>

      <div className="desktop-content">
        <header className="desktop-topbar">
          <div className="location-path">
            {t("library")} <span>/</span>{" "}
            {detail
              ? detail.kind === "album"
                ? detail.item.title
                : detail.item.name
              : section === "songs"
                ? t("allSongs")
                : section === "albums"
                  ? t("albums")
                  : section === "artists"
                    ? t("artists")
                    : t("favorites")}
          </div>
          <div className="topbar-actions">
            <label className="desktop-search">
              <MagnifyingGlass />
              <input
                ref={searchRef}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSection("songs");
                  setDetail(null);
                  setOffset(0);
                }}
                placeholder={t("searchSongs")}
                aria-label={t("searchSongs")}
              />
              <kbd>⌘ K</kbd>
            </label>
            <span className="user-avatar">
              {(
                connection.user?.nickname ||
                connection.user?.username ||
                "L"
              ).slice(0, 1)}
            </span>
          </div>
        </header>

        <main className="library-main">
          {detail ? (
            <button className="back-button" onClick={() => setDetail(null)}>
              <ArrowLeft />{" "}
              {detail.kind === "album" ? t("backToAlbums") : t("backToArtists")}
            </button>
          ) : null}
          {detail?.kind === "album" ? (
            <div className="detail-hero">
              <Cover
                kind="album-cover"
                id={detail.item.id}
                version={detail.item.cover_version}
                className="detail-cover"
              />
              <div>
                <span className="eyebrow">
                  {t("album").toUpperCase()} ·{" "}
                  {detail.item.year || t("unknownYear")}
                </span>
                <h1>{detail.item.title}</h1>
                <p>
                  {detail.item.artist} · {detail.item.song_count}{" "}
                  {t("songCountUnit")}
                </p>
                <div className="hero-actions">
                  <button
                    className="primary-action"
                    onClick={() => songs[0] && playSong(songs[0], songs)}
                  >
                    <Play weight="fill" /> {t("playAll")}
                  </button>
                  <button
                    aria-label={
                      detail.item.favorite
                        ? t("unfavorite")
                        : t("favoriteAlbum")
                    }
                    onClick={() =>
                      void toggleFavorite(
                        "album",
                        detail.item.id,
                        detail.item.favorite,
                      )
                    }
                  >
                    <Heart weight={detail.item.favorite ? "fill" : "regular"} />{" "}
                    {detail.item.favorite ? t("saved") : t("favorite")}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
          {detail?.kind === "artist" ? (
            <div className="detail-hero artist-hero">
              <Cover
                kind="artist-cover"
                id={detail.item.id}
                className="detail-cover"
              />
              <div>
                <span className="eyebrow">{t("artists").toUpperCase()}</span>
                <h1>{detail.item.name}</h1>
                <p>
                  {detail.item.album_count} {t("albumCountUnit")} ·{" "}
                  {detail.item.song_count} {t("songCountUnit")}
                </p>
                <div className="hero-actions">
                  <button
                    className="primary-action"
                    onClick={() => songs[0] && playSong(songs[0], songs)}
                  >
                    <Play weight="fill" /> {t("playArtist")}
                  </button>
                  <button
                    aria-label={
                      detail.item.favorite
                        ? t("unfavorite")
                        : t("favoriteArtist")
                    }
                    onClick={() =>
                      void toggleFavorite(
                        "artist",
                        detail.item.id,
                        detail.item.favorite,
                      )
                    }
                  >
                    <Heart weight={detail.item.favorite ? "fill" : "regular"} />{" "}
                    {detail.item.favorite ? t("saved") : t("favorite")}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
          {!detail ? (
            <div className="page-heading">
              <div>
                <span className="eyebrow">{t("collectionEyebrow")}</span>
                <h1>
                  {section === "songs"
                    ? t("library")
                    : section === "albums"
                      ? t("albums")
                      : section === "artists"
                        ? t("artists")
                        : t("favorites")}
                </h1>
                <p>
                  {section === "songs"
                    ? t("songsIntro")
                    : section === "albums"
                      ? t("albumsIntro")
                      : section === "artists"
                        ? t("artistsIntro")
                        : t("favoritesIntro")}
                </p>
              </div>
              <span className="item-count">
                {total.toLocaleString()}{" "}
                {activeTab === "songs"
                  ? t("songCountUnit")
                  : activeTab === "albums"
                    ? t("albumCountUnit")
                    : t("artistCountUnit")}
              </span>
            </div>
          ) : null}
          {section === "favorites" && !detail ? (
            <div className="favorite-tabs">
              {(["songs", "albums", "artists"] as const).map((name) => (
                <button
                  key={name}
                  className={favoriteSection === name ? "active" : ""}
                  onClick={() => {
                    setFavoriteSection(name);
                    setOffset(0);
                  }}
                >
                  {name === "songs"
                    ? t("songs")
                    : name === "albums"
                      ? t("albums")
                      : t("artists")}
                </button>
              ))}
            </div>
          ) : null}
          {detail?.kind === "artist" && albums.length ? (
            <>
              <h2 className="subheading">{t("albums")}</h2>
              <div className="album-grid compact-grid">
                {albums.map((album) => (
                  <AlbumCard
                    key={album.id}
                    album={album}
                    onOpen={() => setDetail({ kind: "album", item: album })}
                    onFavorite={() =>
                      void toggleFavorite("album", album.id, album.favorite)
                    }
                  />
                ))}
              </div>
              <h2 className="subheading">{t("songs")}</h2>
            </>
          ) : null}
          {error ? (
            <div className="error-panel" role="alert">
              {error}
              <button onClick={() => setError("")}>{t("close")}</button>
            </div>
          ) : null}
          {loading ? (
            <div className="loading-state">{t("loadingRecords")}</div>
          ) : null}
          {!loading && (activeTab === "songs" || !!detail) ? (
            <div className="song-list">
              <div className="song-list-head">
                <span>#</span>
                <span>{t("songs")}</span>
                <span>{t("album")}</span>
                <span>{t("duration")}</span>
                <span>{t("actions")}</span>
              </div>
              {list.map((song, index) => (
                <div
                  className={
                    current?.id === song.id ? "song-line active" : "song-line"
                  }
                  key={song.id}
                >
                  <span className="song-number">
                    {current?.id === song.id && playing
                      ? "♫"
                      : offset + index + 1}
                  </span>
                  <div className="song-name">
                    <Cover
                      kind="song-cover"
                      id={song.id}
                      version={song.cover_version}
                    />
                    <div>
                      <button
                        onClick={() => playSong(song, list)}
                        title={song.title}
                      >
                        {song.title}
                      </button>
                      <small>{song.artist}</small>
                    </div>
                  </div>
                  <button
                    className="song-album-link"
                    onClick={() => {
                      if (song.album_id)
                        void Desktop.album(song.album_id)
                          .then((album) =>
                            setDetail({ kind: "album", item: album }),
                          )
                          .catch((cause) => void reportError(cause));
                    }}
                  >
                    {song.album}
                  </button>
                  <span className="song-time">
                    {duration(song.duration_seconds)}
                  </span>
                  <div className="song-actions">
                    <button
                      title={t("play")}
                      aria-label={`${t("play")} ${song.title}`}
                      onClick={() => playSong(song, list)}
                    >
                      <Play weight="fill" />
                    </button>
                    <button
                      title={song.favorite ? t("unfavorite") : t("favorite")}
                      aria-label={
                        song.favorite ? t("unfavorite") : t("favorite")
                      }
                      onClick={() =>
                        void toggleFavorite("song", song.id, song.favorite)
                      }
                    >
                      <Heart weight={song.favorite ? "fill" : "regular"} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          {!loading && !detail && activeTab === "albums" ? (
            <div className="album-grid">
              {albums.map((album) => (
                <AlbumCard
                  key={album.id}
                  album={album}
                  onOpen={() => setDetail({ kind: "album", item: album })}
                  onFavorite={() =>
                    void toggleFavorite("album", album.id, album.favorite)
                  }
                />
              ))}
            </div>
          ) : null}
          {!loading && !detail && activeTab === "artists" ? (
            <div className="artist-grid">
              {artists.map((artist) => (
                <article className="artist-card" key={artist.id}>
                  <button
                    onClick={() => setDetail({ kind: "artist", item: artist })}
                  >
                    <Cover kind="artist-cover" id={artist.id} />
                    <strong>{artist.name}</strong>
                    <small>
                      {artist.album_count} {t("albumCountUnit")} ·{" "}
                      {artist.song_count} {t("songCountUnit")}
                    </small>
                  </button>
                  <button
                    className="card-favorite"
                    aria-label={
                      artist.favorite ? t("unfavorite") : t("favoriteArtist")
                    }
                    onClick={() =>
                      void toggleFavorite("artist", artist.id, artist.favorite)
                    }
                  >
                    <Heart weight={artist.favorite ? "fill" : "regular"} />
                  </button>
                </article>
              ))}
            </div>
          ) : null}
          {!loading &&
          !detail &&
          !songs.length &&
          !albums.length &&
          !artists.length &&
          !error ? (
            <div className="empty-state">{t("emptyLibrary")}</div>
          ) : null}
          {!detail &&
          total > (activeTab === "songs" ? SONG_PAGE_SIZE : GRID_PAGE_SIZE) ? (
            <div className="page-controls">
              <button
                disabled={offset === 0}
                onClick={() =>
                  setOffset(
                    Math.max(
                      0,
                      offset -
                        (activeTab === "songs"
                          ? SONG_PAGE_SIZE
                          : GRID_PAGE_SIZE),
                    ),
                  )
                }
              >
                <ArrowLeft /> {t("previousPage")}
              </button>
              <span>
                {Math.floor(
                  offset /
                    (activeTab === "songs" ? SONG_PAGE_SIZE : GRID_PAGE_SIZE),
                ) + 1}{" "}
                /{" "}
                {Math.ceil(
                  total /
                    (activeTab === "songs" ? SONG_PAGE_SIZE : GRID_PAGE_SIZE),
                )}
              </span>
              <button
                disabled={
                  offset +
                    (activeTab === "songs" ? SONG_PAGE_SIZE : GRID_PAGE_SIZE) >=
                  total
                }
                onClick={() =>
                  setOffset(
                    offset +
                      (activeTab === "songs" ? SONG_PAGE_SIZE : GRID_PAGE_SIZE),
                  )
                }
              >
                {t("nextPage")} <ArrowRight />
              </button>
            </div>
          ) : null}
        </main>
      </div>

      {serverSwitch ? (
        <div className="server-switch-layer" role="presentation">
          <div
            className="server-switch-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t("switchServer")}
          >
            <strong>{t("linkServerMismatch")}</strong>
            <code>{serverSwitch}</code>
            <div>
              <button
                onClick={() => {
                  setServerSwitch(null);
                  setPendingLink(null);
                }}
              >
                {t("cancel")}
              </button>
              <button
                className="primary-action"
                onClick={() => {
                  setConnection({
                    connected: false,
                    has_session: false,
                    server_url: serverSwitch,
                    theme,
                    close_behavior: closeBehavior,
                  });
                  setServerSwitch(null);
                }}
              >
                {t("switchServer")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {showLyrics ? (
        <aside className="lyrics-drawer">
          <div>
            <strong>{t("lyrics")}</strong>
            <button onClick={() => setShowLyrics(false)}>{t("close")}</button>
          </div>
          <p>
            {lyrics ? lyrics.replace(/\[[^\]]+\]/g, "").trim() : t("noLyrics")}
          </p>
        </aside>
      ) : null}
      {showSettings ? (
        <aside className="settings-drawer">
          <div>
            <strong>{t("desktopSettings")}</strong>
            <button onClick={() => setShowSettings(false)}>{t("close")}</button>
          </div>
          <label>
            {t("closeBehavior")}
            <select
              value={closeBehavior}
              onChange={(event) => {
                const value = event.target.value as "tray" | "quit";
                void Desktop.setCloseBehavior(value)
                  .then(() => setCloseBehavior(value))
                  .catch((cause) => setError(errorText(cause)));
              }}
            >
              <option value="tray">{t("closeToTray")}</option>
              <option value="quit">{t("quitApp")}</option>
            </select>
          </label>
          <p>{t("noTrayHint")}</p>
          <label>
            {t("playerTheme")}
            <select
              value={theme}
              onChange={(event) => {
                const value = event.target.value as Theme;
                setTheme(value);
                void Desktop.setTheme(value).catch(
                  (cause) => void reportError(cause),
                );
              }}
            >
              <option value="classic">{t("classic")}</option>
              <option value="vinyl">{t("vinyl")}</option>
              <option value="cassette">{t("cassette")}</option>
            </select>
          </label>
        </aside>
      ) : null}
      {showQueue ? (
        <aside className="queue-drawer">
          <div>
            <strong>{t("queue")}</strong>
            <button onClick={() => setShowQueue(false)}>{t("close")}</button>
          </div>
          {queue.map((song, index) => (
            <button
              key={`${song.id}-${index}`}
              className={index === queueIndex ? "active" : ""}
              onClick={() => {
                setQueueIndex(index);
                setPlaying(true);
              }}
            >
              <span>{index + 1}</span>
              <strong>{song.title}</strong>
              <small>{song.artist}</small>
            </button>
          ))}
        </aside>
      ) : null}
      {current && theme !== "classic" ? (
        <aside className="theme-overlay">
          <button
            className="theme-close"
            onClick={() => {
              setTheme("classic");
              void Desktop.setTheme("classic").catch(
                (cause) => void reportError(cause),
              );
            }}
          >
            {t("hideTheme")}
          </button>
          {theme === "vinyl" ? (
            <VinylTurntable
              cover={mediaURL("song-cover", current.id, current.cover_version)}
              playing={playing}
              progress={progress}
              duration={current.duration_seconds}
              title={current.title}
              artist={current.artist}
              volume={volume}
              onToggle={() => setPlaying((value) => !value)}
              onPrevious={() => next(-1)}
              onNext={() => next(1)}
              onSeek={seek}
              onVolume={setVolume}
            />
          ) : (
            <CassetteDeck
              cover={mediaURL("song-cover", current.id, current.cover_version)}
              playing={playing}
              progress={progress}
              duration={current.duration_seconds}
              title={current.title}
              artist={current.artist}
              onToggle={() => setPlaying((value) => !value)}
              onPrevious={() => next(-1)}
              onNext={() => next(1)}
              onSeek={seek}
            />
          )}
        </aside>
      ) : null}
      <footer className="player-dock">
        <div className="now-playing">
          {current ? (
            <>
              <Cover
                kind="song-cover"
                id={current.id}
                version={current.cover_version}
              />
              <div>
                <strong>{current.title}</strong>
                <span>
                  {engine?.songID === current.id
                    ? current.artist
                    : t("buffering")}
                </span>
              </div>
              <button
                aria-label={current.favorite ? t("unfavorite") : t("favorite")}
                onClick={() =>
                  void toggleFavorite("song", current.id, current.favorite)
                }
              >
                <Heart weight={current.favorite ? "fill" : "regular"} />
              </button>
            </>
          ) : (
            <>
              <span className="empty-disc">
                <Disc />
              </span>
              <div>
                <strong>{t("readyToPlay")}</strong>
                <span>{t("chooseSong")}</span>
              </div>
            </>
          )}
        </div>
        <div className="player-center">
          <div className="transport">
            <button
              aria-label={t("previous")}
              disabled={!current}
              onClick={() => next(-1)}
            >
              <SkipBack weight="fill" />
            </button>
            <button
              className="play-toggle"
              aria-label={playing ? t("pause") : t("play")}
              disabled={!current}
              onClick={() => setPlaying((value) => !value)}
            >
              {playing ? <Pause weight="fill" /> : <Play weight="fill" />}
            </button>
            <button
              aria-label={t("next")}
              disabled={!current}
              onClick={() => next(1)}
            >
              <SkipForward weight="fill" />
            </button>
          </div>
          <div className="timeline">
            <span>{duration(progress)}</span>
            <input
              aria-label={t("playbackProgress")}
              type="range"
              min="0"
              max={current?.duration_seconds || 1}
              value={Math.min(progress, current?.duration_seconds || 1)}
              disabled={!current}
              onChange={(event) => seek(Number(event.target.value))}
            />
            <span>{duration(current?.duration_seconds || 0)}</span>
          </div>
        </div>
        <div className="player-extras">
          <button
            title={t("lyrics")}
            aria-label={t("lyrics")}
            onClick={() => setShowLyrics((value) => !value)}
          >
            <TextAlignLeft />
          </button>
          <button
            title={t("queue")}
            aria-label={t("queue")}
            onClick={() => setShowQueue((value) => !value)}
          >
            <Queue />
          </button>
          <SpeakerHigh />
          <input
            aria-label={t("volume")}
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volume}
            onChange={(event) => setVolume(Number(event.target.value))}
          />
          <select
            aria-label={t("playerTheme")}
            value={theme}
            onChange={(event) => {
              const value = event.target.value as Theme;
              setTheme(value);
              void Desktop.setTheme(value).catch(
                (cause) => void reportError(cause),
              );
            }}
          >
            <option value="classic">{t("classic")}</option>
            <option value="vinyl">{t("vinyl")}</option>
            <option value="cassette">{t("cassette")}</option>
          </select>
        </div>
      </footer>
      <audio
        ref={audioRef}
        preload="metadata"
        onTimeUpdate={(event) => {
          if (engine?.kind !== "web" || engine.songID !== current?.id) return;
          const seconds = event.currentTarget.currentTime;
          setProgress(seconds);
          if (current && seconds - progressSavedAt.current >= 15) {
            progressSavedAt.current = seconds;
            saveProgress(false);
          }
        }}
        onEnded={() => {
          if (engine?.kind !== "web") return;
          saveProgress(true);
          next(1);
        }}
        onPause={() => {
          if (engine?.kind === "web" && engine.songID === current?.id)
            saveProgress(false);
        }}
        onError={() => {
          if (engine?.kind === "web") setError(t("mediaError"));
        }}
      />
    </div>
  );
}

function AlbumCard({
  album,
  onOpen,
  onFavorite,
}: {
  album: Album;
  onOpen: () => void;
  onFavorite: () => void;
}) {
  return (
    <article className="album-card">
      <button className="album-open" onClick={onOpen}>
        <Cover kind="album-cover" id={album.id} version={album.cover_version} />
        <strong title={album.title}>{album.title}</strong>
        <span>
          {album.artist} · {album.year || "—"}
        </span>
      </button>
      <button
        className="card-favorite"
        title={album.favorite ? t("unfavorite") : t("favorite")}
        aria-label={album.favorite ? t("unfavorite") : t("favoriteAlbum")}
        onClick={onFavorite}
      >
        <Heart weight={album.favorite ? "fill" : "regular"} />
      </button>
    </article>
  );
}
