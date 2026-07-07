import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(root, "..");

const component = readFileSync(join(root, "src/components/player-themes/WalkmanPlayer.tsx"), "utf8");
const index = readFileSync(join(root, "src/components/player-themes/index.ts"), "utf8");
const paperShader = readFileSync(join(root, "src/components/player-themes/PaperShaderLayer.tsx"), "utf8");
const app = readFileSync(join(root, "src/App.tsx"), "utf8");
const types = readFileSync(join(root, "src/types.ts"), "utf8");
const i18n = readFileSync(join(root, "src/i18n.ts"), "utf8");
const css = readFileSync(join(root, "src/styles.css"), "utf8");
const backendLibrary = readFileSync(join(repo, "backend/internal/library/service.go"), "utf8");
const readme = readFileSync(join(repo, "README.md"), "utf8");
const readmeZh = readFileSync(join(repo, "README_ZH.md"), "utf8");
const notice = readFileSync(join(repo, "NOTICE.md"), "utf8");

for (const needle of [
  "createWalkmanScene",
  "class DotDisplay",
  "class WalkmanModel",
  "WalkmanRotationOffset",
  "rotationDrag",
  "targetRotationOffset",
  "clampWalkmanRotation",
  "RoundedBoxGeometry",
  "webglUnavailable",
  "hasWebGLSupport",
  "Walkman 3D player",
]) {
  assert.match(component, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `WalkmanPlayer.tsx missing ${needle}`);
}

assert.match(index, /export \{ WalkmanPlayer \} from "\.\/WalkmanPlayer";/);
assert.match(paperShader, /\|\s+"walkman"/);
assert.match(paperShader, /case "walkman":/);
assert.match(types, /"mineradio-stage"\s+\|\s+"walkman"/);
assert.match(app, /WalkmanPlayer/);
assert.match(app, /homePlayerStyle === "walkman"/);
assert.match(app, /onHomePlayerStyleChange\("walkman"\)/);
assert.match(i18n, /homePlayerWalkman/);
assert.match(css, /\.hero\.walkman-hero/);
assert.match(css, /\.walkman-player/);
assert.match(css, /prefers-reduced-motion: reduce/);
assert.match(css, /\.walkman-canvas\s*\{[\s\S]*touch-action:none;/);
assert.match(backendLibrary, /"mineradio-stage", "walkman"/);
assert.match(readme, /https:\/\/github\.com\/GordenSun\/Walkman/);
assert.match(readmeZh, /https:\/\/github\.com\/GordenSun\/Walkman/);
assert.match(notice, /https:\/\/github\.com\/GordenSun\/Walkman/);

console.log("walkman theme checks passed");
