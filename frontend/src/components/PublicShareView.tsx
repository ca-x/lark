import { useEffect, useRef, useState } from "react";

import { LoadingStage } from "./LoadingStage";
import { CassetteDeck, VinylTurntable } from "./player-themes";
import { api } from "../services/api";
import type { PublicShare, Settings, Song } from "../types";
import type { createT } from "../i18n";

type PublicSharePlayerStyle = "vinyl" | "cassette";

const PUBLIC_SHARE_PLAYER_STYLE_KEY = "lark:public-share-player-style";

function storedPublicSharePlayerStyle(): PublicSharePlayerStyle {
  try {
    return window.localStorage.getItem(PUBLIC_SHARE_PLAYER_STYLE_KEY) === "cassette" ? "cassette" : "vinyl";
  } catch {
    return "vinyl";
  }
}

function rememberPublicSharePlayerStyle(style: PublicSharePlayerStyle) {
  try {
    window.localStorage.setItem(PUBLIC_SHARE_PLAYER_STYLE_KEY, style);
  } catch {
    // localStorage can be unavailable in private/webview modes.
  }
}

export function PublicShareView({
  token,
  settings,
  t,
}: {
  token: string;
  settings: Settings;
  t: ReturnType<typeof createT>;
}) {
  const [share, setShare] = useState<PublicShare | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [error, setError] = useState("");
  const [playerStyle, setPlayerStyle] = useState<PublicSharePlayerStyle>(storedPublicSharePlayerStyle);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.85);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const autoplayAfterSwitchRef = useRef(false);
  const currentSong = share?.songs[currentIndex] ?? share?.songs[0] ?? null;
  const encodedToken = encodeURIComponent(token);

  useEffect(() => {
    setShare(null);
    setCurrentIndex(0);
    setError("");
    setPlaying(false);
    setProgress(0);
    setDuration(0);
    void api
      .publicShare(token)
      .then(setShare)
      .catch((err) => setError(friendlyPublicShareError(err, t)));
  }, [token, t]);

  useEffect(() => {
    rememberPublicSharePlayerStyle(playerStyle);
  }, [playerStyle]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentSong) return;
    audio.volume = volume;
    audio.load();
    setProgress(0);
    setDuration(currentSong.duration_seconds || 0);
    if (!autoplayAfterSwitchRef.current) return;
    autoplayAfterSwitchRef.current = false;
    window.requestAnimationFrame(() => void playAudio());
  }, [currentSong?.id]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  function playAudio() {
    const audio = audioRef.current;
    if (!audio) return Promise.resolve();
    return audio.play().catch(() => setPlaying(false));
  }

  const togglePlayback = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
      return;
    }
    void playAudio();
  };

  const switchSong = (index: number, shouldAutoplay = playing) => {
    if (!share?.songs[index]) return;
    autoplayAfterSwitchRef.current = shouldAutoplay;
    setCurrentIndex(index);
  };

  const previous = currentIndex > 0 ? () => switchSong(currentIndex - 1, true) : undefined;
  const next = share && currentIndex < share.songs.length - 1 ? () => switchSong(currentIndex + 1, true) : undefined;
  const seek = (seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const nextProgress = Math.max(0, Math.min(duration || seconds, seconds));
    audio.currentTime = nextProgress;
    setProgress(nextProgress);
  };

  const cover = currentSong ? `/api/public/shares/${encodedToken}/cover/${currentSong.id}` : undefined;
  const stream = currentSong ? `/api/public/shares/${encodedToken}/stream/${currentSong.id}` : undefined;

  return (
    <div className="auth-shell public-share-shell" data-theme={settings.theme}>
      <main className="public-share-card">
        <div className="brand public-share-brand">
          <img src="/logo.png" alt={t("brand")} /> <span>{t("brand")}</span>
        </div>
        {error ? (
          <div className="settings-empty error public-share-error">{error}</div>
        ) : !share ? (
          <LoadingStage t={t} />
        ) : currentSong ? (
          <>
            <div className="public-share-kicker-row">
              <p>{t("publicShare")}</p>
              <div className="public-share-theme-toggle" role="group" aria-label={t("publicShareTheme")}>
                <button
                  type="button"
                  className={playerStyle === "vinyl" ? "active" : ""}
                  onClick={() => setPlayerStyle("vinyl")}
                  title={t("homePlayerVinyl")}
                  aria-label={t("homePlayerVinyl")}
                >
                  {t("homePlayerVinyl")}
                </button>
                <button
                  type="button"
                  className={playerStyle === "cassette" ? "active" : ""}
                  onClick={() => setPlayerStyle("cassette")}
                  title={t("homePlayerCassette")}
                  aria-label={t("homePlayerCassette")}
                >
                  {t("homePlayerCassette")}
                </button>
              </div>
            </div>
            <section className="public-share-hero">
              <div className="public-share-deck">
                {playerStyle === "cassette" ? (
                  <CassetteDeck
                    cover={cover}
                    playing={playing}
                    progress={progress}
                    duration={duration || currentSong.duration_seconds || 0}
                    title={currentSong.title}
                    artist={currentSong.artist || share.share.title}
                    onToggle={togglePlayback}
                    onPrevious={previous}
                    onNext={next}
                    onSeek={seek}
                  />
                ) : (
                  <VinylTurntable
                    cover={cover}
                    playing={playing}
                    progress={progress}
                    duration={duration || currentSong.duration_seconds || 0}
                    title={currentSong.title}
                    artist={currentSong.artist || share.share.title}
                    volume={volume}
                    onVolume={setVolume}
                    onToggle={togglePlayback}
                    onPrevious={previous}
                    onNext={next}
                    onSeek={seek}
                  />
                )}
              </div>
              <div className="public-share-info">
                <span>{t("nowPlaying")}</span>
                <h1>{share.share.title}</h1>
                <strong>{currentSong.title}</strong>
                <em>{[currentSong.artist, currentSong.album].filter(Boolean).join(" · ") || t("songs")}</em>
                <audio
                  ref={audioRef}
                  src={stream}
                  preload="metadata"
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onTimeUpdate={(event) => setProgress(event.currentTarget.currentTime)}
                  onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || currentSong.duration_seconds || 0)}
                  onEnded={() => {
                    if (next) next();
                    else setPlaying(false);
                  }}
                />
              </div>
            </section>
            {share.songs.length > 1 ? (
              <PublicShareSongList
                songs={share.songs}
                currentSong={currentSong}
                t={t}
                onSelect={(index) => switchSong(index)}
              />
            ) : null}
          </>
        ) : (
          <div className="settings-empty">{t("emptyCollection")}</div>
        )}
      </main>
    </div>
  );
}

