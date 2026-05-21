import type { CSSProperties } from "react";
import { Disc, MicrophoneStage, Play, Playlist as PlaylistIcon, Record } from "@phosphor-icons/react";

import type { createT } from "../../i18n";
import type { Album, Artist, LibraryStats, MobileHomePlayerStyle, Playlist, Song } from "../../types";
import { MobileArtPlayer, type PlayerThemePlayMode } from "../player-themes";

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
  const style = url ? ({ "--cover-url": `url(${url})` } as CSSProperties) : undefined;
  return (
    <div className="mini-art" data-playing={playing ? "true" : "false"} data-has-cover={url ? "true" : "false"} style={style}>
      {!url ? <Record weight="fill" /> : null}
    </div>
  );
}

function MobileCollectionCover({
  src,
  fallback,
}: {
  src?: string;
  fallback: "album" | "artist" | "playlist";
}) {
  const style = src ? ({ "--cover-url": `url(${src})` } as CSSProperties) : undefined;
  return (
    <span className="mobile-collection-cover" data-has-cover={src ? "true" : "false"} data-kind={fallback} style={style}>
      {fallback === "artist" ? <MicrophoneStage weight="fill" /> : fallback === "playlist" ? <PlaylistIcon weight="fill" /> : <Disc weight="fill" />}
    </span>
  );
}

export function MobileHomeSurface({
  theme,
  displaySong,
  current,
  playing,
  progress,
  duration,
  playMode,
  playModeLabel,
  recentSongs,
  newSongs,
  recommendedSongs,
  albums,
  artists,
  playlists,
  stats,
  t,
  onPlay,
  onResume,
  onTogglePlayback,
  onPrevious,
  onNext,
  onCyclePlayMode,
  onSeek,
  onOpenAlbums,
  onOpenArtists,
  onOpenPlaylists,
  onOpenAlbum,
  onOpenArtist,
  onOpenPlaylist,
}: {
  theme: MobileHomePlayerStyle;
  displaySong?: Song | null;
  current: Song | null;
  playing: boolean;
  progress: number;
  duration: number;
  playMode: PlayerThemePlayMode;
  playModeLabel: string;
  recentSongs: Song[];
  newSongs: Song[];
  recommendedSongs: Song[];
  albums: Album[];
  artists: Artist[];
  playlists: Playlist[];
  stats?: LibraryStats | null;
  t: ReturnType<typeof createT>;
  onPlay: (song: Song, list?: Song[]) => void;
  onResume: (song: Song) => void;
  onTogglePlayback: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onCyclePlayMode: () => void;
  onSeek: (seconds: number) => void;
  onOpenAlbums: () => void;
  onOpenArtists: () => void;
  onOpenPlaylists: () => void;
  onOpenAlbum: (album: Album) => void;
  onOpenArtist: (id: number, fallbackName?: string) => void;
  onOpenPlaylist: (playlist: Playlist) => void;
}) {
  const heroActive = Boolean(current);
  const heroPlaying = playing && heroActive;
  const canResumeDisplaySong = !heroActive && Boolean(displaySong);
  const releaseSong = newSongs[0] ?? recommendedSongs[0] ?? displaySong ?? null;
  const releaseQueue = newSongs.length ? newSongs : recommendedSongs.length ? recommendedSongs : releaseSong ? [releaseSong] : [];
  const featuredAlbum = albums[0];
  const featuredArtist = artists[0];
  const featuredPlaylist = playlists[0];
  const playerLabels = {
    nowPlaying: t("nowPlaying"),
    position: t("position"),
    previous: t("previous"),
    next: t("next"),
    play: t("play"),
    pause: t("pause"),
    newRelease: t("mobileNewRelease"),
    musicEditor: t("mobileMusicEditor"),
    ready: t("ready"),
    by: t("byArtist"),
    menu: t("mobilePlayerMenu"),
    favorite: t("favorites"),
    queue: t("queue"),
    lyrics: t("lyrics"),
  };

  return (
    <section className="mobile-home-surface" data-mobile-theme={theme}>
      <MobileArtPlayer
        variant={theme}
        cover={coverUrl(displaySong)}
        playing={heroPlaying}
        progress={heroActive ? progress : 0}
        duration={heroActive ? duration : displaySong?.duration_seconds || 0}
        title={displaySong?.title}
        artist={displaySong?.artist}
        album={displaySong?.album}
        playMode={playMode}
        playModeLabel={playModeLabel}
        labels={playerLabels}
        onToggle={heroActive ? onTogglePlayback : canResumeDisplaySong && displaySong ? () => onResume(displaySong) : undefined}
        onPrevious={heroActive ? onPrevious : undefined}
        onNext={heroActive ? onNext : undefined}
        onCyclePlayMode={onCyclePlayMode}
        onSeek={heroActive ? onSeek : undefined}
      />

      <div className="mobile-home-release">
        <div>
          <span>{t("mobileNewRelease")}</span>
          <strong>{releaseSong?.title ?? t("noSongs")}</strong>
          <small>{releaseSong ? `${releaseSong.artist} · ${releaseSong.album}` : t("emptyCollection")}</small>
        </div>
        <button
          type="button"
          disabled={!releaseSong}
          onClick={() => releaseSong && onPlay(releaseSong, releaseQueue)}
        >
          <MobileSongCover song={releaseSong} playing={Boolean(releaseSong && playing && releaseSong.id === current?.id)} />
          <Play weight="fill" />
        </button>
      </div>

      <div className="mobile-home-library-hub" aria-label={t("mobileLibraryHub")}>
        <button type="button" onClick={onOpenAlbums}>
          <MobileCollectionCover src={albumCoverUrl(featuredAlbum)} fallback="album" />
          <span>
            <strong>{t("albums")}</strong>
            <small>{stats?.albums ?? albums.length} {t("album")}</small>
          </span>
        </button>
        <button type="button" onClick={onOpenArtists}>
          <MobileCollectionCover src={artistCoverUrl(featuredArtist)} fallback="artist" />
          <span>
            <strong>{t("artists")}</strong>
            <small>{stats?.artists ?? artists.length} {t("artists")}</small>
          </span>
        </button>
        <button type="button" onClick={onOpenPlaylists}>
          <MobileCollectionCover fallback="playlist" />
          <span>
            <strong>{t("playlists")}</strong>
            <small>{stats?.playlists ?? playlists.length} {t("playlists")}</small>
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
          {recentSongs.length ? (
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
          {recommendedSongs.length ? (
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
