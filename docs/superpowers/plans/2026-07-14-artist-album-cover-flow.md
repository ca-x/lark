# Artist Album Cover Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a saved grid/Cover Flow switch to artist album pages and replace the existing showcase with a responsive, accessible 3D Cover Flow adapted from `opc8838-hub/cover-flow-showcase`.

**Architecture:** Keep `CollectionView` as the preference-aware toolbar owner and `ArtistAlbumBrowser` as the classic/showcase boundary. Rebuild only the showcase branch with one album list, ref-backed circular position state, requestAnimationFrame gesture updates, and CSS-rendered depth/reflections; retain the existing preference API and album open/play callbacks.

**Tech Stack:** React 19, TypeScript 6, Phosphor Icons, CSS 3D transforms, Vite 8, Node static regression scripts, Go embedded frontend.

## Global Constraints

- Keep `ArtistAlbumDisplayStyle = "classic" | "showcase"`; do not add a backend migration or preference field.
- Keep classic grid as the default and preserve existing local/server preference synchronization.
- Add no animation or UI dependency.
- Adapt reference commit `eda6308e7e936a0d51b3602640dd870ce76693bd`; do not copy demo images, video, or unrelated navigation assets.
- Require intentional drag/touch/wheel/button/keyboard input; ordinary mouse movement must not navigate.
- Animate only `transform`, `opacity`, and restrained `filter`; never use `transition: all`.
- Respect `prefers-reduced-motion` and keep keyboard navigation immediate.
- Release as `v0.9.37` only after frontend, backend, browser, version, diff, and release checks pass.

## File Map

- Modify `frontend/src/App.tsx`: import view icons, pass the preference setter into `CollectionView`, and render the Albums-tab view switcher.
- Modify `frontend/src/i18n.ts`: rename the showcase label to Cover Flow and add toolbar/accessibility strings in Chinese and English.
- Modify `frontend/src/components/ArtistAlbumBrowser.tsx`: replace the triplicated scroll-snap showcase with the circular Cover Flow engine while preserving the classic card path.
- Modify `frontend/src/styles.css`: add the toolbar and desktop Cover Flow styles; remove permanent showcase animation keyframes.
- Modify `frontend/src/mobile.css`: make the toolbar and Cover Flow geometry touch-safe and responsive.
- Create `frontend/scripts/check-artist-cover-flow.mjs`: dedicated static regression coverage for UI wiring, motion paths, reduced motion, removed loops, and attribution.
- Modify `frontend/scripts/check-mineradio-motion.mjs`: remove artist-album assertions that do not belong to the Mineradio feature.
- Modify `frontend/package.json`: register the dedicated test and later bump the release version.
- Modify `README.md`, `README_ZH.md`, `NOTICE.md`: attribute the MIT reference implementation.
- Modify `CHANGELOG.md`: add bilingual `0.9.37` release notes.
- Regenerate `backend/web/dist`: embed the verified frontend build.

---

### Task 1: In-page artist album view switcher

**Files:**
- Create: `frontend/scripts/check-artist-cover-flow.mjs`
- Modify: `frontend/scripts/check-mineradio-motion.mjs`
- Modify: `frontend/package.json`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/i18n.ts`
- Modify: `frontend/src/styles.css`
- Modify: `frontend/src/mobile.css`

**Interfaces:**
- Consumes: existing `artistAlbumDisplayStyle: ArtistAlbumDisplayStyle` and `setArtistAlbumDisplayStyle` state setter in `App`.
- Produces: `CollectionView` prop `onArtistAlbumDisplayStyleChange: (style: ArtistAlbumDisplayStyle) => void` and DOM marker `.artist-album-view-switcher`.

- [ ] **Step 1: Add the failing toolbar regression check**

Create `frontend/scripts/check-artist-cover-flow.mjs` with source readers, `requireInSource`, and this first requirement set:

```js
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = readFileSync(join(root, "src/App.tsx"), "utf8");
const i18n = readFileSync(join(root, "src/i18n.ts"), "utf8");
const css = readFileSync(join(root, "src/styles.css"), "utf8");
const mobileCss = readFileSync(join(root, "src/mobile.css"), "utf8");
const failures = [];

