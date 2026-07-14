import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = readFileSync(join(root, "src/App.tsx"), "utf8");
const browser = readFileSync(join(root, "src/components/ArtistAlbumBrowser.tsx"), "utf8");
const i18n = readFileSync(join(root, "src/i18n.ts"), "utf8");
const css = readFileSync(join(root, "src/styles.css"), "utf8");
const mobileCss = readFileSync(join(root, "src/mobile.css"), "utf8");
const failures = [];

function requireInSource(source, needle, label) {
  if (!source.includes(needle)) failures.push(`${label}: missing ${needle}`);
}

function forbidInSource(source, needle, label) {
  if (source.includes(needle)) failures.push(`${label}: should not contain ${needle}`);
}

for (const needle of [
  "onArtistAlbumDisplayStyleChange",
  "artist-album-view-switcher",
  'aria-pressed={artistAlbumDisplayStyle === "classic"}',
  'aria-pressed={artistAlbumDisplayStyle === "showcase"}',
]) {
  requireInSource(app, needle, "App.tsx");
}

for (const needle of [
  "artistAlbumViewLabel",
  "artistAlbumDisplayClassic",
  "artistAlbumDisplayShowcase",
  "封面流",
  "Cover Flow",
]) {
  requireInSource(i18n, needle, "i18n.ts");
}

requireInSource(css, ".artist-album-view-switcher", "styles.css");
requireInSource(mobileCss, ".artist-album-view-switcher", "mobile.css");

for (const needle of [
  "artist-album-cover-flow",
  "wrapPosition",
  "styleCards",
  "animateToTarget",
  "scheduleSettle",
  "onWheel",
  "onPointerDown",
  "setPointerCapture",
  'event.key === "ArrowRight"',
  'event.key === "ArrowLeft"',
  'event.key === "Enter"',
  'event.key === " "',
  'window.matchMedia("(prefers-reduced-motion: reduce)")',
  "onOpenAlbum?.(activeAlbum)",
  "onPlayAlbum?.(activeAlbum)",
]) {
  requireInSource(browser, needle, "ArtistAlbumBrowser.tsx");
}

for (const needle of [
  "[...albums, ...albums, ...albums]",
  "scrollCardIntoCenter",
  "onScroll={updateIndex}",
]) {
  forbidInSource(browser, needle, "ArtistAlbumBrowser.tsx");
}

for (const needle of [
  ".artist-album-cover-flow",
  ".artist-album-cover-flow-stage",
  ".artist-album-cover-flow-card",
  ".artist-album-cover-flow-reflection",
  ".artist-album-cover-flow-info",
  ".artist-album-cover-flow-play",
  "prefers-reduced-motion:reduce",
]) {
  requireInSource(css, needle, "styles.css");
}

for (const needle of [
  "@keyframes artist-album-showcase-card-breathe",
  "@keyframes artist-album-showcase-sweep",
  "@keyframes artist-album-showcase-cover-drift",
  "@keyframes artist-album-showcase-control-pulse",
]) {
  forbidInSource(css, needle, "styles.css");
}

requireInSource(mobileCss, ".artist-album-cover-flow", "mobile.css");

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("Artist album Cover Flow checks passed");
