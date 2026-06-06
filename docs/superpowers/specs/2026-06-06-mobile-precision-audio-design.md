# Mobile Precision Audio Redesign

Date: 2026-06-06
Status: Approved direction, pending implementation plan
Scope: Lark mobile web experience

## Summary

Redesign the mobile experience around a single premium default direction:
`Quiet Studio / Precision Audio`.

The current mobile app is functional, but it feels less refined because the
mobile surface is split across seven independent player themes, dense card
layouts, repeated navigation, and layered CSS overrides. The redesign should
not add another decorative theme. It should make the default mobile experience
feel coherent, quiet, expensive, and easier to operate.

The default `neon-console` value should be visually reworked into the new
Precision Audio default so existing saved preferences do not break. Other
mobile themes may remain as optional expressive styles, but they should not
define the baseline interaction model.

## Design Thesis

Visual thesis: a high-end pocket audio deck in graphite, warm ivory, and brass,
with album artwork as the primary visual asset and UI chrome as precision
hardware.

Interaction thesis: a clear mobile music pattern, persistent mini player to
full-screen now playing, visible controls for critical actions, and sheets for
secondary tools.

Engineering thesis: change only the mobile namespace first, preserve playback
logic, preserve desktop behavior, and use existing `data-mobile-theme` and
`data-mobile-player-expanded` shell state as the stable boundary.

## Current Problems

1. Visual DNA is fragmented.
   - The mobile app has `neon-console`, `indiewave`, `editorial-pulse`,
     `soft-vinyl`, `stage-glass`, `blue-halo`, and `smartisan-classic`.
   - These themes have character, but together they create a patchwork feel.
   - The default is not quiet or premium enough.

2. The home screen has too many equal-weight cards.
   - Now playing, highlight, library hub, featured picks, quickplay, and
     recommended lists compete for attention.
   - There is no single main stage.

3. Navigation is duplicated.
   - `MobileBottomNav` already provides primary navigation.
   - `MobileHomeSurface` also includes home/library/favorites/playlists tabs.
   - This makes the mobile hierarchy feel unsure.

4. The mobile player model is mixed.
   - Mini player, full-screen art player, and desktop footer controls coexist
     under the same footer and are hidden by CSS.
   - The mini player only expands from the cover button, not the full row.

5. Lyrics and sheets are powerful but crowded.
   - Lyrics top controls carry cover, title, metadata links, offset tools,
     favorite, candidates, and editing access.
   - Queue and sound sheets need stronger dialog semantics and consistent
     material.

6. CSS risk is high.
   - `mobile.css` has many repeated `@media (max-width:720px)` blocks.
   - Core selectors such as `.app-shell`, `.player`, `.main`, and
     `.mobile-bottom-nav` are redefined in several areas.
   - A broad rewrite would be risky.

## Goals

- Make the default mobile experience visibly more premium and coherent.
- Reduce visual noise and theme fragmentation.
- Make album artwork the strongest visual anchor.
- Keep the mobile app fast on mid-range phones.
- Preserve all existing playback, queue, lyrics, offline, radio, and settings
  behavior unless explicitly listed below.
- Improve mobile accessibility and touch clarity.
- Keep the implementation reviewable and staged.

## Non-Goals

- Do not rewrite desktop UI.
- Do not rewrite `App.tsx` playback, queue, lyrics, and settings state logic.
- Do not add a new eighth mobile theme as the primary solution.
- Do not migrate to a new UI framework.
- Do not redesign every settings and library screen in the first pass.
- Do not rely on hidden gestures for critical actions.

## Visual Direction

Name: `Precision Audio`

Mood:
- Quiet
- Tactile
- Instrument-like
- Album-art-forward
- Low-glare
- Confident rather than flashy

Material:
- Graphite body
- Warm ivory text
- Brass accent
- Subtle inner highlights
- Soft ambient shadows
- Minimal glow

Avoid:
- Purple and blue glass gradients
- Decorative orbs
- Strong bokeh
- High-saturation poster backgrounds
- Generic gray borders
- Heavy black drop shadows
- Constant spinning decoration outside the artwork context

## Design Tokens

Dark default:

```css
--mobile-pa-bg: #0B0D10;
--mobile-pa-surface: #12161B;
--mobile-pa-surface-raised: #1A2027;
--mobile-pa-text: #F2EEE6;
--mobile-pa-muted: #AFA79B;
--mobile-pa-line: rgba(242, 238, 230, .10);
--mobile-pa-accent: #D6B36A;
--mobile-pa-danger: #D95B55;
--mobile-pa-shadow: 0 24px 70px rgba(0, 0, 0, .32);
--mobile-pa-inner: inset 0 1px 0 rgba(255, 255, 255, .08);
```

Light companion, for future parity:

