# Damir player themes implementation plan

> Execute inline with executing-plans, task by task. User subsequently authorized a tested new release and explicitly retained the 0.18.x series; target server/Web v0.18.1, without changing the independent desktop client.

**Goal:** Add functional Soft Static and Prism desktop player themes matching the verified video compositions.

**Architecture:** Independent React components share a small native transport component and finite playback normalization. Soft Static reuses artwork visibility, cover fallback and metal tonearm helpers. Prism uses geometric SVG light and CSS material, without a permanent render loop or WebGL requirement.

**Tech stack:** React 19, TypeScript, plain scoped CSS, existing Phosphor icons, Node test runner, Go 1.27 library tests.

**Spec:** `docs/superpowers/specs/2026-10-29-damir-player-themes.md`

## Global constraints

- Desktop-only IDs `soft-static` and `prism`; do not change selected preferences or mobile themes automatically.
- Genuine playback callbacks, current lyrics or metadata, no prerecorded player or fabricated audio analysis.
- Generated texture only; source videos remain investigation references, not application assets.
- No new dependencies or branches. Release only after verification, as subsequently requested by the user.
- Existing CSS motion tokens, visible keyboard focus, 44px input targets, reduced-motion/transparency and contrast support.
- Ruling: work in the supplied checkout, because higher-priority instructions forbid creating a branch without an explicit request.

## Review focus

- Unknown, nonfinite or changing duration must never produce invalid ranges or invalid seeks.
- Cover failure and long multilingual metadata must not destroy composition or controls.
- Pointer effects must not move keyboard actions, trap touch scrolling, or ignore reduced motion.
- The new themes must not replace the only usable radio or network-track controls.
- Both front-end normalization and back-end persistence must retain the new IDs independently of mobile/user preferences.

## Task 1: Shared native controls

Files: `frontend/src/components/player-themes/ConceptPlayerControls.tsx`, `conceptPlayback.ts`, `ConceptPlayers.test.mjs`.

Consumes: existing `PlayerThemeLabels` and `PlayerThemePlayMode`.
Produces: `ConceptPlayerProps`, `playbackPosition(progress, duration)` and `ConceptPlayerControls(props)`.

- [x] Write and run behavioral tests for play/pause, previous/next, mode, finite bounded seek and unavailable callbacks; confirm RED.
- [x] Implement shared transport and safe playback position; confirm GREEN.

## Task 2: Visual components and desktop integration

Files: `SoftStaticPlayer.tsx`, `PrismPlayer.tsx`, `concept-players.css`, theme `index.ts`, `frontend/src/main.tsx`, `frontend/src/App.tsx`, `frontend/src/types.ts`, `frontend/src/i18n.ts`.

Consumes: Task 1 props/controls plus existing `useArtworkActivity`, `useCoverFallback`, `MetalTonearm`, and HomeView `activeLyricText`.
Produces: two independently selectable, localized themes with real playback callbacks.

- [x] Extend behavior tests for live lyrics, cover failures, playing/paused state, split-light toggle and reduced-motion pointer guard; confirm RED.
- [x] Implement Soft Static's cropped marbled record, silver arm, static metadata orbit and readable live line.
- [x] Implement Prism's incoming light, glass panel, spectrum fan/reflection, accessible split/color controls and fine-pointer tilt.
- [x] Add scoped CSS, selectors and front-end registrations without touching existing theme layout or mobile routing.
- [x] Run component tests and type checking; confirm GREEN.

## Task 3: Persistence and real-browser verification

Files: `backend/internal/library/service.go`, `backend/internal/library/settings_test.go`, frontend build test command, this plan and spec.

Consumes: theme IDs and existing user preferences API.
Produces: durable per-user theme selection and evidence of behavior/rendering.

- [x] Add Go round-trip and user/mobile isolation tests; confirm RED before updating the whitelist.
- [x] Extend only the two allowed desktop values; confirm GREEN.
- [x] Run frontend build, lint, player-motion regression and focused backend tests.
- [x] Verify actual app in browser at 1440/1280px, compact desktop and 375px mobile; inspect both locales, theme persistence, playback, seek, pause/resume, missing covers, reduced motion and contrast/transparency preferences.
- [x] Perform a separate final review and fix task-scoped important findings with regression evidence.
- [x] Record verification and remaining differences from source video; no source material redistribution.

