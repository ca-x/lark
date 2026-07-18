# Windows Player Motion And Mobile Theme Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore meaningful playback motion in the Windows reduced-motion environment, remove confirmed AI-slop patterns from mobile themes, improve mobile usability, and release v0.9.39.

**Architecture:** Keep the operating-system reduced-motion preference for navigation, decorative shaders, parallax, and large transitions, but restore one restrained playback-state cue per player theme so Windows does not make every theme look broken. Apply mobile polish through the existing shared React components and final CSS cascade rather than introducing new dependencies or replacing theme identities.

**Tech Stack:** React 19, TypeScript 6, Vite 8, CSS, Node static regression scripts, Go 1.26, GitHub Actions.

## Global Constraints

- Preserve every existing player theme and its saved preference wiring.
- Respect reduced motion by disabling decorative movement; only playback-state cues may continue, at slower durations.
- Keep mobile touch targets at least 44×44 CSS pixels and retain visible focus states.
- Preserve theme-specific colors and physical-object gradients; remove only atmosphere-only gradients, excessive blur/glow, and gradient text.
- Add no dependencies.
- Build frontend output into `backend/web/dist` before release.
- Release version is `v0.9.39`.

---

### Task 1: Pin The Cross-Platform Motion And Mobile UX Contract

**Files:**
- Create: `frontend/scripts/check-player-motion.mjs`
- Modify: `frontend/package.json`

**Interfaces:**
- Consumes: theme component class names and the existing CSS reduced-motion media queries.
- Produces: `pnpm test:player-motion`, a release-gate check for essential playback cues, mobile touch sizes, accessible mobile play actions, and de-slopped lyrics.

- [ ] **Step 1: Write the failing regression script**

Create a Node script that reads `styles.css`, `mobile.css`, `MobileArtPlayer.tsx`, and `MobileHomeSurface.tsx`. Assert that a final reduced-motion block restores desktop theme cues, a final mobile block restores mobile record/reel/EQ cues, expanded and mini-player controls are at least 44px, the highlighted song play button has an accessible label, and immersive mobile lyrics no longer use text gradient clipping.

- [ ] **Step 2: Add the package command**

Add `"test:player-motion": "node scripts/check-player-motion.mjs"` beside the existing player-theme checks.

- [ ] **Step 3: Run the test and verify RED**

Run: `cd frontend && pnpm test:player-motion`

Expected: FAIL because the new final reduced-motion and mobile polish contracts do not exist yet.

### Task 2: Restore Meaningful Player Motion Under Windows Reduced Motion

**Files:**
- Modify: `frontend/src/styles.css`
- Modify: `frontend/src/mobile.css`

**Interfaces:**
- Consumes: existing `data-playing` state and existing theme keyframes.
- Produces: slow, playback-gated rotation/reel/EQ cues while decorative motion remains disabled.

- [ ] **Step 1: Add the desktop essential-motion override**

Append a final `@media (prefers-reduced-motion: reduce)` block to `styles.css`. Re-enable only the primary state cue for Vinyl, Running Kitten, Mineradio, Cassette, iPod, Audio Scope, Album Slide, Smartisan, and Gramophone when `data-playing='true'`. Use the existing keyframes with slower durations; do not restore shaders, floating layers, ripples, glow pulses, kitten orbit, or large transforms.

- [ ] **Step 2: Add the mobile essential-motion override**

Append a final `@media (max-width:720px) and (prefers-reduced-motion:reduce)` block to `mobile.css`. Re-enable only record/disc rotation, cassette reels, and the iPod equalizer while playing. Keep cover float, VU decoration, glints, orbit layers, and tonearm transitions disabled.

- [ ] **Step 3: Run the regression script**

Run: `cd frontend && pnpm test:player-motion`

Expected: motion assertions pass; mobile UI assertions still fail until Task 3.

### Task 3: Remove Mobile AI Slop And Improve Mobile UI/UX

**Files:**
- Modify: `frontend/src/mobile.css`
- Modify: `frontend/src/components/mobile/MobileHomeSurface.tsx`

