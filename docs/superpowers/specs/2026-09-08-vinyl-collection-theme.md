# Vinyl collection desktop theme

Reference: https://vinyls.sandheep.xyz, inspected 2026-09-08.

## Scope and visual direction

An additional `vinyl-collection` desktop home player for Lark. Walnut and brushed metal, square record sleeves and a perspective record shelf. UI surfaces map through scoped CSS variables to Lark panel, text, line and accent tokens in all global light/dark palettes; the original physical SVG materials retain their colors. Existing React/TypeScript playback callbacks and scoped CSS are the implementation strategy; no new runtime dependency. Mobile keeps its independent theme selection.

The reference supplies the physical sleeve-to-platter interaction; Lark's existing album browser supplies actual albums and tracks; its existing turntables establish playback and seek integration. The reference's original static SVG deck, record, fixtures and tonearm materials are stored locally at the user's explicit request, with provenance beside the assets.

## Behavior and acceptance

- Follow global track changes in the sleeve, active track and album label, including albums outside loaded shelf pages; manual browsing lasts until the next track change.
- Rotate the full record texture and album label about the SVG spindle at (252, 250.5); keep the spindle hardware stationary.
- Fit deck, sleeve and shelf together to available width and height through a shared CSS size variable; preserve minimum readable controls on compact windows.
- Select and persist the theme through Settings, including backend user preferences.
- Browse library albums with independent 60-album pagination, total counts and retry, via cover selection, previous/next record buttons, arrow keys, wheel and horizontal drag. Browsing does not interrupt playback.
- Sleeve front shows real cover art; flip reveals actual album tracks. Click a track or click/drag the protruding record onto the deck to play through the existing queue.
- Abort stale track requests when selection changes; expose loading, empty, failure and retry states. No invented tracks or durations.
- Animate the record from sleeve to platter, rotate only during actual playback, move the original arm from rest (3 degrees) to lead-in (24.1 degrees) through run-out (48.5 degrees), and lift on pause.
- Play/pause, previous/next track, seek, volume and play mode control real playback. Disc dragging previews seek and commits on release.
- Motion is interruptible, respects reduced motion, pauses when offscreen/hidden, and has no timer that starts audio later.
- Controls remain keyboard accessible; check desktop and compact widths, missing artwork, long labels and rapid album changes.

## Implementation and verification

1. Store reference static artwork and its provenance; add the scoped player and album loading.
2. Connect theme types, normalization, settings, translations, and backend whitelist.
3. Run `pnpm --dir frontend build`, targeted ESLint, and `go test -race ./internal/library -run 'TestUserPreferences|TestVinylCollection'` in backend.
4. Browser-check the actual home/settings integration and interactive component with controlled fixture audio, including transition and seek behavior.

Changes stay within this theme, its persistence, docs and meaningful tests. The pre-existing mise.toml edit is outside this work.
