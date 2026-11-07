import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mygoSong, mygoStreamURL, mygoImageURL, mygoLyricsToLRC, validMygoQueue, normalizeMygoPage, mygoPageTracks, appendMygoPage, mygoRepositoryFromOrigin, mygoErrorMessage } from "./mygo.ts";
import { songloftIdentity } from "./songloftIdentity.ts";
import { pluginNavigation } from "./navigation.ts";

test("marketplace installation identity only follows GitHub repository origins", () => {
  assert.equal(mygoRepositoryFromOrigin("https://github.com/Owner/Repo@v0.1.3"), "owner/repo");
  for (const origin of ["uploaded ZIP", "https://example.com/owner/repo", "http://github.com/owner/repo", "https://github.com/owner/repo/extra"]) assert.equal(mygoRepositoryFromOrigin(origin), undefined);
});

test("plugin errors preserve useful structured messages without hiding plain errors", () => {
  assert.equal(mygoErrorMessage(new Error('{"message":": login failed"}')), "login failed");
  assert.equal(mygoErrorMessage(new Error("connection failed")), "connection failed");
  assert.equal(mygoErrorMessage("null"), "null");
});

test("navigation uses enabled exports, frontend capability and administrator permission", () => {
  const source = { enabled: true, exports: ["search", "stream"] };
  const tool = { status: "active", has_frontend: true };
  const platform = { mygo: true, songloft: true };
  assert.equal(pluginNavigation(platform, [source], [tool], true).sources.length, 1);
  assert.equal(pluginNavigation(platform, [source], [tool], true).tools.length, 1);
  assert.equal(pluginNavigation(platform, [source], [tool], false).tools.length, 0);
  assert.deepEqual(pluginNavigation({ mygo: false, songloft: false }, [source], [tool], true), { sources: [], tools: [] });
  assert.deepEqual(pluginNavigation(platform, [{ ...source, enabled: false }, { ...source, exports: ["signIn"] }, { ...source, exports: ["stream"] }], [{ ...tool, status: "inactive" }, { ...tool, has_frontend: false }], true), { sources: [], tools: [] });
});

test("MyGo tracks use stable private identifiers and millisecond conversion", () => {
  const track = { id: "a/b?secret=x", name: "Song", duration: 12000, artists: [{ id: "a", name: "Artist" }] };
  const song = mygoSong("demo", track, "origin-a");
  assert.ok(song.id < 0 && Number.isSafeInteger(song.id));
  assert.equal(song.duration_seconds, 12);
  assert.equal(song.id, mygoSong("demo", track, "origin-a").id);
  assert.notEqual(song.id, mygoSong("other", track, "origin-a").id);
  assert.notEqual(song.id, mygoSong("demo", track, "origin-b").id);
  assert.equal(new URL(mygoStreamURL(song), "https://example.test").searchParams.get("id"), track.id);
  assert.ok(validMygoQueue({ songs: [song], current: song.id }));
  assert.ok(!validMygoQueue({ songs: [{ id: 1 }], current: 1 }));
  assert.ok(!validMygoQueue({ songs: [{ ...song, mygo: { plugin: "demo", track: track.id } }], current: song.id }));
  assert.equal(new URL(mygoStreamURL(song), "https://example.test").searchParams.get("identity"), "origin-a");
  assert.equal(mygoImageURL("demo", "https://example.test/a?x=y").includes("url=https%3A"), true);
});

test("native array pages preserve track, show and station navigation", () => {
  const entries = [{ id: "one", name: "Item" }];
  for (const [method, key] of [["recent", "tracks"], ["stationNext", "tracks"], ["shows", "shows"], ["stations", "stations"], ["savedAlbums", "albums"], ["playlists", "playlists"]]) {
    assert.deepEqual(normalizeMygoPage(method, entries), { [key]: entries });
  }
});

test("pagination preserves episodes and every collection without masking tracks", () => {
  const first = { id: "one", name: "First", duration: 1000 };
  const second = { id: "two", name: "Second", duration: 1000 };
  for (const key of ["tracks", "episodes", "artists", "albums", "playlists", "shows", "stations"]) {
    const merged = appendMygoPage({ [key]: [first], more: true }, { [key]: [second], more: false });
    assert.deepEqual(merged[key], [first, second]);
    if (["tracks", "episodes"].includes(key)) assert.deepEqual(mygoPageTracks(merged), [first, second]);
    assert.equal(merged.more, false);
  }
});

test("timed MyGo lyrics normalize milliseconds without requesting global songs", () => {
  assert.equal(mygoLyricsToLRC({ lines: [{ start: 12500, text: "hello" }] }), "[00:12.50]hello");
  assert.equal(mygoLyricsToLRC({ lrc: "[00:01.00]original" }), "[00:01.00]original");
});

test("Songloft marketplace keeps different authors separate and normalizes aliases", () => {
  assert.equal(songloftIdentity({ entry_path: "demo", author: "Alice <mail@example.test> (maintainer)" }), songloftIdentity({ entry_path: "demo", author: "ALICE" }));
  assert.notEqual(songloftIdentity({ entry_path: "demo", author: "Alice" }), songloftIdentity({ entry_path: "demo", author: "Bob" }));
  assert.equal(songloftIdentity({ entry_path: "demo", update_url: "https://github.com/Owner/Repo/blob/main/plugin.json" }), "demo\0repo:owner/repo");
});

test("source controls use scoped mobile palette and compact tabs", () => {
  const css = readFileSync(new URL("../../components/MygoPlugins.css", import.meta.url), "utf8");
  assert.match(css, /--mygo-muted:\s*color-mix\(in srgb, var\(--text\) 75%, var\(--panel\)\)/);
  assert.doesNotMatch(css, /var\(--muted-strong/);
  assert.match(css, /\.mygo-panel \.mygo-source-tabs > button\s*\{[^}]*width:\s*auto/);
});
