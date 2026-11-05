import assert from "node:assert/strict";
import test from "node:test";
import { findTapeAlbum } from "./rewindLibrary.ts";
import { paintTape, TAPE_MATERIALS } from "./rewindTexture.ts";

test("cassette album inspection resolves the artist before a shared album title", () => {
  const albums = [{ id: 1, title: "Greatest Hits", artist: "First", album_artist: "First" }, { id: 2, title: "Greatest Hits", artist: "Second", album_artist: "Various Artists" }];
  assert.equal(findTapeAlbum(albums, "Greatest Hits", "Second")?.id, 2);
  assert.equal(findTapeAlbum(albums, "Greatest Hits", "Various Artists")?.id, 2);
  assert.equal(findTapeAlbum(albums, "Greatest Hits", "Unmatched"), undefined);
  assert.equal(findTapeAlbum(albums.slice(0, 1), "Greatest Hits", "Guest")?.id, 1);
  assert.equal(findTapeAlbum(albums, "Missing", "First"), undefined);
});

test("all materials share cassette proportions, cut real-model openings and print user metadata", () => {
  for (const variant of Object.keys(TAPE_MATERIALS)) {
    const texts = [];
    const circles = [];
    const composites = [];
    const cuts = [];
    const context = new Proxy({
      measureText: text => ({ width: text.length * 10 }),
      fillText: text => texts.push(text),
      arc: (...args) => circles.push(args),
      createLinearGradient: () => ({ addColorStop() {} }),
      fill: () => { if (context.globalCompositeOperation === "destination-out") cuts.push(context.fillStyle); },
    }, { get: (target, key) => target[key] ?? (() => {}), set: (target, key, value) => { if (key === "globalCompositeOperation") composites.push(value); target[key] = value; return true; } });
    const canvas = { getContext: () => context };
    paintTape(canvas, { variant, title: "Night Passage", album: "山间来信", artist: "A long artist" });
    assert.equal(canvas.width / canvas.height, 1.5625);
    assert.ok(texts.includes("山间来信"));
    assert.ok(texts.includes("A side"));
    assert.ok(composites.includes("destination-out"));
    assert.deepEqual(cuts, ["#000", "#000"]);
    assert.equal(circles.filter(circle => circle[2] === 66).length, 2);
    paintTape(canvas, { variant, title: "Night Passage", album: "山间来信", artist: "" }, undefined, true, "B");
    assert.ok(texts.includes("B side"));
    assert.equal(circles.filter(circle => circle[2] === 51).length, 2);
  }
});

test("printing degrades harmlessly when 2D canvas is unavailable", () => {
  assert.doesNotThrow(() => paintTape({ getContext: () => null }, { variant: "rewind-classic", title: "", album: "", artist: "" }));
});