## Execution ledger

- Pre-flight: Task 2 consumes Task 1's transport contract; Task 3 shares the exact `soft-static`/`prism` IDs with Task 2. No interface conflicts.
- Approved difference: use real current lyrics/metadata rather than fabricated pitch notation; use an original procedural record texture.
- Baseline: existing `useDiscScratchSeek.test.mjs` passes 5/5.
- Component/route verification: 14/14 behavioral tests pass; the loading-placeholder-to-real-lyrics regression was observed RED and then GREEN.
- Preferences verification: both new values first failed by normalizing to vinyl, then passed persistence and user/mobile isolation tests after extending the whitelist.
- Release authorization: the user explicitly chose the 0.18.x series; update to 0.18.1 with bilingual notes and regenerated embedded assets, then commit/push/tag and publish after CI and artifact verification. This supersedes the original no-release scope.
- Independent final review found one Important issue, unbounded multilingual metadata; no other findings. The real 540px-high browser fixture reproduced Prism text extending to 1231px over controls at 442px, and Soft Static credits overlapping those controls. After bounding metadata, Prism ends at 364px and Soft Static at 388px, both above controls at 442px; the unabridged text remains accessible and tooltip regression is RED-to-GREEN. No deferred minor findings.
- Review boundaries: exact video fidelity remains explicitly approximate; no physical-device touch or audio-hardware claim. Real browser audio streaming, keyboard seek, pause, theme persistence, mobile routing and accessibility media were exercised.
- Browser evidence: 1440px and 1280px desktop, 900px compact and 375px mobile have no horizontal overflow; mobile renders the existing mobile theme. Chinese/dark and English/Apple light preserve each concept's local palette. Reduced motion stops record rotation while playback/seek remain available. CDP media emulation confirms reduced transparency uses opaque glass and hides reflection, with high-contrast and reduced-motion queries active. Axe reports zero violations, with manual contrast review required for SVG/image compositing.
- Release validation: after finalizing version `v0.18.1`, the frontend build again passes 97/97 tests, lint and player-motion checks pass; `go mod verify`, `go test ./...`, `go vet ./...` and focused preference tests with `-race` pass. A rebuilt CGO-disabled packaged server reports `v0.18.1`; its HTTP-served embedded entrypoint and generated JS/CSS assets exactly match the verified build by SHA-256. The bundle contains both themes and no reference-video URL.

| Before | After | Why |
| --- | --- | --- |
| Unbounded Prism metadata and Soft Static credits | Bounded lines with full-text tooltips | Long multilingual names cannot cover playback controls |
| Lyrics loading messages in the main line | Only active timed lyrics, otherwise track metadata | Status placeholders are not song lyrics |
| Light crossing small functional labels | Opaque local label/control surfaces | Optical effects must not reduce text legibility |

## Follow-up patch v0.18.2

- User identified the detached fingerlift after the v0.18.1 tag/image publication and requested a patch in the same 0.18.x series, plus the video's moving pink outer-arc cursor. Do not overwrite v0.18.1 or redesign the texture.
- Root cause: the shared fingerlift started beyond the headshell's right edge; Soft Static also moved the headshell down without moving the fingerlift or extending the tube. Move the shared lift base inside the shell and overlap the Soft Static tube and lift vertically.
- Cursor uses bounded real playback progress with transform-only interpolation, retains its paused position and follows seeking. A resize observer fits its arc to the visible platter; reduced motion removes interpolation, not playback controls.
- Regression evidence: the two connection checks and cursor check fail on v0.18.1, then pass after the fix. The actual browser initially reports a lift base at x=62 beyond the shell's right edge at x=59; the fix gives 2–5px overlap across Soft Static, Gramophone and mobile material arms at 1440×1000, 1280×720 and 900×640. All five sampled progress positions remain visible and the paused cursor matrix stays unchanged.
- Local release gates: 100 frontend tests, TypeScript/Vite build, lint, player-motion and Smartisan-tonearm checks pass. Go module verification, all backend tests, vet and the embedded v0.18.2 build pass. An isolated packaged-server smoke returns v0.18.2 and serves HTML/JS/CSS identical to the generated dist; both themes and the cursor ship without reference-video URLs. Independent patch review reports no Critical or Important findings.