```css
--mobile-pa-bg: #F6F3ED;
--mobile-pa-surface: #FFFDF8;
--mobile-pa-surface-raised: #ECE6DA;
--mobile-pa-text: #171512;
--mobile-pa-muted: #706A60;
--mobile-pa-line: rgba(23, 21, 18, .10);
--mobile-pa-accent: #9D7433;
--mobile-pa-danger: #B74640;
```

Typography:
- Remove `Inter` as the default app font.
- Preferred Latin stack: `Geist`, `Plus Jakarta Sans`, then system UI.
- Preferred CJK stack: `PingFang SC`, `MiSans`, `Noto Sans SC`, then system UI.
- Keep CJK letter spacing at `0`.
- Reduce excessive 850 and 900 weights.
- Player title: 22 to 26px, 700 weight, line-height 1.15 to 1.22.
- Card/list title: 15 to 17px, 650 to 700 weight.
- Labels: 11 to 12px, no aggressive uppercase.

Shape:
- Full-screen player: 0px at screen edge or 32px for inner panels.
- Mini player and nav dock: 24px.
- Cards: 16 to 20px.
- Artwork: 12 to 16px.
- Icon buttons: round.

Motion:
- Press feedback: 80ms.
- State transitions: 180 to 240ms.
- Sheet enter: 280 to 360ms.
- Mini to full-screen expansion: 420 to 520ms.
- Easing: `cubic-bezier(0.32, 0.72, 0, 1)`.
- Animate only `transform` and `opacity`.
- Keep `prefers-reduced-motion` support.

## Information Architecture

Bottom navigation remains the primary mobile navigation:

1. Home
2. Library
3. Favorites
4. Playlists

The home page should remove its duplicate nav tabs. It may keep quick actions,
but those actions must not mirror the bottom nav as another tab bar.

Library should become the place for Albums, Artists, Folders, Radio, and
Management. This can be handled by existing views first, then refined later
with a dedicated mobile library hub.

Settings/Profile stays behind the top-right user entry.

## Home Screen Model

The mobile home screen should have three clear zones:

1. Now playing stage
   - Large artwork or artwork-driven surface.
   - Song title, artist, album.
   - One main play/pause affordance.
   - Optional compact status such as offline/radio/network source.

2. Library shortcuts
   - Albums, Artists, Playlists, Radio or Folders.
   - Compact, horizontally scannable, not a wall of same-weight cards.

3. Recommendations
   - A short list or strip.
   - Prioritize recently played/recently added/recommended songs.
   - Keep rows tactile and readable.

## Mini Player Model

The mini player should become one row with clear behavior:

- Entire row opens full-screen player.
- Artwork remains left.
- Title and artist stay center.
- Right side keeps play/pause and queue.
- Previous/next should move to the full-screen player unless there is enough
  horizontal space.
- Progress is a quiet hairline integrated into the shell.
- Press feedback applies to the whole row and independent buttons.

## Full-Screen Player Model

The full-screen player should be the main premium moment.

Layout:
- Top: back, now playing label, more menu.
- Center: large artwork, not buried inside decorative machinery.
- Below artwork: title, artist, album.
- Lower control zone: progress, time, previous, play/pause, next, mode.
- Secondary action rail: favorite, lyrics, queue, sound effects, sleep timer.

Interaction:
- Tap mini player to expand.
- Swipe down or back button to collapse.
- Critical controls remain visible.
- Queue, lyrics, sound effects, and sleep timer open consistent sheets or
  subviews.

## PC Home Player Effect Reuse

If the mobile full-screen player still does not feel refined enough after the
Precision Audio pass, adapt selected effects from the existing desktop home
player themes instead of inventing unrelated mobile decoration.

Good desktop effects to translate:

- `VinylTurntable`: tonearm progress, VU meter, deck/plinth material, RPM/LED
  status, precision knobs, and progress rail.
- `AlbumSlidePlayer`: artwork-forward cover stack and the visible vinyl rail
  behind the cover.
- `SmartisanTurntable`: restrained turntable deck, titlebar discipline, and
  needle angle tied to playback progress.
- `AudioScopePlayer`: compact scope/meter language, only if it remains calm
  and does not dominate the artwork.

Mobile adaptation rules:

- Reuse visual ideas and small UI mechanics, not desktop layout proportions.
- Keep artwork as the largest object on the screen.
- Keep controls touch-safe at 44px or larger.
- Avoid continuous heavy filters, large backdrop blur, and layout animation.
- Tie any animated tonearm, meter, or scope to existing playback state and
  reduced-motion preferences.
- Prefer replacing weak current mobile chrome with one or two precise desktop
  effects over stacking multiple effects.

## Lyrics Model

Lyrics should be a subview of Now Playing, not a separate dense tool surface.

Top bar:
- Back to player.
- Compact song summary.
- More/settings button.

Main:
- Lyrics lines with strong readability and large touch spacing.
- Active line should feel focused, not overdecorated.

Settings sheet:
- Candidate lyrics.
- Offset adjustment.
- Metadata edit entry.
- Drag-seek setting.

