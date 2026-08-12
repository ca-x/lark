import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { ArrowRight, Disc, MicrophoneStage, MusicNotes, Pause, Play, Playlist as PlaylistIcon, Record } from "@phosphor-icons/react";

import type { createT } from "../../i18n";
import type { Album, Artist, LibraryStats, MobileHomePlayerStyle, Playlist, Song } from "../../types";

function coverUrl(song?: Song | null) {
  return song ? `/api/songs/${song.id}/cover` : undefined;
}

function albumCoverUrl(album?: Album | null) {
  return album ? `/api/albums/${album.id}/cover` : undefined;
}

function artistCoverUrl(artist?: Artist | null) {
  return artist ? `/api/artists/${artist.id}/cover` : undefined;
}

function MobileSongCover({
  song,
  cover,
  title,
  artist,
  playing,
}: {
  song?: Song | null;
  cover?: string;
  title?: string;
  artist?: string;
  playing: boolean;
}) {
  const url = cover || coverUrl(song);
  const [failedUrl, setFailedUrl] = useState("");
  useEffect(() => {
    if (url !== failedUrl) setFailedUrl("");
  }, [failedUrl, url]);
  const displayUrl = url && url !== failedUrl ? url : "";
  const fallbackLabel = coverFallbackLabel(title || song?.title, artist || song?.artist);
  const style = displayUrl ? ({ "--cover-url": `url(${displayUrl})` } as CSSProperties) : undefined;
  return (
    <div
      className="mini-art"
      data-playing={playing ? "true" : "false"}
      data-has-cover={displayUrl ? "true" : "false"}
      data-fallback-label={fallbackLabel}
      style={style}
    >
      {displayUrl ? (
        <img src={displayUrl} alt="" loading="eager" decoding="async" onError={() => setFailedUrl(displayUrl)} />
      ) : (
        <Record weight="fill" />
      )}
    </div>
  );
}

