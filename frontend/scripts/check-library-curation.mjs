import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const types = read("src/types.ts");
const api = read("src/services/api.ts");
const app = read("src/App.tsx");
const i18n = read("src/i18n.ts");
const styles = read("src/styles.css");
const mobile = read("src/mobile.css");

for (const value of ["added_desc", "added_asc", "filename_asc", "filename_desc"]) {
  assert.match(types, new RegExp(value), `missing sort type ${value}`);
  assert.match(app, new RegExp(value), `missing app wiring ${value}`);
}
assert.match(api, /\/api\/library\/review-summary/);
assert.match(api, /refresh=true/);
assert.match(app, /metadata_issues/);
assert.match(app, /onEditMetadata=\{auth\.user\.role === "admin"/);
assert.match(app, /className="song-metadata-issues" onClick/);
const songTableHeader = app.match(/const columnHeader = \([\s\S]*?\n  \);/)?.[0] || "";
assert.match(songTableHeader, /t\("songs"\)[\s\S]*t\("album"\)[\s\S]*t\("quality"\)/, "song table headers must follow the rendered song, album, and quality columns");
assert.doesNotMatch(songTableHeader, /t\("artist"\)/, "artist is rendered inside the song cell and must not claim the album column header");
for (const key of ["sortAddedDesc", "sortAddedAsc", "sortFilenameAsc", "sortFilenameDesc", "libraryReview", "searchSettings", "refreshOnlineCandidates"]) {
  assert.equal((i18n.match(new RegExp(`${key}:`, "g")) || []).length, 2, `${key} must have Chinese and English copy`);
}
assert.match(mobile, /library-sort-trigger[^}]*min-height:44px/s);
assert.match(mobile, /settings-search-results > button[^}]*min-height:56px/s);
assert.match(styles + mobile, /prefers-reduced-motion: reduce/);
assert.match(styles, /hover:hover/);
assert.doesNotMatch(styles.match(/\.library-sort-trigger[\s\S]*?@keyframes library-sort-in/)?.[0] || "", /transition:\s*all/);
assert.doesNotMatch(styles.match(/\.library-sort-trigger[\s\S]*?@keyframes library-sort-in/)?.[0] || "", /ease-in(?:\s|;|,)/);

console.log("library curation contracts verified");
