import type { Song } from "../../types";
import { mygoImageURL } from "./mygo.ts";

export function toSongloftSong(song: Song) {
  return {
    ...song,
    type: song.mygo ? "remote" : song.type || (song.path.startsWith("plugin://") ? "remote" : "local"),
    duration: song.duration_seconds,
    file_path: song.path,
    file_size: song.size_bytes,
    cover_url: song.mygo ? mygoImageURL(song.mygo.plugin, song.mygo.image, song.mygo.identity) : song.cover_url || `/api/songs/${song.id}/cover${song.cover_version ? `?v=${encodeURIComponent(String(song.cover_version))}` : ""}`,
    added_at: song.created_at,
  };
}