function requireInSource(source, needle, label) {
  if (!source.includes(needle)) failures.push(`${label}: missing ${needle}`);
}

for (const needle of [
  "onArtistAlbumDisplayStyleChange",
  "artist-album-view-switcher",
  'aria-pressed={artistAlbumDisplayStyle === "classic"}',
  'aria-pressed={artistAlbumDisplayStyle === "showcase"}',
]) requireInSource(app, needle, "App.tsx");

for (const needle of [
  "artistAlbumViewLabel",
  "artistAlbumDisplayClassic",
  "artistAlbumDisplayShowcase",
  "封面流",
  "Cover Flow",
]) requireInSource(i18n, needle, "i18n.ts");

requireInSource(css, ".artist-album-view-switcher", "styles.css");
requireInSource(mobileCss, ".artist-album-view-switcher", "mobile.css");

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("Artist album Cover Flow checks passed");
```

Add `"test:artist-cover-flow": "node scripts/check-artist-cover-flow.mjs"` to `frontend/package.json`. Remove `artistAlbumBrowser`, its three source assertions, and the three artist showcase keyframe assertions from `check-mineradio-motion.mjs` so the Mineradio check remains feature-scoped.

- [ ] **Step 2: Run the new check and verify it fails for the missing toolbar**

Run: `cd frontend && pnpm test:artist-cover-flow`

Expected: non-zero with missing `onArtistAlbumDisplayStyleChange`, `artist-album-view-switcher`, and localized Cover Flow strings.

- [ ] **Step 3: Wire the setter and render the segmented control**

In `App.tsx`:

```tsx
import { CardsThree, SquaresFour } from "@phosphor-icons/react";
```

Pass the setter at the `CollectionView` call:

```tsx
artistAlbumDisplayStyle={artistAlbumDisplayStyle}
onArtistAlbumDisplayStyleChange={setArtistAlbumDisplayStyle}
```

Add the prop to the `CollectionView` parameter/type blocks. Replace the artist tabs wrapper with:

```tsx
<div className="artist-collection-toolbar">
  <div className="collection-tabs">
    <button className={artistView === "songs" ? "active" : ""} onClick={() => setArtistView("songs")}>{t("songs")}</button>
    <button className={artistView === "albums" ? "active" : ""} onClick={() => setArtistView("albums")}>{t("albums")}</button>
  </div>
  {artistView === "albums" ? (
    <div className="artist-album-view-switcher" role="group" aria-label={t("artistAlbumViewLabel")}>
      <button
        type="button"
        className={artistAlbumDisplayStyle === "classic" ? "active" : ""}
        aria-pressed={artistAlbumDisplayStyle === "classic"}
        title={t("artistAlbumDisplayClassic")}
        onClick={() => onArtistAlbumDisplayStyleChange("classic")}
      >
        <SquaresFour aria-hidden="true" />
        <span>{t("artistAlbumDisplayClassic")}</span>
      </button>
      <button
        type="button"
        className={artistAlbumDisplayStyle === "showcase" ? "active" : ""}
        aria-pressed={artistAlbumDisplayStyle === "showcase"}
        title={t("artistAlbumDisplayShowcase")}
        onClick={() => onArtistAlbumDisplayStyleChange("showcase")}
      >
        <CardsThree aria-hidden="true" />
        <span>{t("artistAlbumDisplayShowcase")}</span>
      </button>
    </div>
  ) : null}
