# Running Kitten Player Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the desktop Running Kitten theme visibly read as a kitten running on an independent vinyl groove while preserving the existing watercolor composition and playback contract.

**Architecture:** Move the kitten markup outside the rotating record, then split lap rotation, inverse orientation, direction flip, and step bob across nested transform layers. Add a static regression script for the layer boundary and motion/accessibility rules. Keep the component API and saved theme wiring unchanged.

**Tech Stack:** React 19, TypeScript, CSS transforms/keyframes, Node static checks, Vite.

## Global Constraints

- Do not change the `running-kitten` theme id, mobile player, playback callbacks, watercolor asset, or shared bottom player.
- Do not add a dependency or a new setting.
- Animate transforms and opacity only.
- Pause every decorative motion when playback pauses.
- `prefers-reduced-motion: reduce` renders a stable upright kitten.
- Ship in `v0.9.38` after the already completed Mineradio stage change.

---

### Task 1: Pin the kitten motion contract

**Files:**
- Create: `frontend/scripts/check-running-kitten-theme.mjs`
- Modify: `frontend/package.json`

**Interfaces:**
- Consumes: `RunningKittenTurntable.tsx` and `styles.css` source text.
- Produces: `pnpm test:running-kitten`, failing when the independent orbit, counter-rotation, direction flip, pause state, fine-pointer hover gate, or reduced-motion rule disappears.

- [ ] **Step 1: Create the failing source check**

Require component markers:

```js
const componentMarkers = [
  "running-kitten-cat-orbit",
  "running-kitten-cat-runner",
  "running-kitten-cat-facing",
  'data-motion-model="upper-groove-lap"',
];
```

Require CSS markers:

```js
const cssMarkers = [
  "@keyframes running-kitten-lap",
  "@keyframes running-kitten-counter-lap",
  "@keyframes running-kitten-facing",
  ".running-kitten-player[data-playing='true'] .running-kitten-cat-orbit",
  "@media (hover:hover) and (pointer:fine)",
  "prefers-reduced-motion: reduce",
];
```

Also fail if the component places `running-kitten-cat-orbit` inside the `running-kitten-record` block.

- [ ] **Step 2: Add the package script**

Add:

```json
"test:running-kitten": "node scripts/check-running-kitten-theme.mjs"
```

- [ ] **Step 3: Run RED**

Run: `cd frontend && pnpm test:running-kitten`

Expected: failure listing missing upper-groove-lap markers.

### Task 2: Implement the independent upper-groove lap

**Files:**
- Modify: `frontend/src/components/player-themes/RunningKittenTurntable.tsx`
- Modify: `frontend/src/styles.css`

**Interfaces:**
- Consumes: existing `playing` state and platter geometry.
- Produces: a separately paused record spin and kitten lap, with an upright silhouette and explicit turn direction.

- [ ] **Step 1: Move kitten markup outside the record**

After `running-kitten-record`, render:

```tsx
<div className="running-kitten-cat-orbit" data-motion-model="upper-groove-lap">
  <div className="running-kitten-cat-runner">
    <div className="running-kitten-cat-facing">
      <KittenSilhouette />
    </div>
  </div>
</div>
```

Remove the old `running-kitten-cat-track` wrapper from inside the record.

- [ ] **Step 2: Add the bounded lap transforms**

Use one shared duration variable and three synchronized keyframes:

```css
.running-kitten-cat-orbit {
  --running-kitten-lap-duration:8.8s;
  position:absolute;
  inset:7%;
  animation:running-kitten-lap var(--running-kitten-lap-duration) cubic-bezier(.45,.02,.55,.98) infinite paused;
}

.running-kitten-cat-runner {
  position:absolute;
  left:50%;
  top:3%;
  animation:running-kitten-counter-lap var(--running-kitten-lap-duration) cubic-bezier(.45,.02,.55,.98) infinite paused;
}

.running-kitten-cat-facing {
  animation:running-kitten-facing var(--running-kitten-lap-duration) steps(1,end) infinite paused;
}
```

The lap timeline moves from `-68deg` to `68deg`, holds briefly, returns to `-68deg`, and holds again. Counter-lap uses the exact inverse angles. Facing flips only during the return half.

- [ ] **Step 3: Refine material and controls**

- remove `backdrop-filter` from `.running-kitten-player`;
- reduce the silhouette stroke so the kitten reads as a crisp figure rather than a glowing sticker;
- change active feedback to `scale(.97)` at 140ms;
- move hover-only treatment into `(hover:hover) and (pointer:fine)`;
- keep all button hit areas at least 40px.

- [ ] **Step 4: Keep pause and reduced motion stable**

Set lap, counter-lap, facing, and bob animations to running only under `data-playing='true'`. The existing reduced-motion block must set all animations to `none` and leave the upper-track default transform upright.

- [ ] **Step 5: Run GREEN**

Run:

```bash
cd frontend
pnpm test:running-kitten
pnpm test:paper-shaders
pnpm lint
pnpm build
```

Expected: all commands exit `0` and embedded assets are regenerated.

### Task 3: Browser QA and release integration

**Files:**
- Modify if QA requires it: `frontend/src/components/player-themes/RunningKittenTurntable.tsx`
- Modify if QA requires it: `frontend/src/styles.css`
- Generated: `backend/web/dist/*`

**Interfaces:**
- Consumes: temporary QA library and current desktop theme preference.
- Produces: visual and runtime evidence merged into the final `v0.9.38` release gate.

- [ ] **Step 1: Verify playing motion at 1440x900 and 1366x768**

Capture the kitten transform, record transform, and screenshot at two points at least 600ms apart. Both transforms must change while remaining inside the platter bounds.

- [ ] **Step 2: Verify pause continuity**

Pause, sample both transforms twice, and confirm they remain equal. Resume and confirm both continue without resetting to their initial transforms.

- [ ] **Step 3: Verify a direction turn**

Temporarily set a shorter animation duration from browser devtools or wait for the normal turn. Confirm `running-kitten-cat-facing` flips while the silhouette remains upright.

- [ ] **Step 4: Verify reduced motion**

Emulate reduced motion, reload, and confirm the record and kitten report `animation-name: none` while transport and seek remain usable.

- [ ] **Step 5: Hand off to the shared release gate**

Run the full frontend and backend verification suite, deep-review the combined diff since `v0.9.37`, update `CHANGELOG.md` and `frontend/package.json`, rebuild embedded assets, commit, push `main`, create and push annotated `v0.9.38`, and verify branch/tag workflows and release artifacts.
