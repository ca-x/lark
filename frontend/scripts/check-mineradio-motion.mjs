import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const component = readFileSync(join(root, "src/components/player-themes/MineradioStagePlayer.tsx"), "utf8");
const css = readFileSync(join(root, "src/styles.css"), "utf8");

const failures = [];

function requireInSource(source, needle, label) {
  if (!source.includes(needle)) failures.push(`${label}: missing ${needle}`);
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
]) {
  requireInSource(component, needle, "MineradioStagePlayer.tsx");
}

for (const needle of [
  "@keyframes mineradio-stage-card-breathe",
  "@keyframes mineradio-stage-lyric-river",
  "@keyframes mineradio-stage-signal-sweep",
  "mineradio-stage-card-selected-pulse",
  "mineradio-stage-splash-particle",
  "mineradio-stage-splash-streak",
  "mineradio-stage-splash-shard",
  "prefers-reduced-motion: reduce",
]) {
  requireInSource(css, needle, "styles.css");
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("Mineradio motion checks passed");