</div>
```

Add Chinese `artistAlbumViewLabel: "专辑视图"`, change the Chinese showcase label to `"封面流"`, add English `artistAlbumViewLabel: "Album view"`, and change the English showcase label to `"Cover Flow"`.

Add CSS for `.artist-collection-toolbar` and `.artist-album-view-switcher` using flex layout, theme tokens, explicit `transform 140ms cubic-bezier(.23,1,.32,1)` press feedback, visible `:focus-visible`, and a mobile rule that keeps the tabs and switcher on separate full-width rows without hiding labels.

- [ ] **Step 4: Run focused checks**

Run:

```bash
cd frontend
pnpm test:artist-cover-flow
pnpm test:mineradio-motion
pnpm lint
```

Expected: all three commands exit 0.

- [ ] **Step 5: Commit the working switcher**

```bash
git add frontend/src/App.tsx frontend/src/i18n.ts frontend/src/styles.css frontend/src/mobile.css frontend/scripts/check-artist-cover-flow.mjs frontend/scripts/check-mineradio-motion.mjs frontend/package.json
git commit -m "feat: add artist album view switcher"
```

### Task 2: Circular Cover Flow motion engine

**Files:**
- Modify: `frontend/scripts/check-artist-cover-flow.mjs`
- Modify: `frontend/src/components/ArtistAlbumBrowser.tsx`

**Interfaces:**
- Consumes: `albums`, `resetKey`, `t`, `onOpenAlbum`, and `onPlayAlbum` from `ArtistAlbumBrowserProps`.
- Produces: a single-list `.artist-album-cover-flow` stage with active index semantics and explicit open/play paths.

- [ ] **Step 1: Extend the regression check for the new engine**

Read `ArtistAlbumBrowser.tsx` in the check and require:

```js
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
]) requireInSource(browser, needle, "ArtistAlbumBrowser.tsx");

