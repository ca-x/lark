import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { inflateSync } from "node:zlib";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root));

function visibleAlphaBounds(image) {
  const width = image.readUInt32BE(16);
  const height = image.readUInt32BE(20);
  assert.equal(image[24], 8);
  assert.equal(image[25], 6);
  assert.equal(image[28], 0);
  const chunks = [];
  for (let offset = 8; offset < image.length;) {
    const length = image.readUInt32BE(offset);
    if (image.toString("ascii", offset + 4, offset + 8) === "IDAT") {
      chunks.push(image.subarray(offset + 8, offset + 8 + length));
    }
    offset += length + 12;
  }
  const pixels = inflateSync(Buffer.concat(chunks));
  const alpha = new Uint8Array(width * height);
  let leftEdge = width;
  let topEdge = height;
  let rightEdge = -1;
  let bottomEdge = -1;
  for (let row = 0; row < height; row++) {
    const rowOffset = row * (width * 4 + 1);
    const filter = pixels[rowOffset];
    assert.ok(filter <= 4);
    for (let column = 0; column < width; column++) {
      const index = row * width + column;
      const left = column > 0 ? alpha[index - 1] : 0;
      const above = row > 0 ? alpha[index - width] : 0;
      const upperLeft = row > 0 && column > 0 ? alpha[index - width - 1] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      if (filter === 2) predictor = above;
      if (filter === 3) predictor = Math.floor((left + above) / 2);
      if (filter === 4) {
        const estimate = left + above - upperLeft;
        const leftDistance = Math.abs(estimate - left);
        const aboveDistance = Math.abs(estimate - above);
        const diagonalDistance = Math.abs(estimate - upperLeft);
        predictor = leftDistance <= aboveDistance && leftDistance <= diagonalDistance ? left : aboveDistance <= diagonalDistance ? above : upperLeft;
      }
      alpha[index] = (pixels[rowOffset + column * 4 + 4] + predictor) & 255;
      if (alpha[index] < 128) continue;
      leftEdge = Math.min(leftEdge, column);
      topEdge = Math.min(topEdge, row);
      rightEdge = Math.max(rightEdge, column);
      bottomEdge = Math.max(bottomEdge, row);
    }
  }
  return { width: rightEdge - leftEdge + 1, height: bottomEdge - topEdge + 1, centerX: (leftEdge + rightEdge + 1) / 2, centerY: (topEdge + bottomEdge + 1) / 2 };
}

test("brand assets retain the exact issue source, RGBA sizes and matching desktop variants", () => {
  const source = read("../assets/brand/lark-issue-9.png");
  assert.equal(createHash("sha256").update(source).digest("hex"), "fc113df9dcd055b1e8fdab10022149516c91574fd04f3872c0e6d84692ab2916");
  for (const [name, size] of [["logo.png", 512], ["android-chrome-512x512.png", 512], ["android-chrome-192x192.png", 192], ["apple-touch-icon.png", 180], ["favicon-32x32.png", 32], ["favicon-16x16.png", 16]]) {
    const image = read(`public/${name}`);
    assert.equal(image.readUInt32BE(16), size, `${name} width`);
    assert.equal(image.readUInt32BE(20), size, `${name} height`);
    assert.equal(image[25], 6, `${name} retains RGBA`);
  }
  assert.deepEqual(read("public/logo.png"), read("public/android-chrome-512x512.png"));
  assert.deepEqual(read("public/logo.png"), read("../desktop/resources/icon.png"));
  assert.deepEqual(read("public/favicon-32x32.png"), read("../desktop/resources/tray.png"));
  const icon = read("public/favicon.ico");
  assert.equal(icon.readUInt16LE(4), 3);
  assert.deepEqual([icon[6], icon[22], icon[38]].sort((first, second) => first - second), [16, 32, 48]);
});

test("logo artwork retains the established visible size inside unchanged square slots", () => {
  for (const [name, size] of [["logo.png", 512], ["android-chrome-192x192.png", 192], ["apple-touch-icon.png", 180]]) {
    const bounds = visibleAlphaBounds(read(`public/${name}`));
    for (const dimension of [bounds.width, bounds.height]) {
      assert.ok(dimension / size >= 0.93 && dimension / size <= 0.98, `${name} artwork must occupy 93-98% of the slot, got ${dimension}/${size}`);
    }
    assert.ok(Math.abs(bounds.centerX / size - 0.5) <= 0.02, `${name} horizontal center`);
    assert.ok(Math.abs(bounds.centerY / size - 0.5) <= 0.02, `${name} vertical center`);
  }
});

test("shell activation invalidates old logos without deleting offline audio", async () => {
  const handlers = new Map();
  const deleted = [];
  vm.runInNewContext(read("public/sw.js").toString(), {
    self: { addEventListener: (event, handler) => handlers.set(event, handler), clients: { claim: async () => {} } },
    caches: {
      keys: async () => ["lark-shell-v1", "lark-shell-v2", "lark-shell-v3", "lark-offline-v1"],
      delete: async (key) => { deleted.push(key); },
    },
  });
  let activation;
  handlers.get("activate")({ waitUntil: (promise) => { activation = promise; } });
  await activation;
  assert.deepEqual(deleted, ["lark-shell-v1", "lark-shell-v2"]);
});
