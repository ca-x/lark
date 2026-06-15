# Running Kitten Desktop Player Theme Design

## Thesis

The "奔跑的小猫" theme should be a new desktop player theme, not a variant bolted onto the existing vinyl deck. Its job is to create a small illustrated scene: a watercolor sunrise, a black vinyl record, and a kitten silhouette running on the groove while playback is active.

## Confidence

- Confidence level: medium-high
- Why not certain: the final visual quality depends on the generated watercolor background asset and browser rendering at the app's common desktop breakpoints.

## Scope

- PC desktop home player only.
- Do not add a mobile theme in this pass.
- Do not change bottom player behavior, queue behavior, lyrics behavior, EQ behavior, or persisted mobile player settings.
- Add one desktop home player style option named "奔跑的小猫" in Chinese and "Running kitten" in English.

## The Trap

- Inherited constraint: the project already has a PC vinyl player component.
- Is it real? partially.
- Why: existing playback props, controls, progress, and tonearm logic are reusable reference patterns, but the visual model is different enough that a `variant` prop would make the vinyl component carry unrelated scene-specific behavior.

## High-Level Direction

Create a dedicated `RunningKittenTurntable` desktop component that follows the same prop contract as the other PC player themes. The component owns its illustrated scene, CSS animation, and background asset while reusing the existing app-level playback data flow from `HomeView`.

## Interaction Model

- Playback active:
  - Vinyl record rotates continuously.
  - Kitten silhouette runs along the outer groove as a separate orbit layer.
  - Kitten legs/tail animate with a short step cycle so it reads as running, not just rotating.
  - Sunrise glow and watercolor trail pulse subtly.
  - Tonearm settles onto the record and tracks progress.
- Playback paused:
  - Record rotation, kitten orbit, leg motion, glow pulse, and trail motion pause.
  - Scene remains composed: kitten rests on the groove, tonearm stays in its progress position.
- Track progress:
  - Tonearm angle follows current progress.
  - A fine groove highlight or track arc can reflect progress, but it must not replace the existing clickable progress control.
- Seeking:
  - The visible progress slider remains the real seek target.
  - The kitten position can snap softly to the new groove position after seek.
- End of track:
  - Match existing vinyl behavior by easing spin down near the end when duration is known.
- Reduced motion:
  - Respect `prefers-reduced-motion`.
  - Keep a static watercolor scene with no orbit, no spin, no leg cycle, and no pulsing glow.

## Visual Design

- Use a generated watercolor background asset for paper texture, warm sunrise, horizon haze, and soft wash.
- Keep the vinyl record mostly black and glossy so the object remains recognizable.
- Use CSS/SVG for the kitten silhouette so it stays crisp and can animate.
- Keep controls crisp, not watercolor-blurred.
- Palette:
  - Paper cream and warm gold for the scene.
  - Black vinyl and black kitten silhouette for contrast.
  - Brass/copper accents for tonearm and controls.
  - Existing theme text colors for hero copy readability.
- The theme should feel illustrative, warm, and musical, not like a generic dark-mode skin.

## Component And Data Flow

- Extend `HomePlayerStyle` with a new value: `running-kitten`.
- Add a new `RunningKittenTurntable` export under `frontend/src/components/player-themes`.
- Render it from the desktop `HomeView` branch when the new style is selected.
- Add the new style to the desktop settings segmented control.
- Add i18n labels:
  - Chinese: `奔跑的小猫`
  - English: `Running kitten`
- Use the same playback props as the vinyl theme:
  - `cover`, `playing`, `progress`, `duration`, `title`, `artist`
  - transport callbacks
  - play mode callback
  - seek callback
- Do not include volume, bass, or treble controls inside this theme. Those controls remain available in the shared player surfaces; the theme stays focused on scene, transport, play mode, and seek.

## Asset Plan

- Generate one static raster background asset for the watercolor scene.
- Store it under frontend public assets, using a stable path such as `frontend/public/player-themes/running-kitten-watercolor.webp`.
- Do not use the generated asset for controls, text, or the kitten silhouette.
- If asset generation is unsatisfactory, fall back to CSS watercolor simulation using layered gradients and noise.

## Bold Takes

- Do not make the existing `VinylTurntable` accept a `kitten` or `watercolor` variant. That would preserve a local implementation convenience at the cost of a muddy component boundary.
- Do not use a detailed kitten image for the first version. A black silhouette is stronger, clearer, and closer to the reference's emotional read.
- Do not watercolor the controls. The theme can be painterly while the interface stays usable.
- Do not ship the mobile version until the desktop version proves the visual language works.

## Options

| Option | What it optimizes | Cost | Verdict |
| --- | --- | --- | --- |
| Conservative path | Small diff by extending existing vinyl | Coupled component, weaker theme identity | Reject |
| Clean target | Dedicated desktop theme component and generated background asset | More CSS and one asset | Recommended |
| Staged clean path | First CSS-only prototype, then generated asset | Extra iteration and lower first impression | Fallback if asset generation fails |

## What Not To Do

- Do not make the cat a decorative overlay that ignores playback state.
- Do not animate layout properties; use transforms and opacity.
- Do not add hover-only interactions.
- Do not introduce mobile settings or mobile theme ids in this pass.
- Do not add a public compatibility alias unless there is evidence users already persist this theme id.

## First Proof Point

The first proof point is a desktop screenshot of the new theme at a normal desktop viewport showing: watercolor scene, recognizable vinyl record, visible kitten silhouette, readable hero text, and unchanged playback controls.

## Falsifier

This direction is wrong if the generated background makes text or controls unreadable, if the kitten cannot be understood at the rendered size, or if animation distracts from normal playback interactions. In that case, reduce the background detail and simplify motion before adding any new interaction.
