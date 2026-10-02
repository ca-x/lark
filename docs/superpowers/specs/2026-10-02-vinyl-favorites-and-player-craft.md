# Vinyl favorites and player craft

## Objective and acceptance

Make Vinyl room a personal record collection while retaining the physical turntable, artwork and theme palettes.

- Two accessible, labeled icon toggles select favorite albums and albums by favorite artists. Both toggles form a deduplicated union; neither means the complete library.
- Filter the entire catalog server-side with existing pagination, user-scoped favorites and accurate totals. Artist-specific library filters remain intersections with the selected collection.
- Reset pagination on filter changes, abort stale requests, and never show unfiltered cached albums under a selected filter. Retry failed pages without losing loaded records.
- Browsing and filtering never interrupt playback. The platter retains the actual playing record; a record outside the filtered collection does not enter the shelf or alter its count.
- Empty collections explain the state and offer one action to return to all records. The sleeve and play actions remain honest about loading or absent tracks.
- Previous/next record buttons and keyboard navigation preserve continuity as additional pages load. Show the selected record's position and retain access to its full title.
- Refine the visible focus and hit areas of custom seek rails across desktop themes. Preserve each theme's materials and give controls restrained pointer press feedback, with immediate keyboard responses and reduced-motion support. Album slide and iPod use one-second seek steps so arrow-key adjustments are useful.

## Implementation

React 19 / TypeScript and scoped CSS; Go library/API through existing Ent favorite relations. No schema change or new dependency. Retain existing public album-list methods for Subsonic and DLNA callers. Follow existing code style, explicit filter booleans and request cancellation.

Source: `frontend/src/components/player-themes/`, `frontend/src/services/api.ts`, `backend/internal/library/catalog.go`, `backend/internal/api/server.go`. Behavioral tests beside the player and library code. Version and bilingual release notes in frontend/package.json and CHANGELOG.md.

## Validation and release

- `pnpm --dir frontend build` and `pnpm --dir frontend lint`.
- `go test ./...`, `go vet ./...`, and focused favorite pagination tests with `-race` from backend.
- Browser checks through agent-browser: album/artist/both filters, empty/retry/rapid switching, playback outside filter, next page, keyboard and visible seek focus; light/dark and compact viewports.
- Update minor version after checks, commit scoped changes and push main plus annotated tag. Leave the pre-existing mise.toml modification untouched.
