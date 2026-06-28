# Mineradio Motion Fidelity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the original Mineradio-style interface motion channels in Lark's Mineradio Stage theme.

**Architecture:** Keep the existing React component and global CSS, then layer deterministic CSS motion and stronger Three.js per-frame transforms on top. Add one static regression script that prevents future passes from accidentally removing the replicated motion systems.

**Tech Stack:** React 19, TypeScript, Three.js, CSS keyframes, Node-based static checks, Vite, Go backend embedding.

---

## File Map

- Modify `frontend/src/components/player-themes/MineradioStagePlayer.tsx`: motion markup, shelf variables, lyric keyed animation, Three.js loop state.
- Modify `frontend/src/styles.css`: splash/shelf/lyrics keyframes and selectors.
- Create `frontend/scripts/check-mineradio-motion.mjs`: static checks for required motion channel names.
- Modify `frontend/package.json`: expose `test:mineradio-motion`.
- Modify `README.md`, `README_ZH.md`, `CHANGELOG.md`: document reference-code borrowing and the new release.

## Task 1: Add Regression Check

**Files:**
- Create: `frontend/scripts/check-mineradio-motion.mjs`
- Modify: `frontend/package.json`

- [ ] **Step 1: Write the failing check**

Create a Node script that reads `src/components/player-themes/MineradioStagePlayer.tsx` and `src/styles.css` and fails unless the following strings exist:

```text
mineradio-stage-splash-particles
mineradio-stage-splash-streaks
mineradio-stage-splash-shards
mineradio-stage-lyric-river
mineradio-stage-lyric-glow
--shelf-delta
data-motion-card
@keyframes mineradio-stage-card-breathe
@keyframes mineradio-stage-lyric-river
@keyframes mineradio-stage-signal-sweep
prefers-reduced-motion: reduce
```

- [ ] **Step 2: Run RED**

Run:

```bash
cd frontend && pnpm test:mineradio-motion
```

Expected: failure mentioning missing Mineradio motion channels.

## Task 2: Implement DOM Motion Channels

**Files:**
- Modify: `frontend/src/components/player-themes/MineradioStagePlayer.tsx`
- Modify: `frontend/src/styles.css`

- [ ] **Step 1: Add splash layers**

Inside `.mineradio-stage-splash`, render deterministic particle, streak, and shard spans with `--particle-index`, `--streak-index`, and `--shard-index` variables.

- [ ] **Step 2: Add lyric layers**

Wrap the lyric text in a keyed motion structure:

```tsx
<strong key={liveLyric} data-lyric-text={liveLyric}>
  <span className="mineradio-stage-lyric-glow" aria-hidden="true">{liveLyric}</span>
  <span className="mineradio-stage-lyric-text">{liveLyric}</span>
</strong>
<span className="mineradio-stage-lyric-river" aria-hidden="true">...</span>
```

- [ ] **Step 3: Add shelf motion variables**

For each playlist card, compute delta from `selectedShelfIndex` and set `--shelf-delta`, `--shelf-abs-delta`, `--shelf-parity`, and `data-motion-card`.

- [ ] **Step 4: Add CSS keyframes**

Add keyframes and selectors for:

```css
@keyframes mineradio-stage-signal-sweep
@keyframes mineradio-stage-splash-particle
@keyframes mineradio-stage-splash-streak
@keyframes mineradio-stage-splash-shard
@keyframes mineradio-stage-card-breathe
@keyframes mineradio-stage-card-selected-pulse
@keyframes mineradio-stage-lyric-river
@keyframes mineradio-stage-lyric-shimmer
```

Keep all animated properties to `transform`, `opacity`, `filter`, and shadow intensity.

## Task 3: Implement Three.js Motion Channels

**Files:**
- Modify: `frontend/src/components/player-themes/MineradioStagePlayer.tsx`

- [ ] **Step 1: Store particle base positions**

After creating `particleGeometry`, keep a copy of base positions and mutate the position attribute each frame using elapsed time, energy, and per-particle phase.

- [ ] **Step 2: Store shelf mesh metadata**

When creating shelf meshes, write `baseX`, `baseY`, `baseZ`, `phase`, and `slot` into `mesh.userData`.

- [ ] **Step 3: Use elapsed-time animation**

Replace fixed `frame += 0.01` with `THREE.Clock.getDelta()` and `clock.elapsedTime`. Smooth energy and beat values based on `playing` and animate aura, beams, particles, camera, and shelf cards.

- [ ] **Step 4: Preserve reduced motion**

When reduced motion is active, render once and skip the requestAnimationFrame loop.

## Task 4: Verify and Release

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `README.md`
- Modify: `README_ZH.md`
- Modify: `frontend/package.json`
- Build output: `backend/web/dist/*`

- [ ] **Step 1: Run GREEN checks**

Run:

```bash
cd frontend && pnpm test:mineradio-motion && pnpm lint && pnpm build
go test ./...
```

Expected: all commands exit `0`.

- [ ] **Step 2: Run visual QA**

Start the local app with temporary data, enter the Mineradio Stage, and check desktop and mobile screenshots. Verify animation by comparing canvas pixels or DOM transform values over time.

- [ ] **Step 3: Update release metadata**

Bump frontend package version from `0.9.19` to `0.9.20`, add a `v0.9.20` changelog entry, rebuild `backend/web/dist`, commit, tag `v0.9.20`, and push branch plus tag.
