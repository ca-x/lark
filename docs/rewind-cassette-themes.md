# Rewind cassette themes

## Scope

Three independently implemented cassette themes inspired by Rewind Echo:
`rewind-classic` (gray shell and paper label), `rewind-studio` (red shell),
and `rewind-crystal` (translucent ice-blue shell).
Available in both desktop home-player and mobile expanded-player settings.
Keep their preferences independent and persist all three IDs server-side.
Do not change existing themes, navigation, branding, audio pipelines or offline music.

## Reference audit (2026-11-05)

The first implementation was not visually adequate: a flat CSS cassette with
three palettes and generic controls missed the reference's physical construction.
The official App Store page provides two HLS previews. Downloaded the complete
886×1920 and 332×720 videos and inspected two-second storyboards and four-fps
sequences of the rack and loading transitions; downloaded the full-size screenshots.
Reference assets stay outside the repository and are not distributed.

The revision must reproduce the construction, not the reference's branding:
100:64 shell proportions, bevels and actual side walls, recessed transparent
window, separate tape packs and toothed hubs, guide holes and screws, thin paper
label above an artwork-derived insert, and directional light on molded plastic.
The player needs a warm gray chassis, an inset black listening room, fine progress
ticks, and separate black mechanical keys with an orange-red playback switch.
Desktop uses the same machine, with a wider listening room rather than a phone
mockup or a generic two-column card.

## Interaction contract

- Click/tap or keyboard-activate the cassette to inspect its two physical sides;
  the Artwork button displays the user's full album cover.
- Horizontal swipes/drags change tracks; vertical scrolling and cancelled/multi-pointer gestures never change tracks or flip.
- A stationary 520 ms hold shows the current album's tracks when it is in the
  library; otherwise it opens the existing queue. Release must not flip or skip.
- The cassette rack shows actual library albums, with inclined faces and labelled
  spines. Click plays the album, long press or the visible details button opens
  its real track list. A button switches the rack between inclined and face-on.
- The rack loads unfiltered library album pages independently of the main library's
  current artist/favorites/page filters, with explicit load-more and retry controls.
- Track-list loading, failure and empty states are explicit; stale requests must
  not replace the selected album. Selecting a track uses the existing player.
- Visible, labelled previous/next and queue buttons provide non-gesture alternatives.
- Drag tilt is bounded, local and interruptible. Actual 3D rotation and a short
  out/in loading sequence make shell thickness visible; mechanical keys use 120 ms.
- Playing reels indicate state, not audio analysis. Pause, document hiding and off-screen state stop them.
- Reduced motion removes tilt and flip transitions but keeps slow, playback-gated reels.
- WebGL failure retains a usable detailed fallback, all transport controls and
  collection browsing; preview cards do not create WebGL contexts.

## Verification

- Frontend lint/build and gesture unit tests; backend preference normalization tests.
- Contrast checks include all three mobile palettes.
- Browser checks at phone, landscape, tablet and desktop widths: geometry, flip, swipe, hold, cancellation, queue, keyboard, motion and persistence.
- Capture and inspect the new black-screen/chassis composition, model at multiple
  angles, all three materials, inclined/face-on rack, album tracks and transitions.
- Existing player-motion and desktop/mobile layout regression gates.
- Publish the next available `0.18.x` only after checks; verify workflows, binary assets and published release metadata.
