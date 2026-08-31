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
  "running-kitten-head-group",
  "running-kitten-tail-outline",
  "running-kitten-sleep-symbol",
  'data-motion-model="upper-groove-lap"',
]) {
  requireInSource(component, needle, "RunningKittenTurntable.tsx");
}

for (const needle of [
  "@keyframes running-kitten-lap",
  "@keyframes running-kitten-counter-lap",
  "@keyframes running-kitten-facing",
  ".running-kitten-player[data-playing='true'] .running-kitten-cat-orbit",
  ".running-kitten-cat .running-kitten-body-shape",
  ".running-kitten-cat .running-kitten-coat-mark",
  ".running-kitten-cat .running-kitten-tail-outline",
  ".running-kitten-player:not([data-playing='true']) .running-kitten-head-group",
  ".running-kitten-player[data-playing='true'] .running-kitten-cat-facing::before",
  ".running-kitten-player:not([data-playing='true']) .running-kitten-cat-facing::after",
  "@media (min-width:721px) and (max-width:1020px)",
  "@media (hover:hover) and (pointer:fine)",
  "prefers-reduced-motion: reduce",
]) {
  requireInSource(css, needle, "styles.css");
}

const pausedMotionRule = ".running-kitten-player:not([data-playing='true']) :is(";
const pausedMotionStart = css.lastIndexOf(pausedMotionRule);
const pausedMotionEnd = pausedMotionStart < 0 ? -1 : css.indexOf("}", pausedMotionStart);
if (pausedMotionStart < 0 || pausedMotionEnd < 0 || !css.slice(pausedMotionStart, pausedMotionEnd).includes("animation-name:none")) {
  failures.push("styles.css: paused kitten parts must release the animation cascade so sleep and hover transforms can apply");
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
