import type { Album, Song } from "../../types";
import type { RewindLibrary } from "../../components/player-themes/rewindLibrary";
import { mygoEntityID, mygoPageTracks, mygoSong, normalizeMygoPage, type MygoPage, type MygoPlugin } from "./mygo.ts";

export function sourceThemeLibrary(
  song: Song,
  plugin: MygoPlugin | undefined,
  cover: string | undefined,
  callAlbum: (id: string, signal?: AbortSignal) => Promise<MygoPage>,
  onPlay: (song: Song, songs: Song[]) => void,
): RewindLibrary {
  const source = song.mygo;
  const available = source && plugin?.enabled && plugin.identity === source.identity && plugin.manifest.id === source.plugin;
  const album: Album | undefined = available && source.album && plugin.exports.includes("album") ? {
    id: mygoEntityID(source.plugin, source.identity, `album\0${source.album}`), title: song.album, artist: song.artist, album_artist: song.artist,
    artist_id: 0, year: song.year, favorite: false, song_count: 0,
  } : undefined;
  const albums = album ? [album] : [];
  const loadSongs = async (selected: Album, signal?: AbortSignal) => {
    if (!album || selected.id !== album.id || !source?.album) return [];
    const page = normalizeMygoPage("album", await callAlbum(source.album, signal));
    return [...mygoPageTracks(page), ...(page.sections || []).flatMap(mygoPageTracks)]
      .filter((track) => !track.unavailable)
      .map((track) => mygoSong(source.plugin, track, source.identity, source.sourceName || plugin?.manifest.name));
  };
  return {
    scope: `${source?.plugin}:${source?.identity}:${source?.album || source?.track}:${Boolean(album)}`,
    albums,
    cover: (selected) => selected.id === album?.id ? cover : undefined,
    loadAlbums: async (page) => ({ items: page === 1 ? albums : [], total: albums.length, limit: 1, offset: Math.max(0, page - 1), page }),
    loadSongs,
    playAlbum: (selected) => { void loadSongs(selected).then((songs) => { if (songs[0]) onPlay(songs[0], songs); }).catch(() => undefined); },
    playSong: onPlay,
  };
}
