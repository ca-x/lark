# Mineradio Stage High-Fidelity Design

## Goal

Rebuild Lark's desktop Mineradio Stage so entering the theme feels like entering the reference project's visual space, not viewing a Mineradio effect inside a normal Lark home card. The source of truth is `/home/czyt/code/ref/Mineradio` at commit `6b130103f759e5dcd1e133700071c8216b8fa5a6`.

Lark keeps its own library, playback engine, preferences, accessibility behavior, and mobile player. Mineradio's login, online music sources, Electron shell, and unrelated home-page product flows are out of scope.

## Direction Decision

Three approaches were considered:

1. **Decorate the existing hero.** Lowest implementation risk, but the sidebar, top bar, bottom player, and home dashboard keep splitting the visual hierarchy. This is the current failure mode and is rejected.
2. **Copy the reference application shell.** Highest literal similarity, but it would duplicate navigation, authentication, media sources, and player state that Lark already owns. This is rejected as unnecessary and fragile.
3. **Full-stage takeover with Lark controls.** The desktop home screen becomes a viewport-filling dark stage while the Mineradio theme is active. Existing Lark playback state drives the scene, and application navigation remains available as a subdued edge layer. This is the selected approach.

## Experience Model

### Entry Sequence

The stage opens with a full-viewport launch screen. Its sequence follows the reference rhythm:

- the short brand word appears first in a bright central ignition field;
- diagonal fractures, scanning texture, dust, and chromatic light move around the word rather than behind a rounded panel;
- the `radio` suffix resolves into the final wordmark;
- a fine signal rail, `PRIVATE VISUAL RADIO`, and `点击进入` appear only after the wordmark settles;
- clicking, Enter, or Space reveals the playback stage immediately.

The entry screen is rare and explanatory, so it may use a longer cinematic sequence. Repeated playback, seek, next, previous, and mode controls remain immediate and use only short press feedback.

### Application Takeover

On desktop home with `mineradio-stage` selected:

- the ordinary home dashboard, discovery cards, and shelves are not rendered;
- the main region fills the viewport with no rounded container, outer padding, or clipped hero height;
- the standard top bar and player bar leave the primary composition;
- the existing sidebar becomes a narrow edge navigation layer with low idle opacity and full visibility on hover or keyboard focus;
- leaving the home view restores the normal Lark shell without changing the saved player theme.

Mobile continues to use `MobileHomeSurface` and is not changed by this design.

### Playback Stage Composition

The playback stage uses a single spatial hierarchy:

1. black field, vignette, scan texture, smoke, and light shafts;
2. WebGL cover particles as the dominant visual object;
3. title and artist metadata anchored clear of the particle focal area;
4. lyric glow in the same camera space;
5. the playlist shelf on the right, remaining behind the lyric plane until a card is selected;
6. a compact control console that does not compete with the artwork.

The physical DOM cover, vinyl disc, and DOM particle cloud are fallback layers only. They must not remain visibly stacked on top of the WebGL cover when WebGL is available.

### Audio Response

The existing analyser remains the input. Response channels use different attack/release envelopes:

- bass controls camera punch, cover depth, and beat ripples;
- vocal and mid bands control lyric solar glow;
- treble controls fine particles and beam detail;
- the aggregate signal controls scene energy and smoke brightness.

If browser audio analysis is unavailable, a restrained playback-linked fallback keeps the stage alive without pretending to match the audio precisely.

### Motion and Input

- Pointer cover drag remains interruptible and retains inertial rotation.
- Shelf wheel handling is scoped to the shelf itself and does not create a page-wide scroll trap.
- Buttons use `transform: scale(0.97)` press feedback in 100-160ms.
- Hover-only polish is gated behind `(hover: hover) and (pointer: fine)`.
- Predetermined ambient motion uses CSS or WebGL transforms and opacity; no layout properties animate.
- The Three.js loop uses `performance.now()` wall-clock deltas instead of the deprecated `THREE.Clock` API.

### Reduced Motion and Fallbacks

With `prefers-reduced-motion: reduce`:

- the dark material, readable wordmark, cover, lyrics, shelf, and opacity reveals remain;
- camera travel, large rotations, fracture flight, and continuous particle drift stop;
- the scene renders a stable frame and all controls stay fully usable.

If WebGL creation fails, the DOM cover and particle fallback become visible and the rest of the stage remains usable.

## Architecture

### `App.tsx`

`HomeView` receives the same playback and library inputs. After the mobile branch, it returns a dedicated `home-view-mineradio` branch when `homePlayerStyle === "mineradio-stage"`. The ordinary desktop dashboard is not mounted in that branch.

### `MineradioStagePlayer.tsx`

The component continues to own the launch screen, stage markup, audio analyser, Three.js scene, cover gesture, lyric presentation, and playlist shelf. The pass simplifies visual competition rather than adding a new rendering library.

The root exposes stable markers for runtime and static verification: entry state, WebGL availability, cover rendering mode, shelf presence, and audio-reactive mode.

### `styles.css`

Mineradio selectors define the desktop shell takeover, full-viewport layout, launch phases, stage composition, edge navigation, fallback visibility, and responsive height rules. Other themes keep their existing shell and hero styling.

### Regression Check

`check-mineradio-motion.mjs` is extended from motion-string presence checks to assert the structural invariants introduced by this pass:

- dedicated Mineradio home branch;
- ordinary home dashboard excluded from that branch;
- full-stage takeover selectors;
- WebGL-primary / DOM-fallback markers;
- wall-clock render loop with no `new THREE.Clock()`;
- reduced-motion and scoped shelf interaction rules.

## Verification

Automated verification:

- `cd frontend && pnpm test:mineradio-motion`
- `cd frontend && pnpm lint`
- `cd frontend && pnpm build`
- `cd backend && go test ./...`
- `cd backend && go vet ./...`

Browser verification at 1440x900 and 1366x768:

- early launch word;
- settled launch wordmark and enter prompt;
- post-entry empty/standby stage;
- playing stage with cover particles;
- active lyric with and without a shelf;
- shelf keyboard and wheel selection;
- WebGL fallback marker and visible DOM fallback;
- reduced-motion rendering;
- leaving home restores the normal shell.

At 375px width, the normal mobile home/player path must remain in use.

## Release

This change ships as `v0.9.38`. Update the frontend package version and bilingual changelog, rebuild embedded frontend assets, commit the intended files, push `main`, create an annotated `v0.9.38` tag, push the tag, and verify both branch CI and tag-triggered release workflows.