for (const needle of [
  "[...albums, ...albums, ...albums]",
  "scrollCardIntoCenter",
  "onScroll={updateIndex}",
]) forbidInSource(browser, needle, "ArtistAlbumBrowser.tsx");
```

Add `forbidInSource` to the checker.

- [ ] **Step 2: Run the check and verify it fails on the old showcase**

Run: `cd frontend && pnpm test:artist-cover-flow`

Expected: non-zero for missing circular engine markers and forbidden triplication/scroll code.

- [ ] **Step 3: Replace `ArtistAlbumShowcase` with the single-list engine**

Implement these exact primitives inside `ArtistAlbumShowcase`:

```tsx
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const wrapIndex = (index: number) => ((index % albums.length) + albums.length) % albums.length;
const wrapPosition = (value: number) => ((value % albums.length) + albums.length) % albums.length;
```

Use refs for `stageRef`, `cardRefs`, `positionRef`, `targetRef`, `activeIndexRef`, `animationFrameRef`, `settleTimerRef`, and a pointer object containing `pointerId`, `startX`, `lastX`, `dragging`, and `moved`. Initialize active/position from index zero whenever `albums` or `resetKey` changes.

Derive the semantic active item with `const activeAlbum = albums[activeIndex];` and guard open/play calls when it is absent.

`styleCards(nextPosition)` must:

1. read stage/card dimensions;
2. compute the shortest circular offset for each album;
3. compute side, absolute distance, first-gap and trail-gap positions from measured geometry;
4. set each card's `transform` to `translate3d(x, y, z) rotateY(angle) scale(scale)`;
5. set only `zIndex`, `opacity`, and `filter` in addition to transform;
6. mark the rounded card with `data-active="true"` and all others false.

Use the reference's bounded settle behavior without hover navigation:

```tsx
function animateToTarget() {
  if (reduceMotionRef.current) {
    syncPosition(targetRef.current);
    return;
  }
  if (animationFrameRef.current !== null) return;
  const tick = () => {
    let delta = targetRef.current - positionRef.current;
    if (delta > albums.length / 2) delta -= albums.length;
    if (delta < -albums.length / 2) delta += albums.length;
    if (Math.abs(delta) < 0.002) {
      syncPosition(targetRef.current);
      animationFrameRef.current = null;
      return;
    }
    positionRef.current = wrapPosition(positionRef.current + delta * 0.18);
    styleCards(positionRef.current);
    animationFrameRef.current = window.requestAnimationFrame(tick);
  };
  animationFrameRef.current = window.requestAnimationFrame(tick);
}
```

Pointer movement must do nothing until a primary-button/touch pointer down starts the gesture. After a 4px threshold, capture the pointer and set `data-dragging="true"`. Update position by `-delta / Math.max(cardWidth * 0.72, 150)` and prevent default only after horizontal drag intent is established. On release/cancel, release capture, clear dragging state, and settle to `Math.round(positionRef.current)`.

Wheel uses the dominant axis, clamps it to `[-240, 240]`, calls `push(delta / 230)`, and schedules settle after 170ms. Keyboard uses immediate `syncPosition` for arrows, `onOpenAlbum?.(activeAlbum)` for Enter, and `onPlayAlbum?.(activeAlbum)` for Space.

Render one `albums.map` card list. Side-card click calls `syncPosition(index)`; active-card click calls `onOpenAlbum`. Put a separate play button outside the cover button and target `onPlayAlbum`. Render dots at `albums.length <= 12`, otherwise render `<span className="artist-album-cover-flow-count">{activeIndex + 1} / {albums.length}</span>`.

Use a media-query listener for reduced motion and a `ResizeObserver` to rerun `styleCards(positionRef.current)`. Cleanup both listeners, animation frame, settle timer, and transient pointer state.

- [ ] **Step 4: Run engine checks and type/build validation**

Run:

```bash
cd frontend
pnpm test:artist-cover-flow
pnpm lint
pnpm build
```

Expected: all commands exit 0; the build updates `backend/web/dist`.

- [ ] **Step 5: Commit the motion engine**

```bash
git add frontend/src/components/ArtistAlbumBrowser.tsx frontend/scripts/check-artist-cover-flow.mjs backend/web/dist
git commit -m "feat: port artist album cover flow"
```

### Task 3: Cover Flow visual system, mobile behavior, and reduced motion

**Files:**
- Modify: `frontend/scripts/check-artist-cover-flow.mjs`
- Modify: `frontend/src/styles.css`
- Modify: `frontend/src/mobile.css`

**Interfaces:**
- Consumes: DOM classes and `data-active`/`data-dragging` states from Task 2.
- Produces: responsive square-cover geometry, liquid-glass stage, reflection, focus, touch, and reduced-motion behavior.

- [ ] **Step 1: Extend the regression check for visual and motion constraints**

Require these CSS markers:

```js
for (const needle of [
  ".artist-album-cover-flow",
  ".artist-album-cover-flow-stage",
  ".artist-album-cover-flow-card",
  ".artist-album-cover-flow-reflection",
  ".artist-album-cover-flow-info",
  ".artist-album-cover-flow-play",
  "prefers-reduced-motion: reduce",
]) requireInSource(css, needle, "styles.css");

