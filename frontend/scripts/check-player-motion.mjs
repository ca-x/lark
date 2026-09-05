import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const styles = readFileSync(join(root, "src/styles.css"), "utf8");
const mobile = readFileSync(join(root, "src/mobile.css"), "utf8");
const app = readFileSync(join(root, "src/App.tsx"), "utf8");
const mobileHome = readFileSync(join(root, "src/components/mobile/MobileHomeSurface.tsx"), "utf8");

for (const style of [
  "vinyl",
  "cassette",
  "ipod",
  "audio-scope",
  "album-slide",
  "smartisan-turntable",
  "gramophone",
  "running-kitten",
  "mineradio-stage",
  "walkman",
  "singularity",
]) {
  requireSource(app, `data-player-style="${style}"`, `App.tsx desktop player picker ${style}`);
  requireSource(styles, `button[data-player-style='${style}']`, `styles.css desktop player picker ${style}`);
}

function requireSource(source, needle, label) {
  assert.ok(source.includes(needle), `${label}: missing ${needle}`);
}

function blockFor(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\n\\s*\\}`).exec(source)?.[1] ?? "";
}

requireSource(styles, "Reduced-motion playback cues", "styles.css");
for (const selector of [
  ".vinyl-component[data-playing='true'] .vinyl-record",
  ".running-kitten-player[data-playing='true'] .running-kitten-record",
  ".mineradio-stage-player[data-playing='true'] .mineradio-stage-disc",
  ".cassette-component[data-playing='true'] .cassette-hub",
  ".ipod-component[data-playing='true'] .ipod-eq-row i",
  ".audio-scope-player[data-playing='true'] .audio-scope-disc",
  ".album-slide-player[data-playing='true'] .album-slide-vinyl",
  ".smartisan-turntable-player[data-playing='true'] .smartisan-turntable-record",
  ".gramophone-player[data-playing='true'] .gramophone-record",
]) {
  requireSource(styles, selector, "styles.css reduced-motion playback cues");
}

requireSource(mobile, "Reduced-motion mobile playback cues", "mobile.css");
requireSource(
  mobile,
  "(max-width:960px) and (max-height:500px) and (orientation:landscape)",
  "mobile.css landscape mobile breakpoint",
);
for (const selector of [
  ".mobile-art-player[data-playing='true'] .mobile-pa-vinyl",
  ".mobile-art-player[data-playing='true'] .mobile-soft-record",
  ".mobile-gramophone-stage[data-playing='true'] .mobile-gramophone-record",
  ".mobile-indie-stack[data-playing='true'] .mobile-indie-vinyl",
  ".mobile-editorial-visual[data-playing='true'] .mobile-editorial-ipod-eq i",
  ".mobile-stage-visual[data-playing='true'] .mobile-stage-disc",
  ".mobile-blue-visual[data-playing='true'] .mobile-blue-cassette-window .reel",
  ".mobile-art-player.mobile-art-smartisan-classic[data-playing='true'] .mobile-smartisan-rotor",
]) {
  requireSource(mobile, selector, "mobile.css reduced-motion playback cues");
}

const finalPolish = mobile.slice(mobile.lastIndexOf("Mobile theme restraint and touch polish"));
assert.ok(finalPolish.length < mobile.length, "mobile.css: missing final mobile polish block");
for (const needle of [
  "min-width:44px !important",
  "min-height:44px !important",
  "transform:scaleY",
  "backdrop-filter:none !important",
]) {
  requireSource(finalPolish, needle, "mobile.css final polish");
}
assert.match(
  blockFor(finalPolish, ".mobile-home-section-head button"),
  /min-height:44px !important/,
  "mobile.css: mobile home section actions need a 44px touch target",
);

const coarseDesktopPlayer = styles.slice(
  styles.lastIndexOf("@media (min-width:721px) and (pointer:coarse)"),
);
assert.ok(coarseDesktopPlayer.length < styles.length, "styles.css: missing coarse-pointer compact desktop player guard");
for (const needle of [
  "display:flex",
  "flex-wrap:wrap",
  "width:44px",
  "min-width:44px",
  "height:44px",
  "min-height:44px",
]) {
  requireSource(coarseDesktopPlayer, needle, "styles.css coarse-pointer compact desktop player");
}
for (const needle of [
  ".volume:has(.cast-toggle)",
  "grid-template-columns:repeat(6,36px) 18px",
  "grid-template-columns:repeat(6,32px) 18px minmax(40px,46px)",
]) {
  requireSource(styles, needle, "styles.css optional cast compact desktop player");
}
requireSource(
  styles,
  "@media (min-width:721px) and (max-width:820px) and (min-height:501px) and (max-height:700px)",
  "styles.css narrow short-window player guard",
);
requireSource(
  styles,
  "@media (min-width:1181px) and (max-height:700px)",
  "styles.css wide short-window player guard",
);

const liveLyrics = blockFor(
  mobile,
  ".app-shell.lyrics-mode .full-lyrics[data-display-style='immersive'] .full-lyrics-lines p.live .lyric-line-text",
);
assert.ok(liveLyrics, "mobile.css: immersive live lyric block missing");
assert.doesNotMatch(liveLyrics, /background-clip:text|-webkit-text-fill-color:transparent/);
const liveLyricsProgress = blockFor(
  mobile,
  ".app-shell.lyrics-mode .full-lyrics[data-display-style='immersive'] .full-lyrics-lines p.live .lyric-line-text::after",
);
assert.match(liveLyricsProgress, /color:var\(--lyrics-live-mid\)/);
assert.match(liveLyricsProgress, /clip-path:inset\(0 calc\(100% - var\(--lyric-progress, 100%\)\) 0 0\)/);
assert.match(app, /className="lyric-line-text" data-text=\{line\.text\}/);

assert.match(
  mobileHome,
  /aria-label=\{`\$\{t\("playAll"\)\}: \$\{t\("dailyRecommendedSongs"\)\}`\}/,
  "MobileHomeSurface.tsx: the daily-mix play action needs a localized accessible name",
);

console.log("player motion and mobile theme checks passed");