**Interfaces:**
- Consumes: current mobile theme tokens, existing Phosphor icons, safe-area variables, and mobile component callbacks.
- Produces: restrained surfaces, readable lyrics, stable transform-based meters, 44px controls, and labelled play actions.

- [ ] **Step 1: Remove confirmed visual slop**

Replace immersive lyric gradient-clipped text with a solid high-contrast live color and progress conveyed through opacity/weight rather than rainbow fill. Flatten atmosphere-only player backgrounds, reduce large fog shadows, and remove decorative blur from mini-player/sheet surfaces while retaining object-specific record, cassette, metal, and wood gradients.

- [ ] **Step 2: Stabilize motion and touch controls**

Change volume-bar animation from `height` transitions to `scaleY` with a fixed height and bottom transform origin. Raise expanded action/control buttons and mini-player next/queue controls to at least 44px. Keep pressed feedback within 150–200ms and avoid layout-changing transforms.

- [ ] **Step 3: Improve accessible names**

Give the highlighted-song play button an explicit localized label containing the action and song title.

- [ ] **Step 4: Run the regression script and scanner**

Run: `cd frontend && pnpm test:player-motion`

Run the kill-ai-slop scanner against the mobile theme CSS and record which remaining gradient/radius hits are intentional physical-object rendering or semantic surfaces.

Expected: PASS, with the confirmed slop hit count reduced and intentional hits documented.

### Task 4: Browser And Repository Verification

**Files:**
- Modify only if verification finds a release-blocking defect.

**Interfaces:**
- Consumes: Vite dev server, browser media emulation, project test commands.
- Produces: computed-style and screenshot evidence for normal/reduced motion and mobile layouts.

- [ ] **Step 1: Verify computed motion styles**

At 390×844, compare normal and reduced-motion computed styles for representative desktop and mobile theme elements. Confirm playing elements have an infinite animation and paused elements do not.

- [ ] **Step 2: Verify mobile UI visually**

Test 375×812, 390×844, and 844×390. Confirm no horizontal overflow, no safe-area overlap, touch targets are at least 44px, focus remains visible, text remains readable, and reduced motion leaves only restrained playback-state cues.

- [ ] **Step 3: Run frontend verification**

Run every existing `test:*` script, then `pnpm lint` and `pnpm build`.

- [ ] **Step 4: Run backend verification**

Run: `cd backend && go test ./...`

- [ ] **Step 5: Review the exact diff**

Check scope traceability, sibling motion selectors, unknown identifiers, dependency changes, version consistency, generated assets, accessibility, and release hard stops.

### Task 5: Release v0.9.39

**Files:**
- Modify: `frontend/package.json`
- Modify: `CHANGELOG.md`
- Modify: `backend/web/dist/**` through `pnpm build`

**Interfaces:**
- Consumes: verified source and generated frontend bundle.
- Produces: commit on `main`, pushed branch, annotated `v0.9.39` tag, and GitHub release workflows.

- [ ] **Step 1: Update version and release notes**

Set the frontend version to `0.9.39`. Add Chinese and English changelog entries dated `2026-07-19` covering the Windows motion fix, reduced mobile visual noise, and mobile accessibility/touch improvements.

- [ ] **Step 2: Rebuild embedded assets**

Run: `cd frontend && pnpm build`

Verify `backend/web/dist/index.html` references only generated files present in the tree.

- [ ] **Step 3: Run final verification**

Repeat the complete frontend and backend verification commands after the version/build changes.

- [ ] **Step 4: Commit intended files**

Stage explicit source, test, plan, changelog, version, and generated files. Commit with `fix: restore player motion on Windows`.

- [ ] **Step 5: Push branch and tag**

Re-check `HEAD`, worktree status, origin sync, and authentication. Push `main`, create annotated tag `v0.9.39` with message `Lark v0.9.39`, and push the tag.

- [ ] **Step 6: Confirm remote state**

Read back the remote branch/tag and monitor the tag-triggered binary and Docker workflows to a terminal state. Report the commit, tag, workflow/release state, and any remaining blocker.
