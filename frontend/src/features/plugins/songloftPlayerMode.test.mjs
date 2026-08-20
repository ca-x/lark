import assert from "node:assert/strict";
import test from "node:test";
import {
  fromSongloftPlayMode,
  toSongloftPlayMode,
} from "./songloftPlayerMode.ts";
import { queueBoundaryAction } from "../playback/playMode.ts";

test("all SongLoft modes round-trip without losing semantics", () => {
  for (const mode of ["order", "loop", "single", "random", "singlePlay"]) {
    assert.equal(toSongloftPlayMode(fromSongloftPlayMode(mode)), mode);
  }
});

test("queue boundary behavior distinguishes order, loop, and singlePlay", () => {
  assert.equal(queueBoundaryAction("order", 1, 1, 2, true), "stop");
  assert.equal(queueBoundaryAction("order", 1, 1, 2, false), "no-op");
  assert.equal(queueBoundaryAction("order", 1, 0, 2, true), "continue");
  assert.equal(queueBoundaryAction("sequence", 1, 1, 2, true), "continue");
  assert.equal(queueBoundaryAction("single-play", 1, 0, 2, true), "stop");
  assert.equal(queueBoundaryAction("single-play", 1, 0, 2, false), "continue");
});
