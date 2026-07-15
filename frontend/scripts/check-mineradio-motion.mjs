import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const component = readFileSync(join(root, "src/components/player-themes/MineradioStagePlayer.tsx"), "utf8");
const app = readFileSync(join(root, "src/App.tsx"), "utf8");
const css = readFileSync(join(root, "src/styles.css"), "utf8");
const mobileCss = readFileSync(join(root, "src/mobile.css"), "utf8");
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
  "mineradio-stage-splash-canvas",
  "mineradio-stage-splash-streaks",
  "mineradio-stage-splash-shards",
  "mineradio-stage-smoke",
  "mineradio-stage-light-slit",
  "mineradio-stage-spectrum",
  "mineradio-stage-cover-cloud",
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
  "useMineradioSplashShader",
  "mineradioSplashFragmentShader",
  "animatedLoop",
  "data-mineradio-splash-shader",
  "gestureRotation",
  "particleSpin",
  "applyParticleSpinDrag",
  "data-cover-gesture",
  "drag-inertia",
  "makeShelfExtras",
  "data-shelf-extras",
  "data-shelf-hit-layer",
  "audioElement",
  "makeAudioAnalyser",
  "analyserRetryAt",
  "captureStream",
  "data-audio-reactive",
  "data-cover-particles",
  "data-cover-dom-particles",
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
  "--mineradio-lyric-solar",
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
  "data-webgl-unavailable",
  "THREE.NormalBlending",
  "THREE.AdditiveBlending",
]) {
  requireInSource(component, needle, "MineradioStagePlayer.tsx");
}

for (const needle of [
  'home-view home-view-mineradio',
  'data-mineradio-home="true"',
]) {
  requireInSource(app, needle, "App.tsx Mineradio full-stage branch");
}

for (const needle of [
  'data-cover-renderer="webgl-primary"',
  "data-splash-ready",
  "performance.now()",
  "playingRef.current",
  'getContext("webgl2"',
]) {
  requireInSource(component, needle, "MineradioStagePlayer.tsx full-stage contract");
}

for (const needle of [
  ".app-shell:has(.home-view-mineradio)",
  ".home-view-mineradio",
  ".mineradio-stage-edge-nav",
  "@media (hover:hover) and (pointer:fine)",
]) {
  requireInSource(css, needle, "styles.css Mineradio takeover");
}

for (const needle of [
  "lyrics-depth-stage",
  "lyrics-depth-cover",
  "lyrics-depth-particles",
  "LYRICS_DEPTH_PARTICLES",
  "LYRICS_DISPLAY_STYLE_OPTIONS",
  "folia-monet",
  "folia-fume",
  "folia-tilt",
  "folia-cadenza",
  "lyrics-folia-poster",
  "lyrics-folia-fume-paper",
  "lyrics-folia-tilt-field",
  "lyrics-folia-cadenza-field",
  "renderLyricLineText",
]) {
  requireInSource(app, needle, "App.tsx");
}

for (const needle of [
  "控制全屏歌词界面的视觉效果",
  "Folia 海报",
  "首页暗场电台效果",
  "full-screen lyrics view",
  "Folia Poster",
  "Home Mineradio effects",
]) {
  requireInSource(i18n, needle, "i18n.ts");
}

for (const needle of [
  "@keyframes mineradio-stage-card-breathe",
  "@keyframes mineradio-stage-lyric-river",
  "@keyframes mineradio-stage-signal-sweep",
  "mineradio-stage-card-selected-pulse",
  "mineradio-stage-splash-particle",
  "mineradio-stage-splash-streak",
  "mineradio-stage-splash-shard",
  ".mineradio-stage-splash-canvas",
  ".mineradio-stage-player[data-cover-gesture='dragging']",
  "@keyframes mineradio-stage-smoke-drift",
  "@keyframes mineradio-stage-slit-breathe",
  "@keyframes mineradio-stage-spectrum-live",
  "@keyframes mineradio-stage-cover-cloud-orbit",
  "@keyframes mineradio-stage-cover-cloud-drift",
  "@keyframes mineradio-stage-lyric-reveal",
  ".mineradio-stage-player[data-webgl-unavailable='true']",
  ".mineradio-stage-player[data-audio-reactive='true']",
  ".lyrics-depth-stage",
  "[data-folia-mode='true']",
  "lyrics-folia-poster-float",
  "lyrics-folia-glyph-spark",
  "@keyframes lyrics-depth-cover-orbit",
  "@keyframes lyrics-depth-ring-pulse",
  "@keyframes lyrics-depth-particle-drift",
  "@keyframes lyrics-folia-smoke",
  "prefers-reduced-motion: reduce",
]) {
  requireInSource(css, needle, "styles.css");
}

for (const needle of [
  ".full-lyrics[data-folia-mode='true']",
  ".segmented-control.lyrics-style-control",
]) {
  requireInSource(mobileCss, needle, "mobile.css");
}

for (const [source, label] of [
  [component, "MineradioStagePlayer.tsx"],
  [css, "styles.css"],
]) {
  forbidInSource(source, "mineradio-stage-empty-shelf", label);
  forbidInSource(source, "makeGhostShelfCard", label);
}

forbidInSource(component, "new THREE.Clock()", "MineradioStagePlayer.tsx");

const mineradioComponentUsages = app.match(/<MineradioStagePlayer\b/g) || [];
if (mineradioComponentUsages.length !== 1) {
  failures.push(`App.tsx Mineradio full-stage branch: expected 1 MineradioStagePlayer usage, found ${mineradioComponentUsages.length}`);
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("Mineradio motion checks passed");
