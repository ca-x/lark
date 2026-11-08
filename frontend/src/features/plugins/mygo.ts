import type { Song } from "../../types";

export interface MygoArtist { id: string; name: string }
export interface MygoTrack {
  id: string;
  name: string;
  artists?: MygoArtist[];
  album?: { id: string; name: string; imageUrl?: string };
  duration: number;
  liked?: boolean;
  unavailable?: boolean;
}
export interface MygoEntity { id: string; name: string; imageUrl?: string; tracks?: MygoTrack[] }
export interface MygoAccount { id: string; name: string; imageUrl?: string }
export interface MygoPage {
  title?: string;
  tracks?: MygoTrack[];
  episodes?: MygoTrack[];
  playlists?: MygoEntity[];
  albums?: MygoEntity[];
  artists?: MygoEntity[];
  shows?: MygoEntity[];
  stations?: MygoEntity[];
  sections?: (MygoPage & { title?: string; morePage?: string })[];
  links?: { title: string; page: string }[];
  more?: boolean;
}
export interface MygoManifest {
  id: string;
  name: string;
  version: string;
  playback: string;
  permissions: { network?: string[]; process?: string[] | boolean };
  settings?: { key: string; label: string; help?: string; link?: string }[];
  navigation?: { builtin?: string; title?: string; page?: string }[];
}
export interface MygoPlugin { manifest: MygoManifest; digest: string; origin: string; identity: string; enabled: boolean; exports: string[] }
export interface MygoPreview { token: string; manifest: MygoManifest; digest: string; origin: string; exports: string[] }
export interface MygoCatalogEntry { repository: string; name: string; description: string; url: string; stars: number }
export interface PluginPlatform { songloft: boolean; mygo: boolean; degraded?: string }
export interface MygoQueue { songs: Song[]; current: number }

export function mygoRepositoryFromOrigin(origin: string): string | undefined {
  try {
    const address = new URL(origin);
    if (address.protocol !== "https:" || address.host.toLowerCase() !== "github.com") return;
    const repository = address.pathname.replace(/^\/+|\/+$/g, "").split("@")[0];
    if (/^[\w.-]+\/[\w.-]+$/.test(repository)) return repository.toLowerCase();
  } catch { return; }
}

export function mygoErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  try {
    const value = JSON.parse(message);
    if (typeof value.message === "string") return value.message.replace(/^:\s*/, "");
  } catch { return message; }
  return message;
}

export function mygoSong(plugin: string, track: MygoTrack, identity: string): Song {
  let hash = 14695981039346656037n;
  for (const char of `${plugin}\0${identity}\0${track.id}`) hash = BigInt.asUintN(64, (hash ^ BigInt(char.codePointAt(0) ?? 0)) * 1099511628211n);
  return {
    id: -1 - Number(hash % 4503599627370495n), title: track.name,
    artist_id: 0, artist: track.artists?.map((artist) => artist.name).join(" / ") || "",
    album_id: 0, album: track.album?.name || "", path: "", file_name: track.name,
    format: "mygo", mime: "audio/mpeg", size_bytes: 0, duration_seconds: Math.max(0, track.duration || 0) / 1000,
    sample_rate: 0, bit_rate: 0, bit_depth: 0, year: 0, netease_id: "",
    favorite: track.liked || false, play_count: 0, resume_position_seconds: 0,
    has_lyrics: true, lyrics_source: "mygo", mygo: { plugin, identity, track: track.id, image: track.album?.imageUrl },
  };
}

export function mygoStreamURL(song: Song): string | undefined {
  if (!song.mygo) return undefined;
  return `/api/mygo/plugins/${encodeURIComponent(song.mygo.plugin)}/stream?${new URLSearchParams({ id: song.mygo.track, identity: song.mygo.identity, quality: "high" })}`;
}

export function mygoImageURL(plugin: string, address?: string, identity = ""): string | undefined {
  return address ? `/api/mygo/plugins/${encodeURIComponent(plugin)}/image?${new URLSearchParams({ url: address, identity })}` : undefined;
}

export function mygoLyricsToLRC(value: { lrc?: string; lines?: { start: number; text?: string; words?: { text: string }[] }[] }): string {
  if (value.lrc) return value.lrc;
  return (value.lines || []).map((line) => {
    const seconds = Math.max(0, line.start) / 1000;
    return `[${String(Math.floor(seconds / 60)).padStart(2, "0")}:${(seconds % 60).toFixed(2).padStart(5, "0")}]${line.text || line.words?.map((word) => word.text).join("") || ""}`;
  }).join("\n");
}

export function validMygoQueue(value: MygoQueue | null): value is MygoQueue {
  return Boolean(value && Array.isArray(value.songs) && value.songs.length > 0 && value.songs.length <= 500 && value.songs.every((song) => song.mygo && typeof song.mygo.plugin === "string" && typeof song.mygo.identity === "string" && song.mygo.identity.length > 0 && typeof song.mygo.track === "string" && Number.isSafeInteger(song.id) && song.id < 0));
}

export interface MygoLike { plugin: string; identity: string; track: string; on: boolean }

export function notifyMygoLike(detail: MygoLike) {
  window.dispatchEvent(new CustomEvent<MygoLike>("lark:mygo-like", { detail }));
}

export function normalizeMygoPage(method: string, value: MygoPage | MygoEntity[]): MygoPage {
  if (!Array.isArray(value)) return value;
  const key = ({ savedAlbums: "albums", followedArtists: "artists", recent: "tracks", stationNext: "tracks", shows: "shows", stations: "stations" } as Record<string, string>)[method] || "playlists";
  return { [key]: value };
}

export function mygoPageTracks(page: MygoPage): MygoTrack[] {
  return [...(page.tracks || []), ...(page.episodes || [])];
}

export function appendMygoPage(previous: MygoPage, next: MygoPage): MygoPage {
  return {
    ...next,
    tracks: [...(previous.tracks || []), ...(next.tracks || [])],
    episodes: [...(previous.episodes || []), ...(next.episodes || [])],
    albums: [...(previous.albums || []), ...(next.albums || [])],
    artists: [...(previous.artists || []), ...(next.artists || [])],
    playlists: [...(previous.playlists || []), ...(next.playlists || [])],
    shows: [...(previous.shows || []), ...(next.shows || [])],
    stations: [...(previous.stations || []), ...(next.stations || [])],
    sections: [...(previous.sections || []), ...(next.sections || [])],
  };
}
