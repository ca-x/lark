# Mineradio Stage High-Fidelity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Lark's desktop Mineradio theme into a full-viewport, reference-faithful visual radio stage while preserving Lark playback and navigation.

**Architecture:** `HomeView` gets a dedicated Mineradio-only desktop branch, so the normal dashboard never competes with the stage. `MineradioStagePlayer` remains the scene owner, but its DOM art becomes a WebGL fallback, its launch wordmark gains explicit phases, and its render loop moves to wall-clock deltas. Mineradio-only CSS takes over the desktop shell without affecting mobile or other themes.

**Tech Stack:** React 19, TypeScript 6, Three.js 0.185, CSS, Node static regression checks, Vite, Go embedded frontend.

## Global Constraints

- Reference source: `/home/czyt/code/ref/Mineradio` commit `6b130103f759e5dcd1e133700071c8216b8fa5a6`.
- Preserve Lark playback, library data, preferences, navigation semantics, and mobile player.
- Do not copy Mineradio authentication, media sources, or Electron shell.
- No new frontend dependency.
- Repeated controls stay immediate; cinematic timing is limited to the rare launch sequence.
- Reduced motion keeps readable material and opacity transitions while stopping camera travel and continuous particle motion.
- Release version is `v0.9.38`.

---

### Task 1: Pin the full-stage structural contract

**Files:**
- Modify: `frontend/scripts/check-mineradio-motion.mjs`

**Interfaces:**
- Consumes: source text from `App.tsx`, `MineradioStagePlayer.tsx`, and `styles.css`.
- Produces: a failing exit code when the dedicated home branch, takeover selectors, WebGL-primary fallback, or wall-clock loop regresses.

- [ ] **Step 1: Add failing source invariants**

Require these source markers:

```js
for (const needle of [
  'home-view home-view-mineradio',
  'data-mineradio-home="true"',
  'data-cover-renderer="webgl-primary"',
  'data-splash-ready',
  'performance.now()',
]) {
  requireInSource(app + component, needle, "Mineradio full-stage contract");
}

forbidInSource(component, "new THREE.Clock()", "MineradioStagePlayer.tsx");
```

Require CSS markers for `.home-view-mineradio`, the shell takeover, edge navigation, `.mineradio-stage-player[data-webgl-unavailable='true']`, and a fine-pointer hover gate.

- [ ] **Step 2: Run the check and confirm RED**

Run: `cd frontend && pnpm test:mineradio-motion`

Expected: non-zero with missing full-stage contract markers.

### Task 2: Isolate the desktop Mineradio home branch

**Files:**
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: existing `HomeView` player/library props.
- Produces: a `home-view-mineradio` section containing only `MineradioStagePlayer` on desktop.

- [ ] **Step 1: Return a dedicated branch after the mobile branch**

Use the existing playback props and callbacks:

```tsx
if (homePlayerStyle === "mineradio-stage") {
  return (
    <section className="home-view home-view-mineradio" data-mineradio-home="true">
      <section className="hero mineradio-stage-hero">
        <MineradioStagePlayer
          cover={coverUrl(displaySong)}
          playing={heroPlaying}
          progress={heroActive ? progress : 0}
          duration={heroActive ? duration : displaySong?.duration_seconds || 0}
          title={displaySong?.title}
          artist={displaySong?.artist}
          album={displaySong?.album}
          playMode={playMode}
          playModeLabel={playModeLabel}
          immersiveStage={mineradioStageEnabled}
          activeLyricText={activeLyricText}
          audioElement={audioElement}
          playlists={playlists}
          onToggle={heroActive ? onTogglePlayback : heroCanResume && displaySong ? () => onResume(displaySong) : undefined}
          onPrevious={heroActive ? onPrevious : undefined}
          onNext={heroActive ? onNext : undefined}
          onCyclePlayMode={onCyclePlayMode}
          onSeek={heroActive ? onSeek : undefined}
          onOpenPlaylist={onOpenPlaylist}
        />
      </section>
    </section>
  );
}
```

- [ ] **Step 2: Remove the now-unreachable Mineradio branch from the normal hero ternary**

Keep every other desktop player style unchanged.

- [ ] **Step 3: Run TypeScript-facing verification**

Run: `cd frontend && pnpm lint`

Expected: exit `0` with no unused variables or invalid JSX.

### Task 3: Recompose launch and playback stage

**Files:**
- Modify: `frontend/src/components/player-themes/MineradioStagePlayer.tsx`
- Modify: `frontend/src/styles.css`

**Interfaces:**
- Consumes: current song metadata, cover URL, analyser, playlists, playback callbacks.
- Produces: launch phases, WebGL-primary cover, full-viewport stage, scoped shelf, stable fallback markers.

- [ ] **Step 1: Add explicit launch readiness**

Track `splashReady` separately from `stageEntered`. Set it from the final wordmark animation completion, expose `data-splash-ready`, and keep click/Enter/Space able to enter at any time.

- [ ] **Step 2: Mark cover renderer ownership**

Set `data-cover-renderer="webgl-primary"` on the stage root. Keep the DOM cover, disc, and DOM particle cloud in markup for fallback, but CSS must hide them while WebGL is available and reveal them only under `data-webgl-unavailable='true'`.

