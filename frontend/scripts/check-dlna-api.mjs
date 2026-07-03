import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const apiSource = readFileSync(new URL("../src/services/api.ts", import.meta.url), "utf8");

for (const route of [
  "/api/dlna/status",
  "/api/dlna/devices",
  "/api/dlna/discover",
  "/api/dlna/play",
  "/api/dlna/pause",
  "/api/dlna/resume",
  "/api/dlna/stop",
  "/api/dlna/local",
]) {
  assert.match(apiSource, new RegExp(route.replaceAll("/", "\\/")));
}

console.log("dlna api routes verified");
