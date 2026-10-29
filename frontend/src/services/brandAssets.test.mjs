import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root));

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

test("shell activation invalidates old logos without deleting offline audio", async () => {
  const handlers = new Map();
  const deleted = [];
  vm.runInNewContext(read("public/sw.js").toString(), {
    self: { addEventListener: (event, handler) => handlers.set(event, handler), clients: { claim: async () => {} } },
    caches: {
      keys: async () => ["lark-shell-v1", "lark-shell-v2", "lark-offline-v1"],
      delete: async (key) => { deleted.push(key); },
    },
  });
  let activation;
  handlers.get("activate")({ waitUntil: (promise) => { activation = promise; } });
  await activation;
  assert.deepEqual(deleted, ["lark-shell-v1"]);
});
