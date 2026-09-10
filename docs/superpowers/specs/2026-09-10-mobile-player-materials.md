# Player materials and audio response

## Objective

Refresh Soft vinyl, Gramophone, Stage glass and Blue halo using original CSS/SVG artwork inspired by the supplied player references. Add Moss waves, Deep sea, Amber tape and Clear tape as independent themes. Preserve existing preference IDs and player controls. Polish the desktop Running kitten and Gramophone, and make Mineradio respond to the current song.

## Implementation

- React/TypeScript: shared decorative artwork in `frontend/src/components/player-themes/MobilePlayerArtwork.tsx`, with a scoped stylesheet and a static theme picker preview.
- Theme IDs and translated labels flow through the mobile picker, local preferences and the Go preference validator. No new dependencies or image downloads.
- White record grooves, metal tonearms, wood and speaker mesh, transparent tape shells, reels, waves and glass are drawn in code. Song artwork remains the only optional bitmap; missing covers have a built-in label.
- Continuous animation indicates playback. CSS transforms pause without rewinding when paused, hidden or outside the viewport. Reduced motion disables continuous motion. Spectrum is a decorative playback visualization, not measured audio data.
- Shared controls keep their accessible names, 44px targets, focus states, keyboard alternatives and safe-area insets. Portrait and landscape layouts share the same artwork.

## Verification

Run `pnpm lint`, `pnpm build`, `pnpm test:player-motion` in `frontend`; run `go test ./...` and `go vet ./...` in `backend`. Add preference round-trip coverage for the new IDs. Inspect the real components at 375×812, 390×844, 320×568 and 844×390, including missing/failed covers, pause/resume and reduced motion.

## Boundaries and release

Keep the existing precision deck, iPod, Indiewave and Smartisan artwork. Scope style rules to the affected players/previews. Do not modify the user's `mise.toml`. Once verified, update the minor version and bilingual changelog, commit, push main and a new annotated version tag as requested.

## Desktop refinement

- Redraw the kitten as a cream tabby with readable facial features, a grounded rim-treadmill gait and a separate sleeping pose. Keep the record spinning independently; pause all decorative work offscreen and honor reduced motion.
- Share a machined metal tonearm between mobile and desktop: bearing, counterweight, thin tube, yoke, screws and cartridge use separate shapes with narrow highlights.
- Register the existing EQ graph for visualisers. Mineradio connects its analyser to that output without making another MediaElementSource, changing volume or disconnecting playback. Resume an existing AudioContext before every play request, including when EQ is disabled.
- Sample 24 logarithmic frequency bands and RMS energy, preserve quiet/loud differences, use time-based attack/release, and emit one beat event per onset. Spectrum sampling runs without WebGL; unavailable input decays to rest instead of synthetic beats.
- Celestial motion uses elapsed seconds, song changes drive palette transitions, and the audio envelope drives scale and light. Missing WebGL falls back without unmounting the player.
- Verify audio reloads on the same HTMLAudioElement, bass versus treble, silence, and 30/60/120/144Hz beat behavior. Renderer availability and browser audio autoplay policies are checked separately from the signal model.