function PublicShareSongList({
  songs,
  currentSong,
  onSelect,
  t,
}: {
  songs: Song[];
  currentSong: Song;
  onSelect: (index: number) => void;
  t: ReturnType<typeof createT>;
}) {
  return (
    <section className="public-share-list" aria-label={t("publicShareList")}>
      <div className="public-share-list-head" aria-hidden="true">
        <span>#</span>
        <span>{t("songs")}</span>
        <span>{t("artist")}</span>
        <span>{t("album")}</span>
        <span />
      </div>
      {songs.map((song, index) => (
        <button
          key={song.id}
          type="button"
          className={song.id === currentSong.id ? "active" : ""}
          aria-current={song.id === currentSong.id ? "true" : undefined}
          onClick={() => onSelect(index)}
        >
          <span>{index + 1}</span>
          <strong>{song.title}</strong>
          <span>{song.artist || "—"}</span>
          <span>{song.album || "—"}</span>
          <em>{formatDuration(song.duration_seconds)}</em>
        </button>
      ))}
    </section>
  );
}

function friendlyPublicShareError(error: unknown, t: ReturnType<typeof createT>) {
  const message = error instanceof Error ? error.message : String(error || "");
  const normalized = message.toLowerCase();
  if (normalized.includes("forbidden") || normalized.includes("not found") || normalized.includes("404")) {
    return t("publicShareUnavailable");
  }
  return message || t("publicShareUnavailable");
}

function formatDuration(seconds: number) {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}