for (const needle of [
  "@keyframes artist-album-showcase-card-breathe",
  "@keyframes artist-album-showcase-sweep",
  "@keyframes artist-album-showcase-cover-drift",
  "@keyframes artist-album-showcase-control-pulse",
]) forbidInSource(css, needle, "styles.css");
```

Require `.artist-album-cover-flow` in `mobile.css`.

- [ ] **Step 2: Run the check and verify it fails on old showcase CSS**

Run: `cd frontend && pnpm test:artist-cover-flow`

Expected: non-zero for missing Cover Flow classes and forbidden permanent keyframes.

- [ ] **Step 3: Replace the old showcase style block**

Implement:

- `.artist-album-cover-flow` as a full-width section;
- `.artist-album-cover-flow-stage` with `position:relative`, responsive `height:clamp(390px,52vw,570px)`, hidden overflow, 32px radius, theme-aware near-black background, `cursor:grab`, `touch-action:pan-y`, and a visible focus ring;
- `.artist-album-cover-flow-cards` centered with square `--cover-flow-size:clamp(220px,28vw,350px)` and `perspective:1800px`;
- absolute `.artist-album-cover-flow-card` buttons with explicit 180ms transform/filter/opacity transitions, preserve-3d, backface visibility, and no hover movement;
- `.artist-album-cover-flow-face` with square cover, 18px radius, and depth shadow;
- `.artist-album-cover-flow-reflection` below the card using the same cover image container, `scaleY(-1)`, mask/opacity, and no pointer events;
- `.artist-album-cover-flow-info` anchored above pagination with active album title/meta and open/play controls;
- `.artist-album-cover-flow-play:active` and toolbar buttons at `scale(.97)` for 140ms;
- focus-visible rings for every interactive element;
- dot and count styles that remain legible across themes.

In `mobile.css`, reduce stage height/radius/card size at `max-width:720px`, keep at least 44px play/open targets, show at most the nearest neighbors through opacity managed by the engine, and prevent horizontal overflow.

In reduced motion, set card transitions to opacity only, remove reflection transition, force direct transforms supplied by JS, and remove press scaling while retaining focus/color feedback.

- [ ] **Step 4: Run focused verification**

Run:

```bash
cd frontend
pnpm test:artist-cover-flow
pnpm test:mineradio-motion
pnpm lint
pnpm build
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit visual polish**

```bash
git add frontend/src/styles.css frontend/src/mobile.css frontend/scripts/check-artist-cover-flow.mjs backend/web/dist
git commit -m "style: polish artist album cover flow"
```

### Task 4: Reference attribution and user-facing documentation

**Files:**
- Modify: `frontend/scripts/check-artist-cover-flow.mjs`
- Modify: `README.md`
- Modify: `README_ZH.md`
- Modify: `NOTICE.md`

**Interfaces:**
- Consumes: reference URL, commit, and MIT license from the approved design.
- Produces: durable source attribution and license notice.

- [ ] **Step 1: Extend the regression check for attribution**

Read the three docs and require the repository URL in both READMEs and NOTICE, plus the exact commit and `MIT` in NOTICE.

- [ ] **Step 2: Run the check and verify it fails**

Run: `cd frontend && pnpm test:artist-cover-flow`

Expected: non-zero for missing reference attribution.

- [ ] **Step 3: Add concise bilingual acknowledgement and NOTICE entry**

Add to README acknowledgements:

```md
The artist album Cover Flow adapts the circular 3D positioning, depth, reflection, wheel navigation, and snap behavior from [cover-flow-showcase](https://github.com/opc8838-hub/cover-flow-showcase) by opc8838-hub. Lark is not affiliated with that project.
```

Add the Chinese equivalent to `README_ZH.md`. Add to `NOTICE.md`:

```md
- cover-flow-showcase by opc8838-hub, licensed under MIT: https://github.com/opc8838-hub/cover-flow-showcase. The artist album Cover Flow adapts circular 3D positioning, depth, reflection, wheel navigation, and snap behavior from commit eda6308e7e936a0d51b3602640dd870ce76693bd.
```

- [ ] **Step 4: Run the dedicated check**

Run: `cd frontend && pnpm test:artist-cover-flow`

Expected: exit 0.

- [ ] **Step 5: Commit attribution**

```bash
git add README.md README_ZH.md NOTICE.md frontend/scripts/check-artist-cover-flow.mjs
git commit -m "docs: credit cover flow showcase"
```

### Task 5: Runtime, browser, and full-suite verification

**Files:**
- Modify only if verification exposes an on-scope defect.

**Interfaces:**
- Consumes: completed feature from Tasks 1-4.
- Produces: evidence that the real UI and existing product paths work.

- [ ] **Step 1: Run all frontend scripted tests**

Run every `test:*` script listed by `pnpm run`, including candidate cache, library curation, DLNA API, Mineradio motion, paper shaders, Smartisan tonearm, Walkman theme, and artist Cover Flow.

Expected: each exits 0 and the artist Cover Flow check exercises non-empty source assertions.

