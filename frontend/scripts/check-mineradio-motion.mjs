import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const component = readFileSync(join(root, "src/components/player-themes/MineradioStagePlayer.tsx"), "utf8");
const artistAlbumBrowser = readFileSync(join(root, "src/components/ArtistAlbumBrowser.tsx"), "utf8");
const css = readFileSync(join(root, "src/styles.css"), "utf8");

const failures = [];

function requireInSource(source, needle, label) {
  if (!source.includes(needle)) failures.push(`${label}: missing ${needle}`);
}

function forbidInSource(source, needle, label) {
  if (source.includes(needle)) failures.push(`${label}: should not contain ${needle}`);
}

for (const needle of [
  "mineradio-stage-splash-particles",
  "mineradio-stage-splash-streaks",
  "mineradio-stage-splash-shards",
  "mineradio-stage-lyric-river",
  "mineradio-stage-lyric-glow",
  "--shelf-delta",
  "data-motion-card",
  "data-webgl-unavailable",
  "cyanBeamSweep",
  "goldBeamSweep",
  "makeLightBeamMotion",
  "animateLightBeamGeometry",
  "beamSweepPulse",
]) {
  requireInSource(component, needle, "MineradioStagePlayer.tsx");
}

for (const needle of [
  "data-showcase-motion-card",
  "--album-showcase-distance",
  "--album-showcase-parity",
]) {
  requireInSource(artistAlbumBrowser, needle, "ArtistAlbumBrowser.tsx");
}

for (const needle of [
  "@keyframes mineradio-stage-card-breathe",
  "@keyframes mineradio-stage-lyric-river",
  "@keyframes mineradio-stage-signal-sweep",
  "mineradio-stage-card-selected-pulse",
  "mineradio-stage-splash-particle",
  "mineradio-stage-splash-streak",
  "mineradio-stage-splash-shard",
  "@keyframes artist-album-showcase-card-breathe",
  "@keyframes artist-album-showcase-sweep",
  "@keyframes artist-album-showcase-cover-drift",
  "prefers-reduced-motion: reduce",
]) {
  requireInSource(css, needle, "styles.css");
}

for (const [source, label] of [
  [component, "MineradioStagePlayer.tsx"],
  [css, "styles.css"],
]) {
  forbidInSource(source, "mineradio-stage-empty-shelf", label);
  forbidInSource(source, "makeGhostShelfCard", label);
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("Mineradio motion checks passed");
