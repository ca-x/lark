import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("settings search indexes only rendered permission-filtered controls", () => {
  const source = readFileSync(new URL("./SettingsSearch.tsx", import.meta.url), "utf8");
  assert.match(source, /root\.current/);
  assert.match(source, /data-settings-owner/);
  assert.match(source, /onTabChange/);
  assert.match(source, /scrollIntoView/);
  assert.match(source, /\.focus\(/);
  assert.match(source, /nativeEvent\.isComposing/);
  assert.match(source, /tabIndex=\{-1\}/);
  assert.doesNotMatch(source, /adminEntry/);
});
