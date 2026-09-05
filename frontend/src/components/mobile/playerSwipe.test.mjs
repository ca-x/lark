import assert from "node:assert/strict";
import test from "node:test";
import { resolvePlayerSwipe } from "./playerSwipe.ts";

test("horizontal gestures are symmetric and never open lyrics", () => {
  assert.equal(resolvePlayerSwipe(-90, 10, 300), "next");
  assert.equal(resolvePlayerSwipe(90, -10, 300), "previous");
});
test("short deliberate flicks work in both vertical directions", () => {
  assert.equal(resolvePlayerSwipe(4, -45, 100), "expand");
  assert.equal(resolvePlayerSwipe(4, 45, 100), "collapse");
});
test("taps, diagonal drags and slow short movements are ignored", () => {
  for (const [x, y, ms] of [[8, 2, 10], [70, 65, 100], [45, 0, 600], [0, 45, 600]]) {
    assert.equal(resolvePlayerSwipe(x, y, ms), null);
  }
});
test("long drags remain usable without a fast flick", () => {
  assert.equal(resolvePlayerSwipe(-100, 0, 1800), "next");
  assert.equal(resolvePlayerSwipe(0, 120, 1800), "collapse");
});
