import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("library sort control exposes stable accessible choices", () => {
  const source = readFileSync(new URL("./LibrarySortControl.tsx", import.meta.url), "utf8");
  for (const value of ["added_desc", "added_asc", "filename_asc", "filename_desc"]) {
    assert.match(source, new RegExp(value));
  }
  assert.match(source, /role="menu"/);
  assert.match(source, /role="menuitemradio"/);
  assert.match(source, /aria-checked/);
  assert.match(source, /library-sort-sheet/);
  assert.match(source, /Escape/);
});
