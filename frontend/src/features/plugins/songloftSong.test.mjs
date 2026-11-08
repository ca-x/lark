import assert from "node:assert/strict";
import test from "node:test";
import { toSongloftSong } from "./songloftSong.ts";

test("Songloft player songs expose upstream names and local cover URLs", () => {
  const song = toSongloftSong({ id: 12, path: "/music/track.flac", duration_seconds: 32, size_bytes: 1024, created_at: "2026-11-08", favorite: true });
  assert.equal(song.duration, 32);
  assert.equal(song.file_path, "/music/track.flac");
  assert.equal(song.file_size, 1024);
  assert.equal(song.cover_url, "/api/songs/12/cover");
  assert.equal(song.type, "local");
  assert.equal(song.added_at, "2026-11-08");
  assert.equal(song.favorite, true);
  assert.equal(toSongloftSong({ id: 12, path: "plugin://source/12" }).type, "remote");
  const radio = toSongloftSong({ id: 13, path: "", type: "radio", cover_url: "https://example.com/cover.jpg" });
  assert.equal(radio.type, "radio");
  assert.equal(radio.cover_url, "https://example.com/cover.jpg");
});
