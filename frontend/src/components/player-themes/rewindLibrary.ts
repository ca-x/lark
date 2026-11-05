import type { Album, AlbumPage, Song } from "../../types";

export type RewindLibrary = {
  albums: Album[];
  cover: (album: Album) => string | undefined;
  loadSongs: (album: Album) => Promise<Song[]>;
  loadAlbums: (page: number, signal: AbortSignal) => Promise<AlbumPage>;
  playAlbum: (album: Album) => void;
  playSong: (song: Song, songs: Song[]) => void;
};

export function findTapeAlbum(albums: Album[], album: string, artist: string) {
  const matches = albums.filter((item) => item.title === album);
  return matches.find((item) => item.artist === artist || item.album_artist === artist)
    ?? (matches.length === 1 ? matches[0] : undefined);
}
