# Desktop backgrounds, equalizer and live spectrum

## Scope

Audit every desktop player style and app palette for clipped decorative backgrounds. Replace partial-rectangle glows with full-surface gradients, and fade component shader edges before they reach their containers. Physical record sleeves, decks and controls retain visible material edges.

Improve the desktop equalizer with a matte panel, zero/reference ticks, restrained accent color, precise vertical faders and explicit accessible labels. The gain graph must pass through the displayed band gains without the previous Gaussian sum exaggerating the response. Preserve presets, reset, on/off, focus trapping and Escape.

Replace the bottom player's generated waveform and looping VU bars with real frequency data. Reuse the existing analysis tap when available; otherwise capture playback passively in browsers that support it. Never create another MediaElementSource or alter playback routing just to draw a meter. Rebind captures on source reload; return to a quiet baseline on pause, silence or unavailable analysis. Keep the main seek control as the timeline.

## Motion

The background is a low-contrast playback-state cue using CSS transform/opacity and existing easing tokens. Pause it offscreen, in hidden pages and when playback stops; reduced motion keeps the static gradient. EQ changes follow input immediately; buttons use 140ms press feedback. Spectrum attack/release comes from the existing time-based audio envelope.

## Verification and release

Check 12 desktop player styles, all 21 palette tokens, representative light/dark screenshots and wide/narrow windows. Exercise EQ presets, keyboard and pointer adjustment, bypass/reset and dialog focus. Test live audio, source reload, quiet/loud passages, silence, pause/resume, reduced motion and cleanup without disturbing playback. Run frontend lint/build and focused UI/audio tests; verify the embedded frontend and backend build. Update version and bilingual changelog, commit and push the new tag after verification. Preserve the existing unrelated `mise.toml` change.
