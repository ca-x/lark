import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = (path) => readFileSync(join(root, path), "utf8");

const packageJson = JSON.parse(source("package.json"));
const shaderLayer = source("src/components/player-themes/PaperShaderLayer.tsx");
const app = source("src/App.tsx");
const styles = source("src/styles.css");
const mobileStyles = source("src/mobile.css");

const files = new Map([
  ["AlbumSlidePlayer.tsx", source("src/components/player-themes/AlbumSlidePlayer.tsx")],
  ["AudioScopePlayer.tsx", source("src/components/player-themes/AudioScopePlayer.tsx")],
  ["CassetteDeck.tsx", source("src/components/player-themes/CassetteDeck.tsx")],
  ["GramophonePlayer.tsx", source("src/components/player-themes/GramophonePlayer.tsx")],
  ["IpodPlayer.tsx", source("src/components/player-themes/IpodPlayer.tsx")],
  ["MineradioStagePlayer.tsx", source("src/components/player-themes/MineradioStagePlayer.tsx")],
  ["MobileArtPlayer.tsx", source("src/components/player-themes/MobileArtPlayer.tsx")],
  ["MiniCoverArt.tsx", source("src/components/player-themes/MiniCoverArt.tsx")],
  ["RunningKittenTurntable.tsx", source("src/components/player-themes/RunningKittenTurntable.tsx")],
  ["SmartisanTurntable.tsx", source("src/components/player-themes/SmartisanTurntable.tsx")],
  ["VinylTurntable.tsx", source("src/components/player-themes/VinylTurntable.tsx")],
]);

const failures = [];

function requireInSource(sourceText, needle, label) {
  if (!sourceText.includes(needle)) failures.push(`${label}: missing ${needle}`);
}

function requireDependency(name) {
  if (!packageJson.dependencies?.[name]) failures.push(`package.json: missing dependency ${name}`);
}

requireDependency("@paper-design/shaders-react");
requireInSource(JSON.stringify(packageJson.scripts || {}), "test:paper-shaders", "package.json scripts");
requireInSource(shaderLayer, 'from "@paper-design/shaders-react"', "PaperShaderLayer.tsx");
requireInSource(shaderLayer, "useReducedMotion", "PaperShaderLayer.tsx");
requireInSource(shaderLayer, "prefers-reduced-motion: reduce", "PaperShaderLayer.tsx");
requireInSource(shaderLayer, "maxPixelCount", "PaperShaderLayer.tsx");
requireInSource(shaderLayer, "data-paper-shader-variant", "PaperShaderLayer.tsx");

for (const symbol of [
  "MeshGradient",
  "GodRays",
  "GemSmoke",
  "DotOrbit",
  "DotGrid",
  "Waves",
  "Voronoi",
  "FlutedGlass",
  "LiquidMetal",
  "SmokeRing",
  "Dithering",
  "HalftoneDots",
  "PulsingBorder",
]) {
  requireInSource(shaderLayer, symbol, "PaperShaderLayer.tsx");
}

for (const variant of [
  "album-slide",
  "audio-scope",
  "vinyl",
  "cassette",
  "ipod",
  "smartisan",
  "gramophone",
  "running-kitten",
  "mineradio",
  "mini",
  "player-mood",
  "lyrics",
  "mobile-neon-console",
  "mobile-indiewave",
  "mobile-editorial-pulse",
  "mobile-soft-vinyl",
  "mobile-gramophone",
  "mobile-stage-glass",
  "mobile-blue-halo",
  "mobile-smartisan-classic",
]) {
  requireInSource(shaderLayer, variant, "PaperShaderLayer.tsx");
  requireInSource(styles + mobileStyles, `paper-shader-${variant}`, "styles");
}

for (const [fileName, sourceText] of files.entries()) {
  requireInSource(sourceText, "PaperShaderLayer", fileName);
}

for (const [fileName, variant] of [
  ["AlbumSlidePlayer.tsx", 'variant="album-slide"'],
  ["AudioScopePlayer.tsx", 'variant="audio-scope"'],
  ["CassetteDeck.tsx", 'variant="cassette"'],
  ["GramophonePlayer.tsx", 'variant="gramophone"'],
  ["IpodPlayer.tsx", 'variant="ipod"'],
  ["MineradioStagePlayer.tsx", 'variant="mineradio"'],
  ["MiniCoverArt.tsx", 'variant="mini"'],
  ["RunningKittenTurntable.tsx", 'variant="running-kitten"'],
  ["SmartisanTurntable.tsx", 'variant="smartisan"'],
  ["VinylTurntable.tsx", 'variant="vinyl"'],
]) {
  requireInSource(files.get(fileName), variant, fileName);
}

requireInSource(files.get("MobileArtPlayer.tsx"), "variant={`mobile-${variant}`}", "MobileArtPlayer.tsx");
requireInSource(files.get("AlbumSlidePlayer.tsx"), "album-slide-panel-shader", "AlbumSlidePlayer.tsx");
requireInSource(app, 'variant="lyrics"', "App.tsx");
requireInSource(app, 'variant="player-mood"', "App.tsx");
requireInSource(app, 'variant="mini"', "App.tsx");
requireInSource(app, "lyrics-depth-stage", "App.tsx");
requireInSource(styles, ".paper-shader-layer", "styles.css");
requireInSource(styles, ".paper-shader-canvas", "styles.css");
requireInSource(styles, "prefers-reduced-motion: reduce", "styles.css");
requireInSource(styles, ".paper-shader-canvas { display:none !important; }", "styles.css");
requireInSource(styles, ":where(\n  .album-slide-player", "styles.css");
requireInSource(styles, ") > :where(:not(.paper-shader-layer))", "styles.css");
requireInSource(styles, ".album-slide-panel > .paper-shader-album-slide", "styles.css");
requireInSource(styles, ".album-slide-panel > :not(.paper-shader-layer)", "styles.css");
if (styles.includes(":is(\n  .album-slide-player")) {
  failures.push("styles.css: paper shader stacking rule must stay low-specificity so album sleeve absolute layers remain visible");
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("Paper shader effect checks passed");