function coverFallbackLabel(title?: string, artist?: string) {
  const raw = `${artist || ""} ${title || ""}`.trim() || title || artist || "L";
  const parts = raw
    .split(/[\s._\-·/]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const chars = (parts.length >= 2 ? [parts[0][0], parts[1][0]] : Array.from(raw).slice(0, 2))
    .join("")
    .toUpperCase();
  return chars || "L";
}

function MobileCollectionCover({
  src,
  fallback,
}: {
  src?: string;
  fallback: "album" | "artist" | "playlist" | "radio";
}) {
  const [failedSrc, setFailedSrc] = useState("");
  useEffect(() => {
    if (src !== failedSrc) setFailedSrc("");
  }, [failedSrc, src]);
  const displaySrc = src && src !== failedSrc ? src : "";
  const style = displaySrc ? ({ "--cover-url": `url(${displaySrc})` } as CSSProperties) : undefined;
  return (
    <span className="mobile-collection-cover" data-has-cover={displaySrc ? "true" : "false"} data-kind={fallback} style={style}>
      {displaySrc ? <img src={displaySrc} alt="" loading="lazy" decoding="async" onError={() => setFailedSrc(displaySrc)} /> : null}
      {fallback === "artist" ? <MicrophoneStage weight="fill" /> : fallback === "playlist" ? <PlaylistIcon weight="fill" /> : fallback === "radio" ? <MusicNotes weight="fill" /> : <Disc weight="fill" />}
    </span>
  );
}

export function MobileHomeSurface({
  theme,
  displaySong,
  canResumeDisplaySong,
  externalNowPlaying,
  current,
  playing,
  recentSongs,
  recentAddedSongs,
  recommendedSongs,
  albums,
  artists,
  playlists,
  stats,
  loading,
  t,
  onPlay,
  onResume,
  onTogglePlayback,
  onOpenLibrary,
  onOpenAlbums,
  onOpenArtists,
  onOpenPlaylists,
  onOpenRadio,
  onOpenAlbum,
  onOpenArtist,
  onOpenPlaylist,
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
  const heroActive = Boolean(current || externalNowPlaying);
  const heroPlaying = playing && heroActive;
  const highlightSong = recentAddedSongs[0] ?? recommendedSongs[0] ?? displaySong ?? null;
  const highlightQueue = recentAddedSongs.length ? recentAddedSongs : recommendedSongs.length ? recommendedSongs : highlightSong ? [highlightSong] : [];
  const highlightLabel = recentAddedSongs.length ? t("recentAdded") : t("mobileForYou");
  const featuredAlbum = albums[0];
  const featuredArtist = artists[0];
  const featuredPlaylist = playlists[0];
  const hasSongs = Boolean(externalNowPlaying || displaySong || recentSongs.length || recommendedSongs.length);
  const displayCover = externalNowPlaying?.cover || coverUrl(displaySong);
  const heroTitle = externalNowPlaying?.title || displaySong?.title;
  const heroArtist = externalNowPlaying?.artist || displaySong?.artist;
  const heroAlbum = externalNowPlaying?.album || displaySong?.album;
  const surfaceStyle = displayCover
    ? ({ "--mobile-home-cover": `url("${displayCover.replace(/"/g, "%22")}")` } as CSSProperties)
    : undefined;

  return (
    <section className="mobile-home-surface" data-mobile-theme={theme} style={surfaceStyle}>
      <section className="mobile-home-now" data-has-cover={displayCover ? "true" : "false"}>
        <div>
          <span>{heroActive ? t("nowPlaying") : hasSongs ? t("recentAdded") : t("mobileForYou")}</span>
          <strong>{heroTitle ?? t("brand")}</strong>
          <small>{heroTitle ? [heroArtist, heroAlbum].filter(Boolean).join(" · ") : t("noSongs")}</small>
        </div>
        <button
          type="button"
          aria-label={heroTitle ? (heroPlaying ? t("pause") : t("play")) : t("library")}
          onClick={heroActive ? onTogglePlayback : canResumeDisplaySong && displaySong ? () => onResume(displaySong) : displaySong ? () => onPlay(displaySong, recentSongs.length ? recentSongs : recommendedSongs) : onOpenLibrary}
        >
          <MobileSongCover song={displaySong} cover={externalNowPlaying?.cover} title={heroTitle} artist={heroArtist} playing={heroPlaying} />
          {heroTitle ? (heroPlaying ? <Pause weight="fill" /> : <Play weight="fill" />) : <ArrowRight weight="bold" />}
        </button>
      </section>

      {!loading && !hasSongs ? (
        <section className="mobile-home-empty" aria-labelledby="mobile-home-empty-title">
          <span aria-hidden="true"><MusicNotes weight="fill" /></span>
          <div>
            <strong id="mobile-home-empty-title">{t("noSongs")}</strong>
            <small>{t("scanHint")}</small>
          </div>
          <button type="button" onClick={onOpenLibrary}>
            {t("library")} <ArrowRight weight="bold" />
          </button>
        </section>
      ) : null}

      <div className="mobile-home-highlight">
        <div>
          <span>{highlightLabel}</span>
          <strong>{highlightSong?.title ?? t("noSongs")}</strong>
          <small>{highlightSong ? `${highlightSong.artist} · ${highlightSong.album}` : t("emptyCollection")}</small>
        </div>
        <button
          type="button"
          disabled={!highlightSong}
          aria-label={highlightSong ? `${t("play")}: ${highlightSong.title}` : t("play")}
          onClick={() => highlightSong && onPlay(highlightSong, highlightQueue)}
        >
          <MobileSongCover song={highlightSong} playing={Boolean(highlightSong && playing && highlightSong.id === current?.id)} />
          <Play weight="fill" />
        </button>
      </div>

      <section className="mobile-home-browse" aria-labelledby="mobile-home-browse-title">
        <div className="mobile-home-section-head">
          <h2 id="mobile-home-browse-title">{t("mobileLibraryHub")}</h2>
        </div>
        <div className="mobile-home-library-hub">
          <button type="button" onClick={onOpenAlbums}>
            <MobileCollectionCover src={albumCoverUrl(featuredAlbum)} fallback="album" />
            <span>
              <strong>{t("albums")}</strong>
              <small>{stats ? stats.albums : albums.length} {t("album")}</small>
            </span>
          </button>
          <button type="button" onClick={onOpenArtists}>
            <MobileCollectionCover src={artistCoverUrl(featuredArtist)} fallback="artist" />
            <span>
              <strong>{t("artists")}</strong>
              <small>{stats ? stats.artists : artists.length} {t("artists")}</small>
            </span>
          </button>
          <button type="button" onClick={onOpenPlaylists}>
            <MobileCollectionCover fallback="playlist" />
            <span>
              <strong>{t("playlists")}</strong>
              <small>{stats ? stats.playlists : playlists.length} {t("playlists")}</small>
            </span>
          </button>
          <button type="button" onClick={onOpenRadio}>
            <MobileCollectionCover fallback="radio" />
            <span>
              <strong>{t("onlineRadio")}</strong>
              <small>{t("liveRadio")}</small>
            </span>
          </button>
        </div>
      </section>

      <div className="mobile-home-featured">
        {featuredAlbum ? (
          <button type="button" onClick={() => onOpenAlbum(featuredAlbum)}>
            <MobileCollectionCover src={albumCoverUrl(featuredAlbum)} fallback="album" />
            <span>
              <small>{t("mobileAlbumPick")}</small>
              <strong>{featuredAlbum.title}</strong>
              <em>{featuredAlbum.artist}</em>
            </span>
          </button>
        ) : null}
        {featuredArtist ? (
          <button type="button" onClick={() => onOpenArtist(featuredArtist.id, featuredArtist.name)}>
            <MobileCollectionCover src={artistCoverUrl(featuredArtist)} fallback="artist" />
            <span>
              <small>{t("mobileArtistPick")}</small>
              <strong>{featuredArtist.name}</strong>
              <em>{featuredArtist.song_count} {t("count")}</em>
            </span>
          </button>
        ) : null}
        {featuredPlaylist ? (
          <button type="button" onClick={() => onOpenPlaylist(featuredPlaylist)}>
            <MobileCollectionCover fallback="playlist" />
            <span>
              <small>{t("mobilePlaylistPick")}</small>
              <strong>{featuredPlaylist.name}</strong>
              <em>{featuredPlaylist.song_count} {t("count")}</em>
            </span>
          </button>
        ) : null}
      </div>

      {albums.length > 1 ? (
        <div className="mobile-home-carousel">
          <div className="mobile-home-section-head">
            <h2>{t("albums")}</h2>
            <button type="button" onClick={onOpenAlbums}>
              {t("viewAll")}
            </button>
          </div>
          <div className="mobile-home-carousel-strip">
            {albums.slice(0, 8).map((album) => (
              <button key={album.id} type="button" onClick={() => onOpenAlbum(album)}>
                <MobileCollectionCover src={albumCoverUrl(album)} fallback="album" />
                <strong>{album.title}</strong>
                <small>{album.artist}</small>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {playlists.length > 1 ? (
        <div className="mobile-home-carousel">
          <div className="mobile-home-section-head">
            <h2>{t("playlists")}</h2>
            <button type="button" onClick={onOpenPlaylists}>
              {t("viewAll")}
            </button>
          </div>
          <div className="mobile-home-carousel-strip">
            {playlists.slice(0, 8).map((playlist) => (
              <button key={playlist.id} type="button" onClick={() => onOpenPlaylist(playlist)}>
                <MobileCollectionCover fallback="playlist" />
                <strong>{playlist.name}</strong>
                <small>{playlist.song_count} {t("count")}</small>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {loading || recentSongs.length ? <div className="mobile-home-quickplay">
        <div className="mobile-home-section-head">
          <h2>{t("mobileForYou")}</h2>
          {recentSongs[0] ? (
            <button type="button" onClick={() => onPlay(recentSongs[0], recentSongs)}>
              <Play weight="fill" /> {t("playAll")}
            </button>
          ) : null}
        </div>
        <div className="mobile-home-song-strip">
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="mobile-home-skeleton" style={{ height: 152, minWidth: 140 }} />
            ))
          ) : recentSongs.length ? (
            recentSongs.map((song) => (
              <button key={song.id} type="button" className={song.id === current?.id ? "active" : ""} onClick={() => onPlay(song, recentSongs)}>
                <MobileSongCover song={song} playing={playing && song.id === current?.id} />
                <span>
                  <strong>{song.title}</strong>
                  <small>{song.artist}</small>
                </span>
              </button>
            ))
          ) : null}
        </div>
      </div> : null}

      {loading || recommendedSongs.length ? <div className="mobile-home-library">
        <div className="mobile-home-section-head">
          <h2>{t("dailyRecommendedSongs")}</h2>
        </div>
        <div className="mobile-home-list">
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="mobile-home-skeleton" style={{ height: 56 }} />
            ))
          ) : recommendedSongs.length ? (
            recommendedSongs.slice(0, 6).map((song) => (
              <button key={song.id} type="button" className={song.id === current?.id ? "active" : ""} onClick={() => onPlay(song, recommendedSongs)}>
                <MobileSongCover song={song} playing={playing && song.id === current?.id} />
                <span>
                  <strong>{song.title}</strong>
                  <small>{song.artist} · {song.album}</small>
                </span>
                <Play weight="fill" />
              </button>
            ))
          ) : null}
        </div>
      </div> : null}
    </section>
  );
}
