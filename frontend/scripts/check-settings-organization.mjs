import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const apiSource = readFileSync(new URL("../src/services/api.ts", import.meta.url), "utf8");
const metadataSource = readFileSync(new URL("../src/components/MetadataEditorDialog.tsx", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const appTypesSource = readFileSync(new URL("../src/types/app.ts", import.meta.url), "utf8");
const mobileSource = readFileSync(new URL("../src/mobile.css", import.meta.url), "utf8");

assert.match(apiSource, /metadata-candidates\?scope=\$\{encodeURIComponent\(scope\)\}/);
assert.match(metadataSource, /loadCandidateCache/);
assert.match(metadataSource, /"path"/);
assert.match(metadataSource, /"online"/);
assert.match(metadataSource, /onlineCandidates/);
assert.match(appSource, /lyricCandidateCacheKey/);
assert.match(appSource, /getCandidateCache<LyricCandidate>/);
assert.match(appSource, /loadCandidateCache\(key, \(\) => api\.lyricCandidates\(songID\)\)/);
assert.doesNotMatch(appSource, /setLyricCandidates\(await api\.lyricCandidates/);
for (const category of ["account", "playback", "library", "services", "system", "users"]) {
  assert.match(appTypesSource, new RegExp(`"${category}"`));
  assert.match(appSource, new RegExp(`id: "${category}"`));
}
assert.match(appSource, /SettingsNavigation/);
assert.match(appSource, /user\.role === "admin"/);
assert.match(mobileSource, /\.settings-tabs[\s\S]*flex-direction:\s*row/);
assert.match(mobileSource, /\.settings-tabs[\s\S]*overflow-x:\s*auto/);

console.log("settings and candidate loading contracts verified");
