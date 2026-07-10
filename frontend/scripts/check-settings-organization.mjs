import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const apiSource = readFileSync(new URL("../src/services/api.ts", import.meta.url), "utf8");
const metadataSource = readFileSync(new URL("../src/components/MetadataEditorDialog.tsx", import.meta.url), "utf8");

assert.match(apiSource, /metadata-candidates\?scope=\$\{encodeURIComponent\(scope\)\}/);
assert.match(metadataSource, /loadCandidateCache/);
assert.match(metadataSource, /"path"/);
assert.match(metadataSource, /"online"/);
assert.match(metadataSource, /onlineCandidates/);

console.log("settings and candidate loading contracts verified");
