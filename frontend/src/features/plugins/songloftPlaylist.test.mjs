import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { toSongloftPlaylistID, fromSongloftPlaylistID, songloftPlaylistSource } from "./songloftPlaylist.ts";

test("ordinary playlist IDs roundtrip while favorites never become native playlist 1", () => {
  assert.equal(fromSongloftPlaylistID(toSongloftPlaylistID(1)), 1);
  assert.deepEqual(songloftPlaylistSource(1), {});
  assert.deepEqual(songloftPlaylistSource(toSongloftPlaylistID(2)), { source: { type: "playlist", source_id: 2 } });
  for (const id of [-1, 0, 2, 1000000000, 2.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => fromSongloftPlaylistID(id));
  assert.throws(() => toSongloftPlaylistID(Number.MAX_SAFE_INTEGER));
  assert.match(readFileSync(new URL("../../../../backend/internal/plugin/larkhost/playlist_compat.go", import.meta.url), "utf8"), /PlaylistIDOffset = 1_000_000_000/);
});