Accessibility:
- If a lyric line can seek, it should be a button or expose a separate
  keyboard-accessible "play from here" control.
- Do not use paragraph click handlers as the only interactive path.

## Queue and Sheets

All mobile sheets should share one material system:

- Scrim with restrained blur only for modal layers.
- Sheet with handle, title, close button, and optional primary action.
- `role="dialog"` and `aria-modal="true"` where appropriate.
- Focus should move into the sheet and return to the trigger on close.

Queue sheet states:
- Summary state
- Full queue state
- Edit state

Edit functions may be phased later, but the visual shell should allow them.

## Radio Fix

The current mobile route behavior should be corrected:

- `MOBILE_PLAYBACK_VIEWS` should include `radio`, or radio should be routed
  through an allowed mobile library subview.
- Mobile radio entry points must not immediately bounce back to Home.

## Implementation Boundary

First pass may touch:

- `frontend/src/components/mobile/MobileBottomNav.tsx`
- `frontend/src/components/mobile/MobileHomeSurface.tsx`
- `frontend/src/components/mobile/MobileMiniPlayer.tsx`
- `frontend/src/components/mobile/MobilePlayerDock.tsx`
- `frontend/src/components/mobile/MobileSoundPanel.tsx`
- `frontend/src/components/player-themes/MobileArtPlayer.tsx`
- `frontend/src/mobile.css`
- `frontend/src/styles.css`, only for font stack or shared tokens if required
- `frontend/src/types.ts`, only if theme typing must be unified
- `frontend/src/App.tsx`, only for minimal routing/ARIA/interaction wiring

Do not touch backend APIs for this redesign unless a frontend bug requires it.

## Phased Plan

Phase 0: Baseline
- Capture mobile screenshots at 360x740, 390x844, and 430x932.
- Cover Home, Library, Settings, mini player, full player, lyrics, queue, and
  sound panel.
- Record current mobile route behavior for radio.

Phase 1: Token and shell cleanup
- Define Precision Audio tokens under `.app-shell[data-mobile-theme]`.
- Keep the existing default value stable.
- Avoid broad CSS reordering.

Phase 2: Navigation and mini player
- Remove duplicate home tabs or demote them to shortcuts.
- Make the whole mini player expandable.
- Keep play/pause and queue accessible.
- Refine bottom nav material, active state, and touch geometry.

Phase 3: Home surface
- Build a stronger now-playing stage.
- Reduce equal-weight cards.
- Improve artwork loading strategy, using eager only for the hero/current
  artwork and lazy loading for list artwork.

Phase 4: Full-screen player
- Rework default `neon-console` presentation into Precision Audio.
- If the result is still not refined enough, adapt one or two existing PC home
  player effects, prioritizing tonearm progress, VU status, cover stack, or
  precision deck material.
- Keep the other optional themes functional.
- Add consistent secondary action rail.
- Preserve swipe-down collapse.

Phase 5: Sheets and accessibility
- Unify queue and sound panel material.
- Add missing dialog semantics.
- Improve focus management where feasible.
- Move lyrics tools into a cleaner settings sheet if included in this pass.

Phase 6: Validation and polish
- Run lint/build.
- Verify mobile screenshots.
- Check reduced motion.
- Check long Chinese and English strings.
- Check radio, offline, network track, no-song, no-lyrics, and long queue states.

## Verification

Required commands:

```bash
cd frontend
pnpm lint
pnpm build
```

Manual viewports:
- 360x740
- 390x844
- 430x932
- Short height below 740px
- Landscape mobile

Manual states:
- No song loaded
- Song playing
- Song paused
- Radio playing
- Network track
- Offline cached track
- No lyrics
- Candidate lyrics available
- Long queue
- Settings input with keyboard open

Accessibility checks:
- Bottom nav exposes active page.
- Icon-only buttons have labels.
- Sheets expose dialog semantics.
- Focus is visible.
- Range controls have names and values.
- Reduced motion does not leave broken states.

## Implementation Decisions

1. Rename the visible default mobile style label from "Hardware console" to
   "Precision Audio". Keep the stored value as `neon-console` for compatibility.
2. Leave the full lyrics settings sheet for a second pass. The first pass may
   reduce top-bar clutter and fix obvious accessibility gaps, but should not
   restructure every lyrics tool before the player shell is stable.
3. Use manual mobile screenshots for the first pass. Add Playwright mobile
   screenshot testing as a follow-up after the redesign stabilizes.

## Approval Criteria

The redesign is acceptable when:

- The default mobile experience feels like one coherent product.
- Album artwork is the first visual anchor.
- Mini player expansion is obvious and works from the whole row.
- Bottom navigation and home shortcuts no longer feel duplicated.
- Full-screen player feels calmer, more premium, and easier to operate.
- Any PC player effect reuse feels native to mobile, touch-safe, and
  performance-safe.
- Radio no longer bounces back to Home on mobile.
- Existing desktop behavior is unchanged.
- `pnpm lint` and `pnpm build` pass.
