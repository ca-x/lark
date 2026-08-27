import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(new URL("./FolderMetadataCorrectionDialog.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const api = readFileSync(new URL("../services/api.ts", import.meta.url), "utf8");
const i18n = readFileSync(new URL("../i18n.ts", import.meta.url), "utf8");

test("folder metadata correction previews before confirmed execution", () => {
  assert.match(component, /folderMetadataCorrectionPreview/);
  assert.match(component, /folderMetadataCorrection\(/);
  assert.match(component, /confirm:\s*true/);
  assert.match(component, /expected_song_count:\s*preview\.song_count/);
  assert.match(component, /expected_file_count:\s*preview\.file_count/);
  assert.match(component, /expected_snapshot:\s*preview\.snapshot/);
  assert.match(component, /write_files/);
  assert.match(component, /update_database/);
  assert.match(component, /role="dialog"/);
  assert.match(component, /useDialogLifecycle/);
});

test("folder metadata correction exposes the supported fields and destinations", () => {
  for (const field of ["title", "artist", "album", "album_artist", "genre", "year", "language", "style", "track"]) {
    assert.match(component, new RegExp(`value=["']${field}["']`));
  }
  assert.match(component, /folderMetadataWriteFiles/);
  assert.match(component, /folderMetadataUpdateDatabase/);
  assert.match(component, /disabled=\{[^}]*!writeFiles[^}]*!updateDatabase/);
});

test("folder browser wires the admin-only correction action and localized API", () => {
  assert.match(app, /FolderMetadataCorrectionDialog/);
  assert.match(app, /userRole === "admin"/);
  assert.match(api, /\/api\/folders\/metadata-correction\/preview/);
  assert.match(api, /\/api\/folders\/metadata-correction/);
  for (const key of ["folderMetadataCorrect", "folderMetadataPreview", "folderMetadataWriteFiles", "folderMetadataUpdateDatabase"]) {
    assert.match(i18n, new RegExp(`${key}:`));
  }
});
