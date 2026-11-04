import assert from "node:assert/strict";
import test from "node:test";
import { cassetteTilt, resolveCassetteGesture } from "./cassetteGesture.ts";

test("cassette swipes change tracks only on a deliberate horizontal gesture", () => {
  assert.equal(resolveCassetteGesture(-80, 5, 200), "next");
  assert.equal(resolveCassetteGesture(80, 5, 200), "previous");
  assert.equal(resolveCassetteGesture(10, 2, 100), "none");
  assert.equal(resolveCassetteGesture(80, 90, 200), "none");
  assert.equal(resolveCassetteGesture(80, 5, 1500), "none");
  assert.equal(resolveCassetteGesture(80, 5, 200, true), "none");
});

test("cassette tilt is bounded in either direction", () => {
  assert.deepEqual(cassetteTilt(0, 0), { x: -0, y: 0 });
  assert.deepEqual(cassetteTilt(900, -900), { x: 7, y: 9 });
  assert.deepEqual(cassetteTilt(-900, 900), { x: -7, y: -9 });
});
