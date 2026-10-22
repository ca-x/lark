import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const player = readFileSync(new URL("../player-themes/MobileArtPlayer.tsx", import.meta.url), "utf8");
const keyboard = readFileSync(new URL("../../hooks/useKeyboardAware.ts", import.meta.url), "utf8");

test("mobile dialog semantics belong to the visible gesture and scroll surface", () => {
  const phone = player.match(/<div\b[^>]*className="mobile-art-phone"[^>]*>/)?.[0];
  assert.ok(phone);
  assert.match(phone, /ref=\{dialogRef\}/);
  assert.match(phone, /role=\{onBack \? "dialog"/);
  assert.match(phone, /aria-modal=\{onBack \? true/);
  assert.doesNotMatch(player, /transform \.38s/);
});

test("keyboard viewport changes do not force smooth scrolling or run after focus leaves", () => {
  assert.match(keyboard, /document\.activeElement !== el/);
  assert.match(keyboard, /bounds\.top < top \|\| bounds\.bottom > bottom/);
  assert.match(keyboard, /block: "nearest", behavior: "instant"/);
  assert.doesNotMatch(keyboard, /behavior: "smooth"/);
});