- [ ] **Step 2: Run frontend static/build verification**

Run:

```bash
cd frontend
pnpm lint
pnpm build
```

Expected: exit 0 and regenerated `backend/web/dist/index.html` plus hashed assets.

- [ ] **Step 3: Run backend tests**

Run: `cd backend && go test ./...`

Expected: exit 0 with no failed package.

- [ ] **Step 4: Verify the real browser surface**

Start the built application with an isolated temporary data directory and known admin credentials. In a browser:

- open an artist with several albums;
- switch grid → Cover Flow → grid and confirm the setting persists after reload;
- verify side click centers, center click opens, play control plays, drag captures, wheel settles, arrows move immediately, Enter opens, and Space plays;
- verify one-album and two-album artists;
- verify missing cover fallback and a discography over twelve albums;
- verify desktop and mobile widths and the browser's reduced-motion emulation;
- confirm there is no ordinary-hover navigation and no perpetual card motion while idle.

Expected: all acceptance checks hold with no console error, horizontal page overflow, nested-button warning, or stuck pointer state.

- [ ] **Step 5: Review the complete diff using the `check` release gate**

Inspect exact changed files, unknown identifiers, dependency changes, generated/source consistency, accessibility, reduced motion, reference attribution, and version scope. Fix all hard stops and rerun affected commands.

### Task 6: Release v0.9.37, push main, and push tag

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `frontend/package.json`
- Regenerate: `backend/web/dist`

**Interfaces:**
- Consumes: a fully verified feature and clean release review.
- Produces: pushed `main` release commit and annotated `v0.9.37` tag.

- [ ] **Step 1: Add bilingual changelog entries and bump version**

Add Chinese and English `0.9.37` sections dated `2026-07-14` covering the in-page view switch, reference-quality Cover Flow, interaction/accessibility behavior, and attribution. Change `frontend/package.json` version from `0.9.36` to `0.9.37`; do not change dependency versions.

- [ ] **Step 2: Rebuild and run fresh release verification**

Run:

```bash
cd frontend
pnpm test:artist-cover-flow
pnpm test:mineradio-motion
pnpm lint
pnpm build
cd ../backend
go test ./...
```

Then run every remaining frontend `test:*` script. Expected: all commands exit 0 and embedded assets match the final source.

- [ ] **Step 3: Verify release consistency and commit**

Run:

```bash
git diff --check
git status --short
rg -n '0\.9\.37|v0\.9\.37' CHANGELOG.md frontend/package.json
git diff --stat v0.9.36..HEAD
git diff --name-status v0.9.36..HEAD
```

Confirm no unrelated file, dependency bump, demo media, temporary file, or untracked artifact is present. Then:

```bash
git add CHANGELOG.md frontend/package.json backend/web/dist
git commit -m "chore: release v0.9.37"
```

- [ ] **Step 4: Push branch and verify remote commit**

```bash
git push origin main
git fetch origin main
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
```

Expected: push succeeds and local/remote `main` hashes match.

- [ ] **Step 5: Create and push the annotated tag**

```bash
git tag -a v0.9.37 -m "Release v0.9.37"
git push origin v0.9.37
git ls-remote --tags origin refs/tags/v0.9.37 refs/tags/v0.9.37^{}
```

Expected: the peeled annotated tag resolves to the release commit.

- [ ] **Step 6: Inspect GitHub Actions and final repository state**

Use `gh run list --branch main --limit 10 --json databaseId,displayTitle,event,status,conclusion,headSha,url` and inspect runs for the release commit/tag. Poll structured status with `gh run view <id> --json status,conclusion,url`; do not pipe `gh run watch` through `tail` or `head`.

Final local checks:

```bash
git status --short
git log -6 --oneline --decorate
git show --stat --oneline v0.9.37
```

Expected: clean worktree, `HEAD`, `origin/main`, and peeled `v0.9.37` at the release commit, with CI status reported accurately.
