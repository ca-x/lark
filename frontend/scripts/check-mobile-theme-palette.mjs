import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const mobile = readFileSync(join(root, "src/mobile.css"), "utf8");
const marker = "Non-Smartisan mobile palette tokens";
const endMarker = "End non-Smartisan mobile palette tokens";
const layerStart = mobile.lastIndexOf(marker);

assert.notEqual(layerStart, -1, `mobile.css: missing ${marker} layer`);

const layerEnd = mobile.indexOf(endMarker, layerStart);
assert.notEqual(layerEnd, -1, `mobile.css: missing ${endMarker}`);

const paletteLayer = mobile.slice(layerStart, layerEnd);
const restraintStart = mobile.indexOf("Mobile theme restraint and touch polish");
const restraintEnd = restraintStart === -1 ? -1 : mobile.indexOf("\n}\n", restraintStart) + 3;

assert.notEqual(restraintStart, -1, "mobile.css: missing mobile theme restraint layer");
assert.ok(restraintEnd > restraintStart, "mobile.css: missing mobile theme restraint layer end");

const restraintLayer = mobile.slice(restraintStart, restraintEnd);
const themes = [
  "neon-console",
  "soft-vinyl",
  "gramophone",
  "indiewave",
  "editorial-pulse",
  "stage-glass",
  "blue-halo",
];
const expandedSurfaces = {
  "gramophone": ["--mobile-art-phone-bg", "--mobile-art-phone-bg-2", "--mobile-art-panel"],
  "editorial-pulse": ["--mobile-art-phone-bg", "--mobile-art-phone-bg-2"],
};

function blockFor(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\n\\s*\\}`).exec(source)?.[1] ?? "";
}

function declaration(block, property) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped}:([^;]+);`).exec(block)?.[1].trim() ?? "";
}

