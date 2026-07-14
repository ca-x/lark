import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = readFileSync(join(root, "src/App.tsx"), "utf8");
const browser = readFileSync(join(root, "src/components/ArtistAlbumBrowser.tsx"), "utf8");
const i18n = readFileSync(join(root, "src/i18n.ts"), "utf8");
const css = readFileSync(join(root, "src/styles.css"), "utf8");
const mobileCss = readFileSync(join(root, "src/mobile.css"), "utf8");
const readme = readFileSync(join(root, "../README.md"), "utf8");
const readmeZh = readFileSync(join(root, "../README_ZH.md"), "utf8");
const notice = readFileSync(join(root, "../NOTICE.md"), "utf8");
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

const referenceUrl = "https://github.com/opc8838-hub/cover-flow-showcase";
requireInSource(readme, referenceUrl, "README.md");
requireInSource(readmeZh, referenceUrl, "README_ZH.md");
requireInSource(notice, referenceUrl, "NOTICE.md");
requireInSource(notice, "cover-flow-showcase by opc8838-hub, licensed under MIT", "NOTICE.md");
requireInSource(notice, "eda6308e7e936a0d51b3602640dd870ce76693bd", "NOTICE.md");
requireInSource(notice, "Permission is hereby granted, free of charge", "NOTICE.md");
requireInSource(notice, 'THE SOFTWARE IS PROVIDED "AS IS"', "NOTICE.md");

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("Artist album Cover Flow checks passed");
