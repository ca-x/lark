# Public sharing, library permissions and logo release

## Scope and acceptance

User-authorized delivery: implement issue #8, replace the logo with issue #9's exact artwork, retain the pending bilingual README theme credits, test, commit, push, release in 0.18.x, then reply to and close both issues only after publication.

- Reuse existing anonymous song/album/artist/playlist sharing. Add a selection of up to 500 songs, deduplicated in selection order; reject empty, invalid, missing or oversized selections before persisting a token. Existing share records and API callers remain compatible.
- Public links require no login, expose only their own songs and safe display metadata, and support audio range requests. Expiration, creator-only management, explicit revocation and the administrator's sharing switch apply to all target types. No server filesystem paths or provider credentials belong in public responses.
- Only administrators see media-library settings, directory management, scanning and uploads. Server routes enforce the same policy, including directory reads/checks/mutations; direct service mutations also reject non-administrators. Normal playback, folder browsing, personal network sources and browser-local offline controls remain available.
- Subsonic scan/status endpoints and the direct scan service require administrators too. Member settings expose an explicit playback/feature whitelist, and anonymous health checks omit the library path. Public share errors preserve HTTP status codes but never echo filesystem, transcoder or provider details to anonymous clients.
- Use the original PNG from issue #9 without redrawing it. Derive web/PWA/favicons and desktop/tray assets with transparency preserved. Bump only the service-worker shell cache, preserving downloaded offline audio.
- Publish server v0.18.3 without replacing older tags or publishing an unrelated desktop installer series. Include theme-source credits and logo provenance in documentation.

## Implementation order

1. Add focused API/service regression coverage for selections, anonymous album/playlist playback, token isolation, range reads, expiration/revocation/disabled sharing, privacy and library-role enforcement; establish failing cases first.
2. Extend the existing JSON share record with optional `song_ids`, not a new SQL schema; preserve legacy records. Add ordered selection resolution and public metadata projection. Route invalid share requests to HTTP 400.
3. Add a multi-selection sharing action to the library and reuse ShareDialog and duration controls. Hide privileged library entries/controls, fall back from stale privileged tabs and keep offline preferences in Playback. Verify role boundaries in both languages and desktop/mobile viewports.
4. Preserve the issue PNG and its checksum outside embedded public assets, generate consistent icon variants, and verify icon dimensions/transparency/provenance. Regenerate embedded frontend outputs after the final source changes.
5. Run focused tests, frontend lint/build, backend module verification/tests/vet/race and packaged-server/browser checks. Request an independent scoped review and fix Important/Critical findings before shipping.
6. Synchronize v0.18.3 metadata/changelog/notes, commit intended files, atomically push main and a new annotated tag after re-reading remote state. Verify all required CI and release archives, smoke the downloaded Linux binary, publish latest stable, then post/read back release-backed replies and close/read back #8 and #9.

## Validation commands

```bash
cd backend
go test ./internal/library ./internal/api
go test -race ./internal/library ./internal/api
go mod verify
go test ./...
go vet ./...
cd ../frontend
npm run lint
npm run build
npm run test:library-curation
cd ..
git diff --check -- . ':!backend/web/dist'
```

## Review focus

- Anonymous access must not fall through to the full library, unscoped stream/cover endpoints or private song/provider fields.
- Empty or invalid selections cannot create a valid partial share; selection order survives persistence and cache reload.
- Hidden settings are not a substitute for API/service authorization; non-admin callers must receive 403 before filesystem inspection or mutation.
- Role changes/stale settings or mobile library tabs cannot re-open administrative controls. Browser-local offline controls and personal network sources must not be accidentally removed.
- New shell caching must invalidate old logo assets without deleting the offline-audio cache. Preserve the source logo's actual alpha channel.

## Rollback

Revert the release change and ship another 0.18.x patch; do not rewrite tags or delete existing share records, user directories or offline downloads. Legacy shares do not depend on the optional selection field.

## Local verification (2026-10-29)

- Frontend lint and production build pass, including 114 build tests, 14 sharing tests and the library-curation tests/contracts. Embedded assets are regenerated from the final source.
- Backend module verification, full tests, vet and library/API race tests pass. Regression coverage includes the Subsonic permission bypass, member/health configuration disclosure and public media-error path disclosure.
- Browser checks use isolated administrator, member and anonymous sessions with generated audio fixtures. Anonymous selected-song, album and playlist playback, seeking and HTTP range requests work; unrelated tracks remain inaccessible.
- Administrator library controls remain available. Members make no initial directory requests, see no library-owned settings controls and retain personal offline preferences. Stale mobile management tabs resolve to the song list.
- Light/dark logo rendering and the final mobile selection toolbar are checked at 320px and 390px without horizontal overflow. The original logo checksum and generated asset consistency are covered by tests.
- Independent review findings are resolved and rechecked, with no remaining Critical or Important findings. Remote CI, downloadable release archives and issue follow-through remain publication gates, not claims established by these local checks.
