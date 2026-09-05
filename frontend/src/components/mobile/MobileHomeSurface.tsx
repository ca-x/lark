import { useState } from "react";
import { ArrowRight, CaretRight, Disc, MicrophoneStage, MusicNotes, Pause, Play, Playlist as PlaylistIcon, Radio, Waveform } from "@phosphor-icons/react";
import type { createT } from "../../i18n";
import type { Album, Artist, LibraryStats, MobileHomePlayerStyle, Playlist, Song } from "../../types";

function ListeningCover({ src, kind = "album" }: { src?: string; kind?: "album" | "artist" | "playlist" }) {
  const [failedSrc, setFailedSrc] = useState("");
  return <span className={`listening-cover listening-cover-${kind}`}>
    {src && src !== failedSrc
      ? <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailedSrc(src)} />
      : kind === "artist" ? <MicrophoneStage /> : kind === "playlist" ? <PlaylistIcon /> : <MusicNotes />}
  </span>;
}

export function MobileHomeSurface({
  displaySong, canResumeDisplaySong, externalNowPlaying, current, playing,
  recentSongs, recentAddedSongs, recommendedSongs, albums, artists, playlists,
  stats, loading, t, onPlay, onResume, onTogglePlayback, onOpenLibrary,
  onOpenAlbums, onOpenArtists, onOpenPlaylists, onOpenRadio, onOpenAlbum, onOpenArtist, onOpenPlaylist,
}: {
  theme: MobileHomePlayerStyle;
  displaySong?: Song | null;
  canResumeDisplaySong: boolean;
  externalNowPlaying?: { title: string; artist: string; album: string; cover?: string } | null;
  current: Song | null;
  playing: boolean;
  recentSongs: Song[];
  recentAddedSongs: Song[];
  recommendedSongs: Song[];
  albums: Album[];
  artists: Artist[];
  playlists: Playlist[];
  stats?: LibraryStats | null;
  loading?: boolean;
  t: ReturnType<typeof createT>;
  onPlay: (song: Song, list?: Song[]) => void;
  onResume: (song: Song) => void;
  onTogglePlayback: () => void;
  onOpenLibrary: () => void;
  onOpenAlbums: () => void;
  onOpenArtists: () => void;
  onOpenPlaylists: () => void;
  onOpenRadio: () => void;
  onOpenAlbum: (album: Album) => void;
  onOpenArtist: (id: number, fallbackName?: string) => void;
  onOpenPlaylist: (playlist: Playlist) => void;
}) {
  const [recentTab, setRecentTab] = useState<"played" | "added">("played");
  const recent = recentTab === "played" ? recentSongs : recentAddedSongs;
  const daily = recommendedSongs.length ? recommendedSongs : recentAddedSongs;
  const resumable = Boolean(current || externalNowPlaying || (canResumeDisplaySong && displaySong));
  const hasMusic = Boolean(displaySong || externalNowPlaying || daily.length || recentAddedSongs.length || albums.length);
  const resumeTitle = externalNowPlaying?.title || displaySong?.title;
  return <div className="listening-home">
    {loading ? <div className="listening-skeleton listening-daily" aria-label={t("loading")} /> : hasMusic && daily[0] ? (
      <button className="listening-daily" type="button" onClick={() => onPlay(daily[0], daily)} aria-label={`${t("playAll")}: ${t("dailyRecommendedSongs")}`}>
        <span className="listening-daily-copy">
          <span className="listening-daily-label"><Waveform /> {t("mobileFromYourLibrary")}</span>
          <strong>{t("dailyRecommendedSongs")}</strong>
          <small>{t("mobileDailyHint")}</small>
          <span className="listening-daily-play"><Play weight="fill" /> {t("listenNow")}</span>
        </span>
        <span className="listening-daily-art" aria-hidden="true">
          {daily.slice(0, 3).reverse().map(song => <ListeningCover key={song.id} src={`/api/songs/${song.id}/cover`} />)}
        </span>
      </button>
    ) : !loading && !hasMusic ? (
      <section className="listening-empty">
        <MusicNotes size={40} /><h2>{t("emptyCollection")}</h2><p>{t("mobileEmptyHint")}</p>
        <button type="button" onClick={onOpenLibrary}>{t("library")} <ArrowRight /></button>
      </section>
    ) : null}

    {resumable && resumeTitle ? <button type="button" className="listening-resume" onClick={current || externalNowPlaying ? onTogglePlayback : () => displaySong && onResume(displaySong)}>
      <ListeningCover src={externalNowPlaying?.cover || (displaySong ? `/api/songs/${displaySong.id}/cover` : undefined)} />
      <span><small>{current || externalNowPlaying ? t("nowPlaying") : t("mobileContinueListening")}</small><strong>{resumeTitle}</strong></span>
      {playing && (current || externalNowPlaying) ? <Pause weight="fill" /> : <Play weight="fill" />}
    </button> : null}

    <nav className="listening-shortcuts" aria-label={t("mobileLibraryHub")}>
      {[
        { label: t("albums"), icon: <Disc />, action: onOpenAlbums },
        { label: t("artists"), icon: <MicrophoneStage />, action: onOpenArtists },
        { label: t("playlists"), icon: <PlaylistIcon />, action: onOpenPlaylists },
        { label: t("onlineRadio"), icon: <Radio />, action: onOpenRadio },
      ].map(item => <button type="button" key={item.label} onClick={item.action}>{item.icon}<span>{item.label}</span></button>)}
    </nav>

    {albums.length > 0 ? <section className="listening-section">
      <div className="listening-section-head"><h2>{t("mobileAlbumShelf")}</h2><button type="button" onClick={onOpenAlbums} aria-label={`${t("viewAll")} · ${t("albums")}`}>{t("viewAll")}<CaretRight /></button></div>
      <div className="listening-shelf">
        {albums.slice(0, 8).map(album => <button type="button" key={album.id} className="listening-album" onClick={() => onOpenAlbum(album)}>
          <ListeningCover src={`/api/albums/${album.id}/cover`} /><strong>{album.title}</strong><small>{album.artist}</small>
        </button>)}
      </div>
    </section> : null}

    {recentSongs.length || recentAddedSongs.length || loading ? <section className="listening-section">
      <div className="listening-section-head listening-recent-head">
        <div className="listening-tabs" role="group" aria-label={t("mobileRecentMusic")}>
          <button type="button" aria-pressed={recentTab === "played"} onClick={() => setRecentTab("played")}>{t("mobileRecentlyPlayed")}</button>
          <button type="button" aria-pressed={recentTab === "added"} onClick={() => setRecentTab("added")}>{t("recentAdded")}</button>
        </div>
        <button type="button" disabled={!recent.length} aria-label={`${t("playAll")} · ${recentTab === "played" ? t("mobileRecentlyPlayed") : t("recentAdded")}`} onClick={() => recent[0] && onPlay(recent[0], recent)}><Play weight="fill" /></button>
      </div>
      <div className="listening-tracks">
        {loading ? Array.from({ length: 3 }, (_, i) => <div className="listening-skeleton" key={i} />) : recent.length ? recent.slice(0, 5).map(song => (
          <button type="button" className={current?.id === song.id ? "active" : ""} key={song.id} onClick={() => current?.id === song.id ? onTogglePlayback() : onPlay(song, recent)} aria-label={`${current?.id === song.id && playing ? t("pause") : t("play")}: ${song.title}`}>
            <ListeningCover src={`/api/songs/${song.id}/cover`} /><span><strong>{song.title}</strong><small>{song.artist} · {song.album}</small></span>
            {current?.id === song.id && playing ? <Waveform /> : <Play />}
          </button>
        )) : <p className="listening-empty-inline">{t("mobileNoRecentPlays")}</p>}
      </div>
    </section> : null}

    {artists.length > 0 ? <section className="listening-section">
      <div className="listening-section-head"><h2>{t("artists")}</h2><button type="button" onClick={onOpenArtists} aria-label={`${t("viewAll")} · ${t("artists")}`}>{t("viewAll")}<CaretRight /></button></div>
      <div className="listening-shelf listening-artist-shelf">{artists.slice(0, 8).map(artist => <button type="button" className="listening-album" key={artist.id} onClick={() => onOpenArtist(artist.id, artist.name)}>
        <ListeningCover src={`/api/artists/${artist.id}/cover`} kind="artist" /><strong>{artist.name}</strong><small>{artist.album_count} {t("album")}</small>
      </button>)}</div>
    </section> : null}

    {playlists.length > 0 ? <section className="listening-section">
      <div className="listening-section-head"><h2>{t("playlists")}</h2><button type="button" onClick={onOpenPlaylists} aria-label={`${t("viewAll")} · ${t("playlists")}`}>{t("viewAll")}<CaretRight /></button></div>
      <div className="listening-playlists">{playlists.slice(0, 4).map(playlist => <button type="button" key={playlist.id} onClick={() => onOpenPlaylist(playlist)}><ListeningCover kind="playlist" /><span><strong>{playlist.name}</strong><small>{playlist.song_count} {t("count")}</small></span><CaretRight /></button>)}</div>
    </section> : null}
    {stats && hasMusic ? <p className="listening-library-note">{t("localLibrary")} · {stats.songs} {t("count")} · {stats.albums} {t("album")}</p> : null}
  </div>;
}
