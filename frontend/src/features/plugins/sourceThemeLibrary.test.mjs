import assert from "node:assert/strict";
import test from "node:test";
import { sourceThemeLibrary } from "./sourceThemeLibrary.ts";
import { mygoSong } from "./mygo.ts";

const track = { id: "remote-1", name: "Remote track", duration: 180000, artists: [{ id: "artist-1", name: "Remote artist" }], album: { id: "remote-album", name: "Remote album", imageUrl: "https://cdn.example/cover.jpg" } };
const song = mygoSong("netease", track, "github:original", "网易云音乐");
const plugin = { manifest: { id: "netease", name: "网易云音乐" }, identity: "github:original", enabled: true, exports: ["album", "stream"] };

test("theme album shelves are isolated snapshots and load only the original source album", async () => {
  const calls = [], plays = [];
  const library = sourceThemeLibrary(song, plugin, "signed-source-cover", async (...args) => { calls.push(args); return { tracks: [track, { ...track, id: "blocked", unavailable: true }], more: true }; }, (...args) => plays.push(args));
  assert.equal(library.albums.length, 1);
  assert.equal(library.albums[0].title, "Remote album");
  assert.equal(library.cover(library.albums[0]), "signed-source-cover");
  assert.equal(library.cover({ id: 1 }), undefined);
  assert.deepEqual((await library.loadAlbums(2)).items, []);
  assert.equal(calls.length, 0, "Do not auto-fetch album songs or missing pages");
  const signal = new AbortController().signal;
  const tracks = await library.loadSongs(library.albums[0], signal);
  assert.deepEqual(calls, [["remote-album", signal]]);
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].mygo.identity, "github:original");
  library.playSong(tracks[0], tracks);
  assert.equal(plays[0][0].id, song.id);
  assert.deepEqual(await library.loadSongs({ id: 1 }), []);
});

test("missing capabilities, replaced identities and disabled sources never fall back to local albums", async () => {
  for (const installed of [undefined, { ...plugin, enabled: false }, { ...plugin, identity: "github:replacement" }, { ...plugin, exports: ["home", "stream"] }, { ...plugin, manifest: { id: "other" } }]) {
    const library = sourceThemeLibrary(song, installed, "cover", async () => assert.fail("No album export must mean no album call"), () => assert.fail("No playable source album"));
    assert.deepEqual(library.albums, []);
    assert.deepEqual((await library.loadAlbums(1)).items, []);
    assert.deepEqual(await library.loadSongs({ id: 1 }), []);
    library.playAlbum({ id: 1 });
  }
  const legacy = { ...song, mygo: { plugin: "netease", identity: "github:original", track: "remote-1" } };
  assert.deepEqual(sourceThemeLibrary(legacy, plugin, "cover", async () => ({}), () => {}).albums, []);
});

test("cassette rack album identities survive track changes within the same source album", async () => {
  const nextSong = mygoSong("netease", { ...track, id: "remote-2", name: "Next track" }, "github:original", "网易云音乐");
  const first = sourceThemeLibrary(song, plugin, "cover", async () => ({ tracks: [track] }), () => {});
  const second = sourceThemeLibrary(nextSong, plugin, "cover", async () => ({ tracks: [track] }), () => {});
  assert.equal(first.scope, second.scope);
  assert.equal(first.albums[0].id, second.albums[0].id);
  assert.equal(second.cover(first.albums[0]), "cover");
  assert.equal((await second.loadSongs(first.albums[0]))[0].mygo.track, "remote-1");
  const other = sourceThemeLibrary(mygoSong("netease", { ...track, album: { ...track.album, id: "other" } }, "github:original"), plugin, "cover", async () => ({}), () => {});
  assert.notEqual(other.albums[0].id, first.albums[0].id);
  assert.notEqual(other.scope, first.scope);
});
