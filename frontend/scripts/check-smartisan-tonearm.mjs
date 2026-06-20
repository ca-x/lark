import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

const checks = [
  {
    file: "src/styles.css",
    prefix: "smartisan-turntable",
    hubX: "--smartisan-turntable-needle-hub-x",
    hubY: "--smartisan-turntable-needle-hub-y",
  },
  {
    file: "src/mobile.css",
    prefix: "mobile-smartisan",
    hubX: "--mobile-smartisan-needle-hub-x",
    hubY: "--mobile-smartisan-needle-hub-y",
  },
];

function blockFor(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\n\\s*\\}`).exec(css)?.[1] ?? "";
}

function requireIncludes(file, block, needle, label) {
  if (!block.includes(needle)) failures.push(`${file}: ${label} must include ${needle}`);
}

for (const check of checks) {
  const css = readFileSync(join(root, check.file), "utf8");

  if (/playing-stylus-lp(?:-bg|-top)?-original\.png/.test(css)) {
    failures.push(`${check.file}: Smartisan tonearm must not use original stylus PNGs with opaque edge pixels`);
  }

  const arm = blockFor(css, `.${check.prefix}-needle-arm`);
  requireIncludes(check.file, arm, "playing-stylus-lp.png", "tonearm arm asset");
  requireIncludes(check.file, arm, `transform-origin:var(${check.hubX}) var(${check.hubY})`, "tonearm arm origin");

  const shadow = blockFor(css, `.${check.prefix}-needle-shadow`);
  requireIncludes(check.file, shadow, `transform-origin:var(${check.hubX}) var(${check.hubY})`, "tonearm shadow origin");

  for (const part of ["base", "top"]) {
    const block = blockFor(css, `.${check.prefix}-needle-${part}`);
    requireIncludes(check.file, block, `left:var(${check.hubX})`, `tonearm ${part} horizontal center`);
    requireIncludes(check.file, block, `top:var(${check.hubY})`, `tonearm ${part} vertical center`);
    requireIncludes(check.file, block, "transform:translate(-50%, -50%)", `tonearm ${part} center transform`);
  }
}

const mobileCss = readFileSync(join(root, "src/mobile.css"), "utf8");
if (!mobileCss.includes("background:linear-gradient(180deg,#58c976,#2ea85d) !important")) {
  failures.push("src/mobile.css: Smartisan mobile active volume bars must render green in the final override");
}
if (!mobileCss.includes("[data-playing='true'] .mobile-art-volume-bars i.active")) {
  failures.push("src/mobile.css: Smartisan mobile active volume pulse must be gated by data-playing='true'");
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("Smartisan tonearm CSS checks passed");
