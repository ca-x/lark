# Toaster Studio in Lark

## Objective and authorization

Integrate an optional music-code workspace into Lark. The user explicitly requested direct integration and publication of a new release after tests pass on 2026-10-27. Include the mobile Cover Flow compositor fix in the same release. Target server/web version 0.18.0; desktop packaging version is independent.

## User experience

- A personal `toaster_studio_enabled` preference defaults to false, persists per authenticated user, and synchronizes through the existing preferences API.
- Enabling it exposes a desktop navigation entry and a mobile entry in My, plus an Open button alongside the preference. Turning it off closes the workspace and removes its entry.
- Opening Toaster Studio shows the current song, beat/key/bar information, real generated Strudel code, and music-reactive visuals. Provide spectrum, orb, and domino modes, a code visibility toggle, playback pause/resume, and back navigation.
- Offer Copy Strudel, Download Strudel, Download MIDI, and Open in Strudel. Current code can be exported without a full recorded song. MIDI/full-song export remains unavailable until enough analysed bars exist, with an explanation.
- Clearly call the output an approximate reconstruction, not an exact transcription. Only analyse audio actually played locally by Lark. Paused, unavailable, silent and remote-output states must not invent analysis or show fake audio activity.
- Keep the existing player and queue authoritative. The workspace neither plays a second synthesizer nor changes song, progress, volume, output device or EQ.
- Support Chinese and English, desktop and mobile, keyboard access and reduced motion. Exiting or disabling the feature stops animation, disconnects only analysis taps, and terminates export work.

## Architecture

Reuse Toaster's browser-only analysis, code-generation and song-export modules, pinned to `StopBanning/toaster` commit `cc8177d427f88ef780ac9cf596d1c2b6533b7816` (version 0.4.20). Do not embed the remote website or Electron runtime. Do not add an AI service, runtime dependency, account, camera, microphone, system capture or external upload.

The audio session obtains three independent analyser taps from Lark's existing registered audio graph through `makeAudioAnalyser`. It never creates another `MediaElementAudioSourceNode`, changes speaker routing, disconnects the parent graph, or closes its AudioContext. Fast/mid/slow FFT sizes match upstream analysis. Sampling and recording freeze on pause; seeking and track changes reset the analysed sequence so unrelated audio is not stitched into an export.

The optional workspace loads through React lazy/Suspense only after entry. A typed session facade isolates vendored JavaScript from React. Canvas visuals consume measured signals from that facade and reduce work when hidden or reduced motion is requested. Export work is bounded and released on completion or disposal. Browser downloads use Blob/object URLs and release them. The Strudel link is the upstream UTF-8 source fragment at `https://strudel.cc/#...`; generated code is displayed as text, never evaluated in Lark.

Flow: existing audio graph -> session analyzers -> Toaster engine -> code and song tape -> workspace visuals / browser downloads. Session disposal affects only the new branch of that graph.

## Files and conventions

- `frontend/src/features/toaster/`: immutable upstream JavaScript and license, typed contracts, session/exports and focused Node tests.
- `frontend/src/components/toaster/`: React workspace and scoped CSS; localized copy through existing `i18n.ts`.
- `frontend/src/App.tsx`, `frontend/src/types/app.ts`, existing mobile My/settings: optional navigation and lifecycle integration.
- `frontend/src/types.ts`, backend preference model/request/service and tests: the new optional boolean, without database schema changes.
- `NOTICE.md`, READMEs and CHANGELOG: attribution, usage and release notes.
- Follow existing TypeScript strict mode, React hooks and scoped CSS. Preserve upstream attribution and clearly mark adaptations. Use existing icons and fonts.

## Acceptance and validation

1. Existing/legacy users default to disabled. Users cannot overwrite another user's preference; omitted fields preserve the stored flag on partial preference updates.
2. No studio or analyser is instantiated while disabled or not open. Opening does not reload, restart, duplicate or silence playback.
3. Synthetic steady beats produce measured tempo, changing code and nonempty MIDI with a valid header; Unicode titles survive code/link/download generation. Silence and pause produce no fictitious hits or bars.
4. Track replacement, seek, unmount, hidden page, graph-not-ready and export failure have explicit, tested behavior. Disposing the session leaves existing playback/EQ connections intact.
5. Mobile controls and export actions fit at 375px; playback controls remain accessible during Cover Flow navigation. Review a desktop viewport and a mobile viewport in a browser.
6. Run `npm run lint`, `npm run build`, dedicated feature/Cover Flow checks, `go test ./...`, `go vet ./...`, `go mod verify` and a backend build before publication.
7. Update web version and bilingual release notes, rebuild embedded assets, commit, push main and an annotated `v0.18.0`, monitor applicable CI/binary/Docker workflows, and publish the completed GitHub release after its artifacts exist. Do not overwrite a remote tag.

## Sources

- https://github.com/StopBanning/toaster/tree/cc8177d427f88ef780ac9cf596d1c2b6533b7816
- https://github.com/StopBanning/toaster/blob/cc8177d427f88ef780ac9cf596d1c2b6533b7816/docs/how-it-works.md
- https://github.com/StopBanning/toaster/blob/cc8177d427f88ef780ac9cf596d1c2b6533b7816/LICENSE

MIT analysis/code/export code is compatible with Lark's AGPL distribution when its original notice is retained. Strudel itself is not bundled. Camera models, video and artwork assets are not copied.
