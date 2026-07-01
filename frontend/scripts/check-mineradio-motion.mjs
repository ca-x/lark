import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const component = readFileSync(join(root, "src/components/player-themes/MineradioStagePlayer.tsx"), "utf8");
const app = readFileSync(join(root, "src/App.tsx"), "utf8");
const artistAlbumBrowser = readFileSync(join(root, "src/components/ArtistAlbumBrowser.tsx"), "utf8");
const css = readFileSync(join(root, "src/styles.css"), "utf8");
const i18n = readFileSync(join(root, "src/i18n.ts"), "utf8");

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
  "mineradio-stage-smoke",
  "mineradio-stage-light-slit",
  "mineradio-stage-spectrum",
  "mineradio-stage-lyric-river",
  "mineradio-stage-lyric-glow",
  "data-has-shelf",
  "--shelf-delta",
  "data-motion-card",
  "data-webgl-unavailable",
  "cyanBeamSweep",
  "goldBeamSweep",
  "makeLightBeamMotion",
  "animateLightBeamGeometry",
  "beamSweepPulse",
  "audioElement",
  "makeAudioAnalyser",
  "analyserRetryAt",
  "captureStream",
  "data-audio-reactive",
  "data-cover-particles",
  "data-cover-shader",
  "data-cover-depth",
  "data-cover-crossfade",
  "data-cover-grid",
  "loadCoverParticlePayload",
  "makeCoverParticlePayloadFromImage",
  "makeCoverEdgeDepthTexture",
  "makeTextureFromCoverCanvas",
  "makeCoverParticleShaderMaterial",
  "coverParticleVertexShader",
  "coverParticleFragmentShader",
  "makeCoverParticleUniforms",
  "syncCoverParticleUniforms",
  "averageFrequencyBand",
  "COVER_RIPPLE_COUNT = 12",
  "COVER_RIPPLE_REGIONS",
  "triggerCoverRegionRipples",
  "tickCoverRippleUniforms",
  "uCoverTex",
  "uPrevCoverTex",
  "uColorMixT",
  "uEdgeTex",
  "uHasDepth",
  "uEdgeEnabled",
  "uRipples",
  "uBloomLayer",
  "uVocal",
  "aUv",
  "aEdge",
  "aDepth",
  "coverParticles",
  "coverBloomParticles",
  "THREE.NormalBlending",
  "THREE.AdditiveBlending",
]) {
  requireInSource(component, needle, "MineradioStagePlayer.tsx");
}

for (const needle of [
  "lyrics-depth-stage",
  "lyrics-depth-cover",
  "lyrics-depth-particles",
  "LYRICS_DEPTH_PARTICLES",
]) {
  requireInSource(app, needle, "App.tsx");
}

for (const needle of [
  "控制全屏歌词界面的视觉效果",
  "首页暗场电台效果",
  "full-screen lyrics view",
  "Home Mineradio effects",
]) {
  requireInSource(i18n, needle, "i18n.ts");
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
  "@keyframes mineradio-stage-smoke-drift",
  "@keyframes mineradio-stage-slit-breathe",
  "@keyframes mineradio-stage-spectrum-live",
  "@keyframes mineradio-stage-lyric-reveal",
  ".mineradio-stage-player[data-audio-reactive='true']",
  ".lyrics-depth-stage",
  "@keyframes lyrics-depth-cover-orbit",
  "@keyframes lyrics-depth-ring-pulse",
  "@keyframes lyrics-depth-particle-drift",
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
