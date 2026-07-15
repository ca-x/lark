import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const component = readFileSync(join(root, "src/components/player-themes/RunningKittenTurntable.tsx"), "utf8");
const css = readFileSync(join(root, "src/styles.css"), "utf8");
const failures = [];

function requireInSource(source, needle, label) {
  if (!source.includes(needle)) failures.push(`${label}: missing ${needle}`);
}

for (const needle of [
  "running-kitten-cat-orbit",
  "running-kitten-cat-runner",
  "running-kitten-cat-facing",
  'data-motion-model="upper-groove-lap"',
]) {
  requireInSource(component, needle, "RunningKittenTurntable.tsx");
}

for (const needle of [
  "@keyframes running-kitten-lap",
  "@keyframes running-kitten-counter-lap",
  "@keyframes running-kitten-facing",
  ".running-kitten-player[data-playing='true'] .running-kitten-cat-orbit",
  "@media (hover:hover) and (pointer:fine)",
  "prefers-reduced-motion: reduce",
]) {
  requireInSource(css, needle, "styles.css");
}

const recordMarker = '<div className="running-kitten-record">';
const recordStart = component.indexOf(recordMarker);
const orbitStart = component.indexOf('<div className="running-kitten-cat-orbit"');
if (recordStart < 0 || orbitStart < 0) {
  failures.push("RunningKittenTurntable.tsx: record/orbit structure unavailable");
} else {
  const divToken = /<div\b[^>]*\/>|<div\b|<\/div>/g;
  divToken.lastIndex = recordStart;
  let depth = 0;
  let recordEnd = -1;
  for (let match = divToken.exec(component); match; match = divToken.exec(component)) {
    if (!match[0].endsWith("/>")) depth += match[0] === "</div>" ? -1 : 1;
    if (depth === 0) {
      recordEnd = divToken.lastIndex;
      break;
    }
  }
  if (recordEnd < 0 || orbitStart < recordEnd) {
    failures.push("RunningKittenTurntable.tsx: kitten orbit must be outside the rotating record");
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("Running kitten theme checks passed");
