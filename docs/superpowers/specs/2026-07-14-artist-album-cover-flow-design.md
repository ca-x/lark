# Artist Album Cover Flow Design

## Goal

Add an in-context view control to the artist album surface so users can switch between the existing album grid and a polished 3D Cover Flow. Replace the current landscape-card `showcase` presentation with a Lark-native adaptation of [`opc8838-hub/cover-flow-showcase`](https://github.com/opc8838-hub/cover-flow-showcase) at commit `eda6308e7e936a0d51b3602640dd870ce76693bd`.

The feature must preserve Lark's album data, open/play behavior, theme system, saved user preference, mobile layout, and embedded frontend release flow. The next release is `v0.9.37`.

## Decision

Use a hybrid implementation rather than keeping either implementation unchanged.

- Keep Lark's existing `ArtistAlbumDisplayStyle` preference and its `classic | showcase` values so no backend migration is required and existing saved preferences remain valid.
- Keep Lark's album loading, cover URLs, fallback rendering, open-album action, play-album action, localization, and personal preference synchronization.
- Replace the current showcase's triplicated scroll-snap list and landscape promotional cards with the reference repository's single-list circular position model, continuous 3D transforms, depth, dimming, reflection, wheel navigation, and snap-to-center behavior.
- Do not copy the reference's hover-driven navigation. Cover Flow moves only after an intentional drag, touch drag, wheel action, dot/counter action, or keyboard command.
- Keep the classic grid as the default for users without a saved preference. Once changed, the selected view continues to be saved through the existing local and server-backed preference path.

This direction was approved through the user's explicit delegation to choose and self-review the frontend solution.

## Interaction Design

### View Switcher

When an artist detail page is on its Albums tab, show a compact two-option segmented control beside the Songs/Albums tabs:

- Grid: selects `classic`.
- Cover Flow: selects `showcase`.

Each option is a real button with an icon, localized label or tooltip, visible focus state, and `aria-pressed`. Press feedback uses a subtle `scale(0.97)` transition. The control changes the existing global artist-album display preference, so it remains synchronized with Personal Settings.

The switch itself uses a short state transition, but the content does not perform a long cross-page entrance animation. Frequent view switching should feel immediate.

### Cover Flow Navigation

- The active album is centered, largest, fully saturated, and frontmost.
- Nearby albums rotate away in 3D, move laterally and backward, and gradually dim or blur with distance.
- The list wraps continuously without rendering three copies of every album.
- Dragging captures the active pointer after the movement threshold. Releasing settles to the nearest album.
- Touch preserves vertical page scrolling through `touch-action: pan-y`; horizontal intent moves the flow.
- Mouse wheel and trackpad input move the continuous position and settle after input stops.
- Clicking a side cover centers it. Clicking the centered cover opens the album.
- The centered album exposes a separate play control, preserving both open and play actions.
- Left/Right changes the active album without an animated keyboard delay. Enter opens the active album; Space plays it.
- For up to twelve albums, show pagination dots. For larger discographies, show a compact localized `current / total` indicator so the control never overflows.

### Visual Treatment

The stage borrows the reference's black liquid-glass depth, cover reflections, and perspective, but uses Lark theme tokens for border, accent, surface, and focus colors. Album covers remain square rather than adopting the reference's poster aspect ratio.

Geometry is responsive and derived from the measured stage and card size instead of fixed reference dimensions. Desktop gets a wide stage with several visible side covers; mobile keeps a smaller center cover and fewer visible neighbors without horizontal page overflow.

Remove the current showcase's permanent breathing, sweep, cover-drift, and play-pulse loops. Motion should explain navigation and depth, not keep moving while the user is reading.

## Component Architecture

### `CollectionView`

Add `onArtistAlbumDisplayStyleChange` beside the existing `artistAlbumDisplayStyle` prop. Render the view switcher only for an artist collection while its Albums tab is active. The root `App` passes the existing `setArtistAlbumDisplayStyle`, preserving current local-storage and server preference effects.

### `ArtistAlbumBrowser`

Keep the public browser component as the boundary between classic and showcase modes. The classic grid remains behaviorally unchanged.

Rebuild `ArtistAlbumShowcase` around:

- one rendered album list;
- refs for the continuous position, target, pointer state, animation frame, settle timer, and card elements;
- a wrap function for circular indexes and positions;
- direct per-card transform/opacity/filter updates for gesture frames;
- React state only for semantic active-index changes and visible active-album metadata;
- `ResizeObserver` geometry refresh;
- cleanup for animation frames, timers, and pointer capture.

The component introduces no animation dependency. Gesture-driven motion uses `requestAnimationFrame`; predetermined button feedback and visual state changes use CSS transitions.

### Styles

Replace the old showcase style block with narrowly scoped Cover Flow stage, card, reflection, active-info, pagination, focus, mobile, and reduced-motion rules. Animate only `transform`, `opacity`, and restrained `filter` changes. Do not use `transition: all`.

## Data and Preference Flow

1. `App` loads `artist_album_display_style` through the existing user-preferences API and local fallback.
2. `CollectionView` receives the current value and setter callback.
3. The in-page switcher changes the same state used by Personal Settings.
4. Existing effects persist the change locally and to the authenticated user's preferences.
5. `ArtistAlbumBrowser` renders the classic grid or Cover Flow from the same `Album[]` data.

No API, database, Ent schema, or preference payload changes are required.

## Edge Cases and Accessibility

- Zero albums continues to use the collection empty state outside the browser.
- One album is centered without circular-navigation controls.
- Two albums wrap without duplicate DOM nodes or ambiguous active state.
- Missing cover images retain Lark's record fallback.
- Pointer cancellation and component unmount stop motion and release transient state.
- `prefers-reduced-motion` removes parallax, animated settling, and large transform interpolation while preserving immediate state changes, opacity, focus, and usability.
- The stage has a descriptive localized label. Cards and controls use real buttons, non-duplicated accessible names, and visible keyboard focus.
- The implementation must not place interactive buttons inside another button.

## Attribution

The reference repository is MIT licensed. Add its project name, URL, commit, and MIT attribution to `NOTICE.md`, and add a concise acknowledgement to both READMEs. No reference demo images, videos, or unrelated agent navigation assets are copied into Lark.

## Verification

Add a dedicated artist Cover Flow regression check and decouple artist showcase assertions from the Mineradio-specific check. The check should verify:

- the Albums-tab view switch is wired to the existing preference;
- the classic and showcase modes both remain available;
- the showcase uses a single album list and circular-position logic;
- drag, wheel, keyboard, reduced-motion, active open, and explicit play paths are present;
- the retired perpetual showcase keyframes are absent;
- attribution is present.

Run:

- the dedicated Cover Flow regression check;
- existing frontend scripted tests;
- `pnpm lint`;
- `pnpm build` and confirm embedded assets are regenerated;
- `go test ./...` in `backend`;
- browser verification at desktop and mobile widths for grid switching, drag, wheel, keyboard, active album opening, playback, missing covers, one album, and a large album list.

## Release

- Add bilingual `0.9.37` changelog entries.
- Change `frontend/package.json` from `0.9.36` to `0.9.37`.
- Rebuild and include `backend/web/dist`.
- Run the release review and version-consistency checks.
- Commit the implementation and release changes, push `main`, create annotated tag `v0.9.37`, and push the tag.
- Confirm the pushed branch and tag resolve to the intended release commit and inspect GitHub Actions status when available.