- [ ] **Step 3: Replace deprecated render timing**

Replace `THREE.Clock` with monotonic timestamps:

```ts
let previousFrameAt = performance.now();
let elapsed = 0;
const tick = (frameAt = performance.now()) => {
  const delta = Math.min(Math.max((frameAt - previousFrameAt) / 1000, 0), 0.05);
  previousFrameAt = frameAt;
  elapsed += delta;
  // existing scene update
  raf = requestAnimationFrame(tick);
};
```

The reduced-motion path renders one stable frame without starting the loop.

- [ ] **Step 4: Apply full-stage shell CSS**

For `.app-shell:has(.home-view-mineradio)` on desktop:

- use one viewport-filling grid cell with no outer padding or gap;
- remove main border/radius/padding and prevent page scrolling;
- hide the standard top bar and player from the primary composition;
- position the sidebar as a narrow fixed edge rail, hide text labels, use low idle opacity, and restore full opacity on `:hover`/`:focus-within`;
- restore normal shell rules automatically when the view changes.

- [ ] **Step 5: Recompose stage geometry**

Make the hero and stage `100dvh`, remove rounded borders, keep the WebGL canvas full bleed, place the cover particle focal area center-left, reserve lyric space through the middle, keep the shelf at the right edge, and anchor the compact controls below the focal object. Ensure 1366x768 does not use the old 410-620px height clamp.

- [ ] **Step 6: Apply Emil interaction details**

Use exact-property transitions, `scale(.97)` active feedback, 100-160ms button response, custom ease-out, and `(hover: hover) and (pointer: fine)` for hover transforms. Avoid `transition: all`, `ease-in`, and layout animation.

- [ ] **Step 7: Run the structural check and frontend build**

Run:

```bash
cd frontend
pnpm test:mineradio-motion
pnpm lint
pnpm build
```

Expected: all commands exit `0`; `backend/web/dist` is regenerated.

### Task 4: Browser fidelity and accessibility QA

**Files:**
- Modify if findings require it: `frontend/src/components/player-themes/MineradioStagePlayer.tsx`
- Modify if findings require it: `frontend/src/styles.css`
- Modify if findings require it: `frontend/scripts/check-mineradio-motion.mjs`

**Interfaces:**
- Consumes: built application and temporary QA data.
- Produces: screenshots and runtime evidence for launch, stage, fallback, responsive, and reduced-motion behavior.

- [ ] **Step 1: Capture the settled launch at 1440x900**

Compare against `/tmp/mineradio-reference-ready-20260715.png`. Confirm the launch fills the viewport, the final wordmark reads `Larkradio`, and ordinary Lark dashboard/player surfaces are absent.

- [ ] **Step 2: Enter and capture the stage at 1440x900 and 1366x768**

Confirm title, WebGL cover particles, controls, lyric, and shelf remain inside the viewport with no top crop.

- [ ] **Step 3: Verify interaction and navigation**

Check play/pause, previous/next, seek, play mode, shelf wheel, shelf keyboard focus, and edge navigation. Leaving home must restore the ordinary shell.

- [ ] **Step 4: Verify reduced motion and mobile**

Emulate `prefers-reduced-motion: reduce` and capture a stable readable stage. At 375px width, confirm `MobileHomeSurface` is used and the desktop takeover selectors do not apply.

- [ ] **Step 5: Fix findings and rerun automated checks**

Run the Task 3 commands again after any visual correction.

### Task 5: Review, version, and ship v0.9.38

**Files:**
- Modify: `frontend/package.json`
- Modify: `CHANGELOG.md`
- Verify/regenerate: `backend/web/dist/*`

**Interfaces:**
- Consumes: reviewed implementation and prior `v0.9.37` release format.
- Produces: pushed `main`, annotated `v0.9.38`, branch CI, tag workflows, draft release assets, and Docker images.

- [ ] **Step 1: Perform a deep diff review**

Classify every changed file against the goal, check for source/distribution drift, inspect render-loop cleanup, reduced-motion behavior, keyboard access, and no new dependencies. Fix all release-blocking findings.

- [ ] **Step 2: Update release metadata**

Set `frontend/package.json` to `0.9.38` and prepend bilingual `0.9.38` / `v0.9.38` changelog entries matching the previous release format.

- [ ] **Step 3: Run full verification**

Run:

```bash
cd frontend && pnpm test:mineradio-motion && pnpm lint && pnpm build
cd ../backend && go mod verify && go test ./... && go vet ./...
```

Expected: every command exits `0`.

- [ ] **Step 4: Commit only intended files**

Re-read `git status --short --branch -uall` and `git rev-parse HEAD`, then commit the implementation and release metadata with a scoped message.

- [ ] **Step 5: Push and tag**

Re-read branch, remote, HEAD, and status. Push `main`, create annotated tag `v0.9.38` with a concise release message, then push the tag.

- [ ] **Step 6: Verify remote workflows and artifacts**

Use structured `gh run view --json status,conclusion` polling for the `main` CI and tag-triggered binary/Docker workflows. Confirm the `v0.9.38` draft release contains all five binary archives and verify at least one downloaded archive contains the expected server binary.
