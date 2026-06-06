import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { Disc, MicrophoneStage, MusicNotes, Pause, Play, Playlist as PlaylistIcon, Record } from "@phosphor-icons/react";

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

function MobileSongCover({ song, playing }: { song?: Song | null; playing: boolean }) {
  const url = coverUrl(song);
  const [failedUrl, setFailedUrl] = useState("");
  useEffect(() => {
    if (url !== failedUrl) setFailedUrl("");
  }, [failedUrl, url]);
  const displayUrl = url && url !== failedUrl ? url : "";
  const style = displayUrl ? ({ "--cover-url": `url(${displayUrl})` } as CSSProperties) : undefined;
  return (
    <div className="mini-art" data-playing={playing ? "true" : "false"} data-has-cover={displayUrl ? "true" : "false"} style={style}>
      {displayUrl ? (
        <img src={displayUrl} alt="" loading="eager" decoding="async" onError={() => setFailedUrl(displayUrl)} />
      ) : (
        <Record weight="fill" />
      )}
    </div>
  );
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
  onOpenAlbums: () => void;
  onOpenArtists: () => void;
  onOpenPlaylists: () => void;
  onOpenRadio: () => void;
  onOpenAlbum: (album: Album) => void;
  onOpenArtist: (id: number, fallbackName?: string) => void;
  onOpenPlaylist: (playlist: Playlist) => void;
}) {
  const heroActive = Boolean(current);
  const heroPlaying = playing && heroActive;
  const canResumeDisplaySong = !heroActive && Boolean(displaySong);
  const highlightSong = recentAddedSongs[0] ?? recommendedSongs[0] ?? displaySong ?? null;
  const highlightQueue = recentAddedSongs.length ? recentAddedSongs : recommendedSongs.length ? recommendedSongs : highlightSong ? [highlightSong] : [];
  const highlightLabel = recentAddedSongs.length ? t("recentAdded") : t("mobileForYou");
  const featuredAlbum = albums[0];
  const featuredArtist = artists[0];
  const featuredPlaylist = playlists[0];

  return (
    <section className="mobile-home-surface" data-mobile-theme={theme}>
      <section className="mobile-home-now">
        <div>
          <span>{t("nowPlaying")}</span>
          <strong>{displaySong?.title ?? t("brand")}</strong>
          <small>{displaySong ? `${displaySong.artist} · ${displaySong.album}` : t("emptyCollection")}</small>
        </div>
        <button
          type="button"
          disabled={!displaySong}
          aria-label={heroPlaying ? t("pause") : t("play")}
          onClick={heroActive ? onTogglePlayback : canResumeDisplaySong && displaySong ? () => onResume(displaySong) : undefined}
        >
          <MobileSongCover song={displaySong} playing={heroPlaying} />
          {heroPlaying ? <Pause weight="fill" /> : <Play weight="fill" />}
        </button>
      </section>

      <div className="mobile-home-highlight">
        <div>
          <span>{highlightLabel}</span>
          <strong>{highlightSong?.title ?? t("noSongs")}</strong>
          <small>{highlightSong ? `${highlightSong.artist} · ${highlightSong.album}` : t("emptyCollection")}</small>
        </div>
        <button
          type="button"
          disabled={!highlightSong}
          onClick={() => highlightSong && onPlay(highlightSong, highlightQueue)}
        >
          <MobileSongCover song={highlightSong} playing={Boolean(highlightSong && playing && highlightSong.id === current?.id)} />
          <Play weight="fill" />
        </button>
      </div>

      <div className="mobile-home-library-hub" aria-label={t("mobileLibraryHub")}>
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

      <div className="mobile-home-quickplay">
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
          ) : (
            <div className="empty mini-empty">{t("noSongs")}</div>
          )}
        </div>
      </div>

      <div className="mobile-home-library">
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
          ) : (
            <div className="empty mini-empty">{t("noSongs")}</div>
          )}
        </div>
      </div>
    </section>
  );
}
