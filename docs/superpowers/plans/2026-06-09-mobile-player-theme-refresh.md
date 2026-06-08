# Mobile Player Theme Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refine the mobile player layout and theme visuals so 375px-430px mobile playback feels consistent, touch-safe, and aligned with the desktop theme identities.

**Architecture:** Keep the existing `MobileArtPlayer` shell and shared controls intact. Replace only the middle theme visual slot per theme, using desktop player themes as references where requested, and finish with CSS overrides scoped to mobile.

**Tech Stack:** React, TypeScript, CSS variables, existing Phosphor icons, Vite/pnpm build, Go backend tests, agent-browser mobile visual checks.

---

### Task 1: Theme Structure And Copy

**Files:**
- Modify: `frontend/src/components/player-themes/MobileArtPlayer.tsx`
- Modify: `frontend/src/i18n.ts`
- Modify: `frontend/src/App.tsx`

- [x] Remove unused imports after the theme visual JSX changes.
- [x] Keep public theme ids unchanged for persisted settings.
- [x] Rename the visible `音乐编辑器` / `Music Editor` label to `Ipod`.
- [x] Ensure `indiewave` renders an album sleeve plus sliding vinyl, matching the desktop `AlbumSlidePlayer` concept.
- [x] Ensure `editorial-pulse` renders an iPod-style visual, matching the desktop `IpodPlayer` concept.
- [x] Ensure `blue-halo` renders a cassette-style visual, matching the desktop `CassetteDeck` concept.
- [x] Keep shared controls, volume, progress, queue, lyrics, and swipe/back behavior unchanged.

### Task 2: Mobile Theme CSS

**Files:**
- Modify: `frontend/src/mobile.css`

- [x] Replace the broad end-of-file cleanup block with theme-specific rules.
- [x] Restore `soft-vinyl` arm, cube, knob, and record presentation.
- [x] Keep `stage-glass` disc while removing speaker icons, cover dots, and lower puck.
- [x] Keep `smartisan-classic` record and stylus while hiding the top rectangle/titlebar and stabilizing rotation.
- [x] Add responsive mobile CSS for `indiewave` album sleeve, `editorial-pulse` iPod, and `blue-halo` cassette.
- [x] Make no-cover/default full-screen player visuals use a black-vinyl-derived presentation where that fits the theme.
- [x] Maintain touch targets at 44px or larger and avoid horizontal overflow at 375px.

### Task 3: Verification And UX Review

**Files:**
- Read/execute only; no expected source changes unless verification finds defects.

- [x] Run `git diff --check`.
- [x] Run `npx -y pnpm@10.26.0 lint`.
- [x] Run `npx -y pnpm@10.26.0 build`.
- [x] Run `go test ./...`.
- [x] Start or reuse a local preview and use `agent-browser` at a 390x844 viewport.
- [x] Exercise every mobile player theme: `neon-console`, `soft-vinyl`, `indiewave`, `editorial-pulse`, `stage-glass`, `blue-halo`, `smartisan-classic`.
- [x] For each theme, inspect default/no-cover appearance, playing-state animation, main controls, volume slider, progress slider, lyrics button, queue button, and back/minimize interaction.
- [x] Apply `ui-ux-pro-max` checks: touch size, no horizontal scroll, readable contrast, limited visual noise, transform/opacity animation, no active-tab background rectangle.

### Task 4: Ship Follow-Through

**Files:**
- Source and generated frontend dist files changed by the verified build.

- [x] Re-read `git status --short --branch -uall` and `git rev-parse HEAD`.
- [x] Determine the next version tag from existing tags.
- [x] Stage only intended source, docs, and generated dist artifacts; do not stage unrelated `--full-page`.
- [x] Commit the verified changes.
- [x] Create the new version tag.
- [x] Push the branch and tag.
- [x] Re-read remote/tag state after push and report the commit hash and tag.
