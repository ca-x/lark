# Rewind cassette themes

## Scope

Three independently implemented CSS cassette themes inspired by Rewind Echo:
`rewind-classic` (gray shell and paper label), `rewind-studio` (red shell),
and `rewind-crystal` (translucent ice-blue shell).
Available in both desktop home-player and mobile expanded-player settings.
Keep their preferences independent and persist all three IDs server-side.
Do not change existing themes, navigation, branding, audio pipelines or offline music.

## Interaction contract

- Click/tap or keyboard-activate the cassette to flip between its label and the user's album artwork.
- Horizontal swipes/drags change tracks; vertical scrolling and cancelled/multi-pointer gestures never change tracks or flip.
- A stationary 520 ms hold opens the existing queue. Release after a hold must not flip or skip.
- Visible, labelled previous/next and queue buttons provide non-gesture alternatives.
- Drag tilt is bounded, local and interruptible. Flip uses a 280 ms transform transition, mechanical buttons 120 ms.
- Playing reels indicate state, not audio analysis. Pause, document hiding and off-screen state stop them.
- Reduced motion removes tilt and flip transitions but keeps slow, playback-gated reels.

## Verification

- Frontend lint/build and gesture unit tests; backend preference normalization tests.
- Contrast checks include all three mobile palettes.
- Browser checks at phone, landscape, tablet and desktop widths: geometry, flip, swipe, hold, cancellation, queue, keyboard, motion and persistence.
- Existing player-motion and desktop/mobile layout regression gates.
- Publish the next available `0.18.x` only after checks; verify workflows, binary assets and published release metadata.
