# Mineradio Motion Fidelity Design

## Goal

Bring Lark's Mineradio Stage closer to the original Mineradio interface by restoring the visible motion channels that were missing from the previous pass: entry-screen particles and streaks, constantly breathing playlist shelf cards, lyric glow/particle motion, and a stronger WebGL stage loop.

## Original-Code Findings

The reference implementation in `/tmp/mineradio.umLLdD/Mineradio/public/index.html` is not a static dark stage. It uses independent frame-driven systems:

- `drawMineradioSplash()` and its WebGL fallback draw scanlines, drifting dust, horizontal streaks, shards, a center signal slit, wave distortion, and timed flash events during entry.
- `makeShelfManager().placeCard()` computes `centerSmooth`, `shelfVisibility`, `floatMix`, `breathPulse`, reveal easing, pane easing, pointer parallax, selected lift, opacity, and render-order changes every frame.
- `updateStageLyrics3D()` maintains `beatGlow`, `highBloom`, `glowFollowX/Y/Roll`, a star-river particle layer, current/outgoing lyric meshes, subtle float, beat-linked bloom, spark drift, and reduced brightness when shelf detail is open.
- The main `animate()` loop feeds shared time, playback energy, camera drift, particles, shelf updates, and lyrics into one continuously rendered stage.

Lark v0.9.19 already has the broad layout and a Three.js canvas, but most of those systems are reduced to low-amplitude rotation or CSS hover transforms. That is why screenshot feedback says several regions still look unmoved.

## Scope

This pass only changes the desktop Mineradio Stage theme. Mobile remains on the normal mobile player path. The implementation stays in the existing React/Three.js component and global CSS rather than introducing a new animation library.

## Design

### Entry Screen

Add DOM layers inside `.mineradio-stage-splash` for:

- `mineradio-stage-splash-particles`: small drifting points.
- `mineradio-stage-splash-streaks`: angled moving light streaks.
- `mineradio-stage-splash-shards`: thin signal fragments near the center slit.

Keep the current wordmark and signal line, but add line blip/sweep animation and content exit motion. These layers mirror the original `splashDust`, `splashStreaks`, `splashShards`, and center slit behavior with CSS transforms instead of a second WebGL renderer.

### Playlist Shelf

Make each DOM card expose per-card motion variables:

- `--shelf-index`
- `--shelf-delta`
- `--shelf-abs-delta`
- `--shelf-parity`

Use them for an idle `mineradio-stage-card-breathe` animation and a selected `mineradio-stage-card-selected-pulse` animation. Selected cards float forward and slightly upward, matching the original `floatMix` lift. Non-selected cards remain solid cards, not ghost panels.

The Three.js shelf cards should also receive stronger `userData.base*` values and per-frame selected-card approximation so the canvas shelf no longer sits nearly static.

### Lyrics

Add a lyric motion shell that mimics the original star river and glow layers:

- A keyed lyric text node so lyric changes retrigger the entrance.
- A `mineradio-stage-lyric-river` decorative particle strip behind the lyric.
- A `mineradio-stage-lyric-glow` layer and shimmer/progress sweep on the text.

The effect must preserve readable fill color. Glow lives outside and behind the glyphs, following the original Desktop Lyrics Visual Baseline.

### Three.js Stage

Strengthen the existing scene rather than rewriting it:

- Use a real elapsed-time clock and smoothed `energy`, `beatPulse`, and `shelfVisibility` values.
- Add particle position breathing by mutating the position attribute from stored base coordinates.
- Make beam opacity, aura scale, camera position, and shelf-card depth respond to energy.
- Store each shelf mesh's base position, phase, and selected slot in `userData` and animate transform/opacity every frame.

### Accessibility and Performance

Respect `prefers-reduced-motion`: the Three.js loop renders once when reduced motion is active, CSS animations are disabled, and DOM layers remain visible but still. Animate only `transform`, `opacity`, and `filter`. No layout-affecting animation is introduced.

## Files

- `frontend/src/components/player-themes/MineradioStagePlayer.tsx`: add splash particle markup, lyric motion markup, shelf motion variables, and stronger Three.js per-frame motion.
- `frontend/src/styles.css`: add CSS animation layers and keyframes for splash, shelf, lyric, signal, and reduced-motion behavior.
- `frontend/scripts/check-mineradio-motion.mjs`: static regression check for the required motion channels.
- `frontend/package.json`: add `test:mineradio-motion`.
- `README.md`, `README_ZH.md`, `CHANGELOG.md`: document the Mineradio code-reading pass and update release notes.

## Verification

Run:

- `pnpm test:mineradio-motion`
- `pnpm lint`
- `pnpm build`
- `go test ./...`

Then run the built app and verify visually:

- desktop splash animates before entering;
- desktop shelf cards continue breathing and selected cards float forward;
- lyric region has readable glow and particle river;
- canvas pixels change frame-to-frame while playing;
- mobile width still uses the normal mobile layout.
