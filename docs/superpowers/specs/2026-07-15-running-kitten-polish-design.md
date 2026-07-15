# Running Kitten Player Polish Design

## Goal

Polish the existing desktop `奔跑的小猫` player theme without changing its playback contract, watercolor asset, saved theme id, mobile behavior, or ordinary home dashboard.

The current rendered surface already has a strong warm watercolor and black-vinyl composition. The main semantic defect is that the kitten lives inside the rotating record and only bobs vertically. It reads as a record logo, rotates with the disc, and does not consistently read as a running animal.

## Options

1. **CSS scale and spacing only.** Safest, but it leaves the kitten motion semantically wrong.
2. **Restore the old free-form `offset-path`.** Produces a full orbit, but the old fixed-coordinate path did not scale reliably with the platter and encouraged the cat to leave the visible groove.
3. **Independent upper-groove lap.** Move the kitten outside the rotating record, animate a bounded upper-track lap, counter-rotate its holder to keep the silhouette upright, flip its direction at each turn, and retain the short step bob. This is the selected approach.

## Visual Direction

The theme remains warm, illustrative, and tactile:

- watercolor sunrise and paper texture stay as the scene material;
- black vinyl remains the visual anchor;
- cream, brass, and copper remain the only interface accents;
- controls stay crisp and dark rather than becoming painterly;
- the kitten becomes a readable moving subject, not another shader layer.

No new image or font is required.

## Motion Model

The kitten uses three nested transform layers:

1. `running-kitten-cat-orbit` rotates through a bounded upper-groove arc and returns;
2. `running-kitten-cat-runner` applies the inverse rotation so the animal stays upright;
3. `running-kitten-cat-facing` flips horizontally at the turn and contains the existing short bobbing silhouette.

All three animations share one duration and pause when playback pauses. The record continues using its independent linear rotation. Because transforms are separated, record motion cannot reset or compound kitten motion.

The lap uses a full timeline rather than `alternate` so the direction flip has an explicit hold at each turn. The cat never enters the lower half of the platter, so it never appears upside down.

## Interaction Polish

- Playback buttons use 140ms exact-property transitions and `scale(.97)` press feedback.
- Hover changes are scoped to `(hover:hover) and (pointer:fine)`.
- Seek remains the existing invisible range input over a visible progress rail.
- Focus-visible outlines and 40px or larger hit areas remain intact.
- Remove the local `backdrop-filter`; the existing layered watercolor and opaque dark surface already provide enough depth.

## Reduced Motion

With `prefers-reduced-motion: reduce`, the record, kitten lap, step bob, paper shader, and decorative transitions stop. The kitten remains visible and upright on the upper groove, and all controls remain usable.

## Files

- `frontend/src/components/player-themes/RunningKittenTurntable.tsx`: move the kitten outside the spinning record and add the nested lap/facing structure.
- `frontend/src/styles.css`: add bounded lap, counter-rotation, direction flip, refined silhouette, exact control feedback, hover gating, and remove the local blur.
- `frontend/scripts/check-running-kitten-theme.mjs`: pin structural and motion invariants.
- `frontend/package.json`: expose `test:running-kitten`.

## Verification

- `cd frontend && pnpm test:running-kitten`
- `cd frontend && pnpm test:paper-shaders`
- `cd frontend && pnpm lint`
- `cd frontend && pnpm build`

Browser checks at 1440x900 and 1366x768:

- kitten stays outside the rotating record layer;
- kitten changes position over time while playing;
- kitten and record both freeze when paused;
- kitten remains upright and flips at a turn;
- seek and transport controls still work;
- reduced-motion renders a stable upright kitten;
- the ordinary home dashboard and mobile home remain unchanged.

This polish ships in the same `v0.9.38` release as the Mineradio fidelity rebuild.
