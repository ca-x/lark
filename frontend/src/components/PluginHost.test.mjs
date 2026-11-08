import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./PluginHost.tsx", import.meta.url), "utf8");
const signature = new Function("playerState", `return ${source.match(/const stateSignature = (.+);/)[1]};`);
const state = { queue: [{ id: 1 }, { id: 2 }, { id: 3 }], current_index: 0, current_song: { id: 1 }, is_playing: true, current_time: 1, duration: 30, volume: 50, play_mode: "loop", source_playlist_id: null };

test("plugin player pushes progress, duration, source and same-length queue changes", () => {
  for (const change of [{ current_time: 2 }, { duration: 40 }, { source_playlist_id: 2 }, { queue: [{ id: 1 }, { id: 3 }, { id: 2 }] }]) {
    assert.notEqual(signature(state), signature({ ...state, ...change }), JSON.stringify(change));
  }
  assert.equal(signature(state), signature(structuredClone(state)));
});
