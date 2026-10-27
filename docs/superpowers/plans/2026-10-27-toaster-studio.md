# Toaster Studio Implementation Plan

> **For agentic workers:** Use subagent-driven-development or executing-plans task by task. The user has authorized implementation and release; do not request that authorization again.

**Goal:** Ship an optional, local-audio Toaster workspace with visuals, Strudel/MIDI exports, and the Cover Flow fix as v0.18.0.

**Architecture:** A lazy React workspace uses a typed facade over pinned MIT upstream analysis/code/export modules. The facade adds only analyser branches to Lark's existing EQ graph. The existing user-preference API stores the opt-in flag.

**Tech Stack:** Existing React 19, TypeScript 6, Vite 8 and Go 1.27. No runtime dependency or new service.

**Spec:** `docs/superpowers/specs/2026-10-27-toaster-studio-design.md`

## Global Constraints

- Default disabled; synchronise per user; lazy-load only after entry.
- Never create a duplicate media element source, change playback routing or close the existing AudioContext.
- Approximate reconstruction only; no camera, system capture, AI API, remote iframe or generated-code execution.
- Track/seek reset; pause and silence cannot create fictitious recorded bars.
- Chinese/English and desktop/mobile; reduced motion and cleanup are required.
- Preserve Toaster's MIT license and pinned upstream provenance.

## Review Focus

- A graph becoming ready after entry must reconnect without replacing playback.
- Pausing/seeking/switching songs must not create bars or mix unrelated song fragments.
- Invalid or Unicode metadata must not become HTML, executable code or an unsafe external URL.
- Unmount during export must terminate worker resources without touching playback.
- Optional navigation must remain reachable on mobile and disappear safely when disabled.

### Task 1: Audio session and source exports

**Owner:** Dedicated core implementer; only `frontend/src/features/toaster/` except root-owned `contracts.ts`.

**Files:** Vendored `engine.js`, `codegen.js`, `tape.js` plus license/provenance, `session.ts`, narrow JavaScript declarations, worker if necessary, `session.test.mjs`.

**Interfaces:** Read the exact contracts in `frontend/src/features/toaster/contracts.ts`. Produce `createToasterSession(audio, meta): ToasterSession | null` from `session.ts`. Use `makeAudioAnalyser` from existing audioAnalysis; do not modify that service. Upstream inspected sources are at `/tmp/lark-toaster-sources/renderer/`.

- [x] Write a focused failing test for graph sharing/disposal, pause/silence, metadata/link handling and real Strudel/MIDI output.
- [x] Copy only the three required upstream modules; add narrow types and an ownership-safe facade matching the contracts.
- [x] Run `node --experimental-strip-types --test src/features/toaster/session.test.mjs` from frontend; inspect real output and MIDI headers.
- [x] Self-review lifecycle, graph readiness, seeking and export work. Report owned files, commands and remaining limits; do not commit other tasks' work.

### Task 2: Toaster workspace UI

**Owner:** Dedicated UI implementer; only `frontend/src/components/toaster/` and the Toaster keys in `frontend/src/i18n.ts`.

**Files:** `ToasterStudio.tsx`, `toaster-studio.css`, focused behavior tests if useful.

**Interfaces:** Default-export a component with `ToasterStudioProps` from `contracts.ts`. Import `createToasterSession` from the facade; it may arrive concurrently. Core provides measured bands/energy, patterns and code parts; UI owns rendering. Reuse existing icons and graph-ready event.

- [x] Implement a responsive utility workspace with current track, measured status, code parts and spectrum/orb/domino visuals.
- [x] Add real Copy/Download Strudel, Download MIDI, Strudel link, code visibility, mode selection, playback and Back actions. Disable unavailable export with a reason.
- [x] Keep analyser creation and RAF in a lifecycle with cleanup; wait for graph-ready, reset on seek/track, stop work when hidden, and respect reduced motion.
- [x] Keep every UI string in the existing Chinese/English dictionary. Avoid global CSS and never evaluate code.
- [x] Run focused TypeScript/lint checks where independent; report browser states for primary integration verification.

### Task 3: Preferences and application integration

**Owner:** Primary agent.

**Files:** User preference model/request/service/tests, `types.ts`, `types/app.ts`, `App.tsx`, mobile My component if separate, settings search registry if needed.

- [x] Add `toaster_studio_enabled` default false with legacy/partial update/user-isolation coverage.
- [x] Add personal settings toggle/Open action, conditional desktop navigation and mobile My entry.
- [x] Render workspace through lazy/Suspense with current audio, metadata, playback and back callbacks. Prepare the existing EQ graph through existing functions only; explicitly handle nonlocal output.
- [x] Run feature tests, full frontend lint/build and backend tests/vet/module verification/build.
- [x] Verify disabled/enabled/reloaded, unavailable/paused, generated code/MIDI/download, exit cleanup, and mobile/desktop layouts in a real browser.

### Task 4: Review and v0.18.0 release

**Owner:** Primary agent, with independent read-only reviewers.

- [x] Review core and UI tasks against the spec and resolve concrete findings.
- [x] Add MIT attribution, bilingual usage and changelog, bump frontend/package.json to 0.18.0 and regenerate embedded frontend assets.
- [x] Run a whole-change independent review and the required checks against final source.
- [ ] Commit changes on the integration branch, fast-forward main if safe, push main and annotated v0.18.0 without overwriting remote tags.
- [ ] Monitor CI/Binary/Docker completion, inspect release assets, publish the completed GitHub release and verify its public state.