function rgb(hex) {
  assert.match(hex, /^#[0-9a-f]{6}$/i, `expected a six-digit hex color, received ${hex}`);
  return [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
}

function luminance(hex) {
  const channels = rgb(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground, background) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

for (const theme of themes) {
  const selector = `.app-shell[data-mobile-theme='${theme}']`;
  const block = blockFor(paletteLayer, selector);
  assert.ok(block, `mobile.css palette layer: missing ${selector}`);

  const background = declaration(block, "--mobile-ui-bg");
  const surface = declaration(block, "--mobile-ui-surface");
  const text = declaration(block, "--mobile-ui-text");
  const muted = declaration(block, "--mobile-ui-muted");
  const accent = declaration(block, "--mobile-ui-accent");
  const activeText = declaration(block, "--mobile-active-text");

  for (const [label, foreground, minimum] of [
    ["text/background", text, 4.5],
    ["muted/background", muted, 4.5],
    ["accent/background", accent, 4.5],
    ["text/surface", text, 4.5],
    ["muted/surface", muted, 4.5],
    ["accent/surface", accent, 4.5],
    ["CTA text/accent", activeText, 4.5],
  ]) {
    const comparisonBackground = label.endsWith("/surface") ? surface : label === "CTA text/accent" ? accent : background;
    const ratio = contrast(foreground, comparisonBackground);
    assert.ok(
      ratio >= minimum,
      `${theme} ${label}: ${ratio.toFixed(2)}:1 is below ${minimum}:1`,
    );
  }

  const playerBlock = blockFor(paletteLayer, `.app-shell[data-mobile-theme='${theme}'] .mobile-art-${theme}`);
  assert.ok(playerBlock, `mobile.css palette layer: missing expanded player tokens for ${theme}`);

  const playerText = declaration(playerBlock, "--mobile-art-text");
  const playerMuted = declaration(playerBlock, "--mobile-art-muted");
  const playerAccent = declaration(playerBlock, "--mobile-art-accent");
  const surfaces = (expandedSurfaces[theme] ?? ["--mobile-art-phone-bg"])
    .map((property) => [property, declaration(playerBlock, property)]);

  for (const [surfaceName, playerSurfaceColor] of surfaces) {
    for (const [label, foreground] of [
      ["text", playerText],
      ["muted", playerMuted],
    ]) {
      const ratio = contrast(foreground, playerSurfaceColor);
      assert.ok(
        ratio >= 4.5,
        `${theme} expanded ${label}/${surfaceName}: ${ratio.toFixed(2)}:1 is below 4.5:1`,
      );
    }
  }

  const playerButtonRatio = contrast(activeText, playerAccent);
  assert.ok(
    playerButtonRatio >= 4.5,
    `${theme} expanded play icon/accent: ${playerButtonRatio.toFixed(2)}:1 is below 4.5:1`,
  );

  const playerSurface = blockFor(restraintLayer, `.mobile-art-${theme} .mobile-art-phone`);
  assert.ok(playerSurface, `mobile.css restraint layer: missing expanded player surface for ${theme}`);
  assert.match(
    playerSurface,
    /background:[^;]*var\(--mobile-art-phone-bg(?:-2)?\)[^;]*!important/,
    `mobile.css restraint layer: ${theme} must consume its semantic expanded-player background`,
  );
  assert.doesNotMatch(
    playerSurface,
    /background:[^;]*#[0-9a-f]{3,8}/i,
    `mobile.css restraint layer: ${theme} must not restore a hard-coded expanded-player background`,
  );
}

const inactiveNav = blockFor(
  paletteLayer,
  ".app-shell[data-mobile-theme]:not([data-mobile-theme='smartisan-classic']) .mobile-bottom-nav button:not(.active):not(:disabled)",
);
assert.match(inactiveNav, /color:var\(--mobile-ui-muted\) !important/);

assert.doesNotMatch(
  paletteLayer,
  /\.app-shell\[data-mobile-theme='smartisan-classic'\]\s*\{/,
  "mobile.css palette layer must not override the Smartisan theme",
);
assert.doesNotMatch(
  paletteLayer,
  /\.mobile-art-smartisan-classic/,
  "mobile.css palette layer must not override the Smartisan player",
);

const finalGuardrails = mobile.slice(mobile.lastIndexOf("Final non-Smartisan palette guardrails"));
assert.ok(finalGuardrails.length < mobile.length, "mobile.css: missing final palette guardrails");
assert.match(finalGuardrails, /:not\(\[data-mobile-theme='smartisan-classic'\]\)/);
assert.doesNotMatch(finalGuardrails, /\.mobile-art-smartisan-classic/);
assert.doesNotMatch(
  finalGuardrails,
  /\.mobile-art-(?:neon-console|soft-vinyl|gramophone|indiewave|editorial-pulse|stage-glass|blue-halo)\s+\.mobile-art-phone\s*\{[\s\S]*?background:[^;]*(?:#[0-9a-f]{3,8}|rgba?\()/i,
  "mobile.css: final palette guardrails must not append a hard-coded expanded-player background",
);

const matrixStart = mobile.lastIndexOf("Theme matrix guardrails");
const matrixEnd = mobile.indexOf("Final non-Smartisan palette guardrails", matrixStart);
const matrixLayer = mobile.slice(matrixStart, matrixEnd);
const finalGramophone = blockFor(
  matrixLayer,
  ".app-shell[data-mobile-player-expanded='true']:not(.lyrics-mode) .mobile-art-player.mobile-art-gramophone",
);

assert.ok(finalGramophone, "mobile.css: missing final Gramophone readability guardrail");
for (const property of [
  "--mobile-player-title",
  "--mobile-player-secondary",
  "--mobile-player-control",
  "--mobile-player-action",
]) {
  assert.match(
    declaration(finalGramophone, property),
    /var\(--mobile-art-text\)/,
    `mobile.css: final Gramophone ${property} must consume the semantic player text token`,
  );
}
assert.doesNotMatch(
  finalGramophone,
  /#[0-9a-f]{3,8}|rgba?\(/i,
  "mobile.css: final Gramophone readability guardrail must not restore old hard-coded colors",
);

const finalIndiewaveHead = blockFor(
  finalGuardrails,
  ".app-shell[data-mobile-theme]:not([data-mobile-theme='smartisan-classic']) .mobile-home-surface[data-mobile-theme='indiewave'] .mobile-home-section-head button",
);
assert.match(finalIndiewaveHead, /color:var\(--mobile-ui-text\) !important/);

const finalPlayer = blockFor(
  finalGuardrails,
  ".app-shell[data-mobile-theme]:not([data-mobile-theme='smartisan-classic'])[data-mobile-player-expanded='true']:not(.lyrics-mode) .player > .mobile-art-player",
);
assert.ok(finalPlayer, "mobile.css: missing final non-Smartisan expanded-player palette guardrail");
for (const [property, expected] of [
  ["--mobile-player-title", "var(--mobile-art-text)"],
  ["--mobile-player-secondary", "var(--mobile-art-muted)"],
  ["--mobile-player-control", "var(--mobile-art-text)"],
  ["--mobile-player-action", "var(--mobile-art-muted)"],
  ["--mobile-player-active", "var(--mobile-art-accent)"],
  ["--mobile-player-play-bg", "var(--mobile-art-accent)"],
  ["--mobile-player-play-fg", "var(--mobile-active-text)"],
]) {
  assert.equal(
    declaration(finalPlayer, property),
    expected,
    `mobile.css: final expanded-player ${property} must use ${expected}`,
  );
}

console.log("mobile theme palette checks passed");
