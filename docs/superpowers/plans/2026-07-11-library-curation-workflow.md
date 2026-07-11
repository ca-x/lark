# Library Curation Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic library sorting, an automatic incomplete-metadata review workflow, persistent online candidate caching, and permission-safe settings search with polished desktop and mobile behavior.

**Architecture:** Preserve existing public defaults and UI ownership. Add typed browse options around the current `SongsPage` path, isolate candidate persistence in a dedicated Ent entity and library service file, and add focused React components for sorting and settings search while keeping `App.tsx` responsible for page-level state.

**Tech Stack:** Go 1.24, Echo, Ent, SQLite/MySQL-compatible Ent queries, singleflight, React 19, TypeScript 6, CSS, Node test runner, Vite.

## Global Constraints

- The default song ordering remains added-time descending.
- Added time means `song.created_at`, not file modification time.
- Filename sorting is case-insensitive and uses `song.file_name` with song ID as the deterministic tiebreaker.
- Incomplete review is derived from live metadata and is not persisted as a second status.
- Metadata candidate TTL is exactly seven days; lyric candidate TTL is exactly 24 hours.
- Successful empty candidate arrays are cached; provider failures are not cached.
- Explicit refresh preserves the previous cached result when refresh fails.
- Regular users must never discover administrator-only settings through search.
- Mobile touch targets are at least 44 CSS pixels and layouts must work at 360 CSS pixels without horizontal scrolling.
- High-frequency sorting and filtering do not animate list reordering.
- Reduced-motion mode removes transform-based interaction motion.
- No unified multi-source track work, recommendation work, multi-app-password work, audio fingerprinting, playlist import, or general SSE framework is included.
- After full verification, bump the frontend version from `0.9.35` to `0.9.36`, update the bilingual changelog, rebuild embedded frontend assets, commit, and push `main`.

---

## File Structure

- Create `backend/internal/library/song_browse.go`: typed sort/review options, incomplete predicates, issue detection, stable order functions, and review summary.
- Create `backend/internal/library/song_browse_test.go`: ordering, filtering, compatibility, pagination, and review-summary tests.
- Modify `backend/internal/library/service.go`: delegate existing `SongsPage` to an option-aware implementation and include options in cache keys.
- Modify `backend/internal/models/models.go`: expose `metadata_issues` and the review-summary model.
- Modify `backend/internal/api/server.go`: parse browse parameters, register review summary, pass user IDs and refresh flags to candidate calls.
- Create `backend/ent/schema/candidate_cache.go`: persistent user-scoped candidate-cache schema.
- Regenerate `backend/ent`: generated entity, mutation, query, predicate, migration, and runtime files.
- Create `backend/internal/library/candidate_cache.go`: snapshots, hashing, TTL lookup, singleflight loading, refresh replacement, cleanup, and invalidation.
- Create `backend/internal/library/candidate_cache_test.go`: cache lifecycle, isolation, expiration, empty results, failure, refresh, and concurrency tests.
- Modify `backend/internal/library/metadata_writeback.go`: route online metadata searches through persistent cache and invalidate after writeback.
- Modify `backend/internal/library/metadata_writeback_test.go`: cache-aware metadata and invalidation tests.
- Modify `backend/internal/library/lyrics.go`: route lyric candidates through persistent cache and invalidate after metadata/lyric updates.
- Modify `backend/internal/library/lyrics_test.go`: lyric cache and refresh tests.
- Modify `frontend/src/types.ts`: sort, review summary, and metadata issue types.
- Modify `frontend/src/services/api.ts`: browse options, review-summary call, and candidate refresh parameters.
- Create `frontend/src/components/LibrarySortControl.tsx`: accessible desktop menu and mobile bottom sheet.
- Create `frontend/src/components/LibrarySortControl.test.mjs`: source contract for labels, selection semantics, and mobile structure.
- Modify `frontend/src/App.tsx`: sort/review state, page loading, review count, editor refresh wiring, and post-writeback reconciliation.
- Modify `frontend/src/components/MetadataEditorDialog.tsx`: explicit refresh that preserves old candidates on failure.
- Modify `frontend/src/services/candidateCache.ts`: force-reload support without clearing a valid session value first.
- Modify `frontend/src/services/candidateCache.test.mjs`: refresh success/failure behavior.
- Create `frontend/src/components/settings/settingsSearchRegistry.ts`: permission-aware searchable setting descriptors.
- Create `frontend/src/components/settings/SettingsSearch.tsx`: result list, category navigation, section expansion, scrolling, and focus.
- Create `frontend/src/components/settings/SettingsSearch.test.mjs`: role filtering and registry contract checks.
- Modify `frontend/src/components/settings/SettingsNavigation.tsx`: expose category focus targets without changing current tab behavior.
- Modify `frontend/src/i18n.ts`: complete Chinese and English copy.
- Modify `frontend/src/styles.css` and `frontend/src/mobile.css`: sorting, review badges, settings search, touch targets, exact transitions, hover gating, and reduced motion.
- Create `frontend/scripts/check-library-curation.mjs`: cross-file API, accessibility, localization, and responsive-source assertions.
- Modify `frontend/package.json`: register focused checks and release version.
- Modify `CHANGELOG.md`: add the bilingual `0.9.36` release entry.
- Rebuild `backend/web/dist`: embed the verified frontend production output.

---

### Task 1: Add typed library sorting and incomplete review

**Files:**
- Create: `backend/internal/library/song_browse.go`
- Create: `backend/internal/library/song_browse_test.go`
- Modify: `backend/internal/library/service.go`
- Modify: `backend/internal/models/models.go`
- Modify: `backend/internal/api/server.go`

**Interfaces:**
- Produces: `type SongSort string`
- Produces: `ParseSongSort(string) SongSort`
- Produces: `type SongReview string`
- Produces: `ParseSongReview(string) SongReview`
- Produces: `type SongBrowseOptions struct { Sort SongSort; Review SongReview }`
- Produces: `SongsPageWithOptions(context.Context, int, string, bool, int, int, SongBrowseOptions) (models.SongPage, error)`
- Produces: `ReviewSummary(context.Context, int) (models.LibraryReviewSummary, error)`
- Preserves: existing `SongsPage(...)` signature and default behavior.

- [ ] **Step 1: Write failing sort and review tests**

Create table-driven tests with songs whose filenames differ in case and whose `created_at` values include ties:

```go
func TestSongsPageWithOptionsSortsDeterministically(t *testing.T) {
    service, ctx := newBrowseTestService(t)
    first := createBrowseSong(t, service, "zeta.FLAC", time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC), "Artist", "Album")
    second := createBrowseSong(t, service, "Alpha.flac", time.Date(2026, 7, 2, 12, 0, 0, 0, time.UTC), "Artist", "Album")
    third := createBrowseSong(t, service, "beta.flac", time.Date(2026, 7, 2, 12, 0, 0, 0, time.UTC), "Artist", "Album")

    cases := []struct {
        name string
        sort SongSort
        want []int
    }{
        {"added descending", SongSortAddedDesc, []int{third.ID, second.ID, first.ID}},
        {"added ascending", SongSortAddedAsc, []int{first.ID, second.ID, third.ID}},
        {"filename ascending", SongSortFilenameAsc, []int{second.ID, third.ID, first.ID}},
        {"filename descending", SongSortFilenameDesc, []int{first.ID, third.ID, second.ID}},
    }
    for _, tc := range cases {
        t.Run(tc.name, func(t *testing.T) {
            page, err := service.SongsPageWithOptions(ctx, 1, "", false, 20, 0, SongBrowseOptions{Sort: tc.sort})
            if err != nil { t.Fatal(err) }
            if got := songIDs(page.Items); !slices.Equal(got, tc.want) { t.Fatalf("ids = %v, want %v", got, tc.want) }
        })
    }
}
```

Add tests that create songs with missing edges and `Unknown Artist`/`Unknown Album`, assert `review=incomplete` returns only those songs with stable issue keys, then write complete metadata and assert the song leaves the result. Add a two-page filename-order test to prove no duplicate or skipped IDs. Add a compatibility test comparing `SongsPage` with `SongsPageWithOptions(..., SongBrowseOptions{})`.

- [ ] **Step 2: Run the focused tests and confirm failure**

Run: `cd backend && go test ./internal/library -run 'TestSongsPageWithOptions|TestReviewSummary' -count=1`

Expected: compile failure because browse types and methods do not exist.

- [ ] **Step 3: Add models and typed parsing**

Add to `models.Song` and `models.go`:

```go
MetadataIssues []string `json:"metadata_issues,omitempty"`

type LibraryReviewSummary struct {
    IncompleteSongs int `json:"incomplete_songs"`
}
```

Define exact parser defaults:

```go
const (
    SongSortAddedDesc    SongSort = "added_desc"
    SongSortAddedAsc     SongSort = "added_asc"
    SongSortFilenameAsc  SongSort = "filename_asc"
    SongSortFilenameDesc SongSort = "filename_desc"
    SongReviewIncomplete SongReview = "incomplete"
)

func ParseSongSort(value string) SongSort {
    switch SongSort(strings.ToLower(strings.TrimSpace(value))) {
    case SongSortAddedAsc, SongSortFilenameAsc, SongSortFilenameDesc:
        return SongSort(strings.ToLower(strings.TrimSpace(value)))
    default:
        return SongSortAddedDesc
    }
}

func ParseSongReview(value string) SongReview {
    if strings.EqualFold(strings.TrimSpace(value), string(SongReviewIncomplete)) {
        return SongReviewIncomplete
    }
    return ""
}
```

- [ ] **Step 4: Implement option-aware queries**

Keep `SongsPage` as a default wrapper. Add sort and review values to the cache key. Build filename ordering in SQL using `LOWER(file_name)` plus ID rather than browser sorting:

```go
func filenameOrder(desc bool) song.OrderOption {
    return func(selector *sql.Selector) {
        selector.OrderExprFunc(func(builder *sql.Builder) {
            builder.WriteString("LOWER(").Ident(selector.C(song.FieldFileName)).WriteByte(')')
            if desc { builder.WriteString(" DESC") } else { builder.WriteString(" ASC") }
        })
    }
}

func songOrder(sortValue SongSort) []song.OrderOption {
    switch sortValue {
    case SongSortAddedAsc:
        return []song.OrderOption{ent.Asc(song.FieldCreatedAt), ent.Asc(song.FieldID)}
    case SongSortFilenameAsc:
        return []song.OrderOption{filenameOrder(false), ent.Asc(song.FieldID)}
    case SongSortFilenameDesc:
        return []song.OrderOption{filenameOrder(true), ent.Desc(song.FieldID)}
    default:
        return []song.OrderOption{ent.Desc(song.FieldCreatedAt), ent.Desc(song.FieldID)}
    }
}
```

Centralize placeholder checks in `metadataIssuesForSong`; use the exact recognized values `Unknown Artist`, `未知艺术家`, `Unknown Album`, `未知专辑`, `Unknown Title`, and `未知标题`.

- [ ] **Step 5: Add API parsing and review-summary route**

Register `GET /api/library/review-summary` behind `auth`. In `handleSongsPage`, parse `sort` and `review`, call `SongsPageWithOptions`, and preserve old defaults. Return `LibraryReviewSummary` from the new handler.

- [ ] **Step 6: Run backend browse tests**

Run: `cd backend && go test ./internal/library ./internal/api -run 'TestSongsPage|TestReviewSummary|TestHandleSongsPage' -count=1`

Expected: PASS.

- [ ] **Step 7: Commit the browse foundation**

```bash
git add backend/internal/library/song_browse.go backend/internal/library/song_browse_test.go backend/internal/library/service.go backend/internal/models/models.go backend/internal/api/server.go
git commit -m "feat: add library sorting and metadata review"
```

---

### Task 2: Build the library sort and review interface

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/services/api.ts`
- Create: `frontend/src/components/LibrarySortControl.tsx`
- Create: `frontend/src/components/LibrarySortControl.test.mjs`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/i18n.ts`
- Modify: `frontend/src/styles.css`
- Modify: `frontend/src/mobile.css`

**Interfaces:**
- Produces: `type SongSort = "added_desc" | "added_asc" | "filename_asc" | "filename_desc"`
- Produces: `type SongReview = "" | "incomplete"`
- Produces: `api.songsPage(q, page, limit, favorites, { sort, review })`
- Produces: `api.libraryReviewSummary()`
- Produces: `<LibrarySortControl value mobile labels onChange />`.

- [ ] **Step 1: Write a failing source-contract test**

Create a Node test that asserts the component exposes a labeled single-selection menu, four stable values, a mobile sheet class, Escape handling, trigger focus restoration, and no row-animation class. Assert `api.ts` sends `sort` and `review` only when non-default.

```js
test("library sort control exposes all stable choices", () => {
  const source = readFileSync(new URL("./LibrarySortControl.tsx", import.meta.url), "utf8");
  for (const value of ["added_desc", "added_asc", "filename_asc", "filename_desc"]) {
    assert.match(source, new RegExp(value));
  }
  assert.match(source, /role="menu"/);
  assert.match(source, /aria-checked/);
  assert.match(source, /library-sort-sheet/);
});
```

- [ ] **Step 2: Run the test and confirm failure**

Run: `cd frontend && node --test src/components/LibrarySortControl.test.mjs`

Expected: module-not-found failure.

- [ ] **Step 3: Add frontend models and API options**

Add `metadata_issues?: MetadataIssue[]` to `Song`, define the sort/review types, and update `songsPage` to append parameters with `URLSearchParams`. Add `LibraryReviewSummary` and `libraryReviewSummary()`.

- [ ] **Step 4: Implement the accessible sort control**

Use one trigger and one option list for both layouts. Desktop renders an anchored popover; mobile adds the sheet backdrop and sheet class. The option array is exact and localized by passed labels:

```ts
const options: Array<{ value: SongSort; label: string }> = [
  { value: "added_desc", label: labels.addedDesc },
  { value: "added_asc", label: labels.addedAsc },
  { value: "filename_asc", label: labels.filenameAsc },
  { value: "filename_desc", label: labels.filenameDesc },
];
```

On selection call `onChange`, close, and restore trigger focus. On Escape close without changing. Do not animate keyboard-opened content; mark pointer opening with a data attribute for CSS.

- [ ] **Step 5: Wire sort and review state into `App.tsx`**

Add `librarySort`, `libraryReview`, and `reviewSummary` state. Pass both values through initial refresh and `loadLibrarySongsPage`. When either changes, set page one and load using the current search term. Preserve the previous values until the request succeeds; on failure restore the last successfully loaded selection and retain existing songs.

Pass the values and handlers to `LibraryView`. Add a stable review filter button with count. In review mode, render localized `metadata_issues` under the song row through a new optional `SongTable` prop rather than forking the table.

- [ ] **Step 6: Add desktop/mobile styling and copy**

Desktop menu transition targets only `opacity` and `transform`, lasts at most 180ms, starts at `scale(.97)`, and uses `cubic-bezier(.23,1,.32,1)`. Mobile uses a fixed backdrop and bottom sheet with 44px options. Add `@media (hover:hover) and (pointer:fine)` around hover-only styling. Under reduced motion remove transforms and movement.

- [ ] **Step 7: Run focused frontend verification**

Run: `cd frontend && node --test src/components/LibrarySortControl.test.mjs && pnpm build`

Expected: PASS.

- [ ] **Step 8: Commit the library interface**

```bash
git add frontend/src/types.ts frontend/src/services/api.ts frontend/src/components/LibrarySortControl.tsx frontend/src/components/LibrarySortControl.test.mjs frontend/src/App.tsx frontend/src/i18n.ts frontend/src/styles.css frontend/src/mobile.css
git commit -m "feat: add library sort and review controls"
```

---

### Task 3: Add the persistent candidate-cache entity and storage service

**Files:**
- Create: `backend/ent/schema/candidate_cache.go`
- Regenerate: `backend/ent`
- Create: `backend/internal/library/candidate_cache.go`
- Create: `backend/internal/library/candidate_cache_test.go`
- Modify: `backend/internal/library/service.go`

**Interfaces:**
- Produces: `candidateQueryKindMetadataOnline` and `candidateQueryKindLyrics`.
- Produces: `loadCandidateJSON(ctx, CandidateCacheRequest, loader) ([]byte, error)`.
- Produces: `invalidateCandidateCache(ctx, userID, targetType, targetID, kinds...) error`.

- [ ] **Step 1: Write failing cache lifecycle tests**

Test user isolation, cache hits, empty arrays, error retry, expiration, refresh success, refresh failure preserving the old row, and concurrent request collapse. Inject `now` through a service field or helper so TTL tests do not sleep.

```go
func TestCandidateCacheReusesSuccessfulEmptyResult(t *testing.T) {
    service, ctx := newCandidateCacheTestService(t)
    calls := 0
    request := CandidateCacheRequest{UserID: 1, TargetType: "song", TargetID: 7, Kind: candidateQueryKindLyrics, Snapshot: "snapshot", TTL: 24 * time.Hour}
    loader := func(context.Context) ([]byte, error) { calls++; return []byte("[]"), nil }
    first, err := service.loadCandidateJSON(ctx, request, loader)
    if err != nil { t.Fatal(err) }
    second, err := service.loadCandidateJSON(ctx, request, loader)
    if err != nil { t.Fatal(err) }
    if string(first) != "[]" || string(second) != "[]" || calls != 1 { t.Fatalf("first=%s second=%s calls=%d", first, second, calls) }
}
```

- [ ] **Step 2: Run the tests and confirm failure**

Run: `cd backend && go test ./internal/library -run TestCandidateCache -count=1`

Expected: compile failure because the schema and service do not exist.

- [ ] **Step 3: Define and generate the Ent entity**

Use fields `user_id`, `target_type`, `target_id`, `query_kind`, `snapshot_hash`, `payload`, `expires_at`, `created_at`, and `updated_at`. Add a unique composite index across the first five identity fields and a non-unique expiration index.

Run: `cd backend && go generate ./ent`

Expected: generated candidate-cache query/mutation/runtime files and schema migration metadata.

- [ ] **Step 4: Implement snapshots, hashing, TTL lookup, and refresh**

Hash canonical JSON or a NUL-delimited normalized string with SHA-256. Use one `singleflight.Group` owned by `Service`. On refresh, skip the returned value but do not delete it before loading. Upsert only after loader success. If the upsert fails, log and return the provider payload. Opportunistic cleanup deletes at most 100 expired rows after successful lookups.

`CandidateCacheRequest` is exact:

```go
type CandidateCacheRequest struct {
    UserID int
    TargetType string
    TargetID int
    Kind string
    Snapshot string
    TTL time.Duration
    Refresh bool
}
```

- [ ] **Step 5: Run schema and cache tests**

Run: `cd backend && go test ./ent/... ./internal/library -run 'TestCandidateCache|TestSchema' -count=1`

Expected: PASS.

- [ ] **Step 6: Commit persistent cache storage**

```bash
git add backend/ent backend/internal/library/candidate_cache.go backend/internal/library/candidate_cache_test.go backend/internal/library/service.go
git commit -m "feat: persist online candidate searches"
```

---

### Task 4: Integrate persistent metadata candidates and invalidation

**Files:**
- Modify: `backend/internal/library/metadata_writeback.go`
- Modify: `backend/internal/library/metadata_writeback_test.go`
- Modify: `backend/internal/api/server.go`

**Interfaces:**
- Changes: `SongMetadataCandidates(context.Context, int, int, MetadataCandidateScope, bool)` where arguments are user ID, song ID, scope, refresh.
- Changes: `AlbumMetadataCandidates(context.Context, int, int, MetadataCandidateScope, bool)` with the same user/target convention.

- [ ] **Step 1: Add failing metadata cache tests**

Extend provider fakes with call counters. Assert two online calls by the same user produce one provider search, another user has a separate cache, `refresh=true` performs a second search, and successful song writeback causes the next online call to search again. Assert path scope never touches persistent cache or providers.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `cd backend && go test ./internal/library -run 'Test(Song|Album)MetadataCandidate(Cache|Refresh|Invalidation)' -count=1`

Expected: compile/signature failures.

- [ ] **Step 3: Wrap only online provider work**

Build song snapshots from normalized title, artist, album, duration rounded consistently, and path. Build album snapshots from title, album artist, and year. Marshal `[]models.MetadataCandidate` into cache payloads and unmarshal on hits. Keep path candidate generation outside the cache wrapper and preserve path-first ordering for `scope=all`.

- [ ] **Step 4: Parse `refresh` and pass the current user**

Handlers use:

```go
refresh := strings.EqualFold(strings.TrimSpace(c.QueryParam("refresh")), "true")
items, err := s.lib.SongMetadataCandidates(c.Request().Context(), currentUserID(c), id, library.ParseMetadataCandidateScope(c.QueryParam("scope")), refresh)
```

Use the equivalent album call.

- [ ] **Step 5: Invalidate after successful writeback**

After database/file writeback succeeds, invalidate the target's metadata and lyric kinds and affected album metadata. Cache invalidation failure is logged and must not convert a successful metadata writeback into an API error.

- [ ] **Step 6: Run metadata tests**

Run: `cd backend && go test ./internal/library ./internal/api -run 'Test(Song|Album)Metadata|TestHandle.*Metadata' -count=1`

Expected: PASS.

- [ ] **Step 7: Commit metadata cache integration**

```bash
git add backend/internal/library/metadata_writeback.go backend/internal/library/metadata_writeback_test.go backend/internal/api/server.go
git commit -m "feat: reuse persistent metadata candidates"
```

---

### Task 5: Integrate persistent lyric candidates

**Files:**
- Modify: `backend/internal/library/lyrics.go`
- Create or modify: `backend/internal/library/lyrics_test.go`
- Modify: `backend/internal/api/server.go`

**Interfaces:**
- Changes: `LyricCandidates(context.Context, int, int, bool) ([]models.LyricCandidate, error)` where arguments are user ID, song ID, refresh.

- [ ] **Step 1: Write failing lyric cache tests**

Use a fake online provider and assert a 24-hour hit, successful empty caching, user isolation, refresh, error retry, and cache invalidation following lyric selection or metadata mutation.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `cd backend && go test ./internal/library -run 'TestLyricCandidate(Cache|Refresh|Invalidation)' -count=1`

Expected: signature or missing-behavior failure.

- [ ] **Step 3: Add lyric snapshots and cache wrapper**

Snapshot normalized title, artist, album, and duration. Cache only `[]models.LyricCandidate`, never lyric bodies. Use exactly `24*time.Hour`. Pass `refresh` through the API handler.

- [ ] **Step 4: Preserve selection behavior and invalidate safely**

Selecting a candidate continues to fetch the full lyrics using source and ID. On successful selection invalidate the lyric-candidate cache for that song without failing the selection if cleanup fails.

- [ ] **Step 5: Run lyric tests**

Run: `cd backend && go test ./internal/library ./internal/api -run 'TestLyric|TestHandleLyric' -count=1`

Expected: PASS.

- [ ] **Step 6: Commit lyric cache integration**

```bash
git add backend/internal/library/lyrics.go backend/internal/library/lyrics_test.go backend/internal/api/server.go
git commit -m "feat: reuse persistent lyric candidates"
```

---

### Task 6: Add explicit candidate refresh without clearing good results

**Files:**
- Modify: `frontend/src/services/api.ts`
- Modify: `frontend/src/services/candidateCache.ts`
- Modify: `frontend/src/services/candidateCache.test.mjs`
- Modify: `frontend/src/components/MetadataEditorDialog.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/i18n.ts`
- Modify: `frontend/src/styles.css`
- Modify: `frontend/src/mobile.css`

**Interfaces:**
- Produces: `reloadCandidateCache<T>(key, loader): Promise<T[]>`.
- Changes candidate APIs to accept `refresh = false` and send `refresh=true` explicitly.

- [ ] **Step 1: Write failing session refresh tests**

Assert successful reload replaces the session value, failed reload leaves the old value, and two concurrent reload calls share one promise:

```js
await loadCandidateCache(key, async () => [{ id: "old" }]);
await assert.rejects(reloadCandidateCache(key, async () => { throw new Error("offline"); }));
assert.deepEqual(getCandidateCache(key), [{ id: "old" }]);
assert.deepEqual(await reloadCandidateCache(key, async () => [{ id: "new" }]), [{ id: "new" }]);
assert.deepEqual(getCandidateCache(key), [{ id: "new" }]);
```

- [ ] **Step 2: Run the test and confirm failure**

Run: `cd frontend && pnpm test:candidate-cache`

Expected: failure because `reloadCandidateCache` does not exist.

- [ ] **Step 3: Implement safe reload and API flags**

Do not delete `values` before invoking the loader. Replace it only in `.then`; clear only the reload request in `.finally`. Add `refresh=true` through `URLSearchParams` to song metadata, album metadata, and lyric candidate calls.

- [ ] **Step 4: Add metadata-editor refresh UI**

Keep path candidates stable. Add a refresh button in the online region, disable it while refreshing, use `reloadCandidateCache`, and preserve existing candidates on error. Guard responses with target ID and request generation. Use opacity-only replacement no longer than 180ms.

- [ ] **Step 5: Add lyric refresh UI**

Pass `onRefreshCandidates` through the existing lyric candidate panel. Reuse the same safe reload semantics and keep the panel open with old candidates on failure.

- [ ] **Step 6: Reconcile review after writeback**

After a successful metadata save while `libraryReview === "incomplete"`, reload the current review page and review summary. If removing the last row makes the current page empty and page > 1, load the previous page. Focus the next row or the completed-state action.

- [ ] **Step 7: Run frontend cache/build checks**

Run: `cd frontend && pnpm test:candidate-cache && pnpm build`

Expected: PASS.

- [ ] **Step 8: Commit refresh UX**

```bash
git add frontend/src/services/api.ts frontend/src/services/candidateCache.ts frontend/src/services/candidateCache.test.mjs frontend/src/components/MetadataEditorDialog.tsx frontend/src/App.tsx frontend/src/i18n.ts frontend/src/styles.css frontend/src/mobile.css
git commit -m "feat: refresh cached candidate searches"
```

---

### Task 7: Add permission-safe settings search

**Files:**
- Create: `frontend/src/components/settings/settingsSearchRegistry.ts`
- Create: `frontend/src/components/settings/SettingsSearch.tsx`
- Create: `frontend/src/components/settings/SettingsSearch.test.mjs`
- Modify: `frontend/src/components/settings/SettingsNavigation.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/i18n.ts`
- Modify: `frontend/src/styles.css`
- Modify: `frontend/src/mobile.css`

**Interfaces:**
- Produces: `type SettingsSearchEntry` with `key`, `tab`, `titleKey`, `descriptionKey`, `aliasKeys`, `role`, and `targetID`.
- Produces: `visibleSettingsSearchEntries(role)`.
- Produces: `<SettingsSearch entries query onQueryChange onSelect />`.

- [ ] **Step 1: Write failing registry and permission tests**

The Node test imports or source-checks the registry, asserts unique keys and target IDs, verifies every tab has entries, and proves `role: "admin"` items are absent for users. It also scans `App.tsx` to ensure every registry `targetID` appears as a `data-settings-target` value.

- [ ] **Step 2: Run the test and confirm failure**

Run: `cd frontend && node --test src/components/settings/SettingsSearch.test.mjs`

Expected: module-not-found failure.

- [ ] **Step 3: Create the complete registry**

Register these exact stable keys and target IDs:

```ts
const settingsSearchEntries: SettingsSearchEntry[] = [
  entry("profile", "account", "profile-settings", "profileSettings", "nickname", ["avatar"]),
  entry("resume", "playback", "playback-resume", "playbackResumeSetting", "playbackResumeHint", ["history"]),
  entry("desktop-home-player", "playback", "desktop-home-player", "homePlayerStyle", "homePlayerStyleHint", ["vinyl", "cassette", "ipod"]),
  entry("mobile-home-player", "playback", "mobile-home-player", "mobileHomePlayerStyle", "mobileHomePlayerStyleHint", ["mobile"]),
  entry("mineradio", "playback", "mineradio-stage", "mineradioStageEffects", "mineradioStageEffectsHint", ["effects"]),
  entry("artist-display", "playback", "artist-album-display", "artistAlbumDisplayStyle", "artistAlbumDisplayStyleHint", ["album"]),
  entry("persistent-queue", "playback", "persistent-queue", "persistentQueue", "persistentQueueHint", ["queue"]),
  entry("lyrics-display", "playback", "lyrics-display", "lyricsDisplayStyle", "lyricsDisplayStyleHint", ["lyrics"]),
  entry("lyrics-drag", "playback", "lyrics-drag-seek", "lyricsDragSeek", "lyricsDragSeekHint", ["seek"]),
  entry("ui-sounds", "playback", "ui-sounds", "uiSounds", "uiSoundsHint", ["sound"]),
  entry("history-scope", "playback", "playback-history-scope", "playbackHistorySettings", "playbackHistorySettingsHint", ["device"]),
  entry("language", "playback", "language", "language", "language", ["中文", "English"]),
  entry("theme", "playback", "theme", "theme", "theme", ["appearance"]),
  entry("web-font", "playback", "web-font", "webFont", "webFontHint", ["font"]),
  entry("lyrics-font", "playback", "lyrics-font", "lyricsFont", "lyricsFontHint", ["font", "lyrics"]),
  entry("offline-cache", "library", "offline-cache", "offlineCache", "offlineCacheHint", ["cache"]),
  entry("auto-cache", "library", "auto-cache-played", "autoCachePlayed", "autoCachePlayedHint", ["offline"]),
  entry("metadata-grouping", "library", "metadata-grouping", "metadataGrouping", "metadataGroupingHint", ["metadata"]),
  entry("smart-playlists", "library", "smart-playlists", "smartPlaylists", "smartPlaylistsHint", ["playlist"]),
  entry("metadata-writeback", "library", "metadata-writeback", "metadataWriteback", "metadataWritebackHint", ["tags"]),
  entry("path-metadata", "library", "path-metadata", "pathMetadata", "pathMetadataHint", ["filename", "path"]),
  entry("lyrics-sidecar", "library", "lyrics-sidecar", "lyricsSidecar", "lyricsSidecarHint", ["lrc"]),
  entry("library-directories", "library", "library-directories", "libraryDirectories", "libraryDirectoriesHint", ["folder", "scan"]),
  entry("scrobbling", "services", "scrobbling", "scrobbling", "scrobblingHint", ["last.fm", "listenbrainz"]),
  entry("mcp", "services", "mcp", "mcpAccess", "mcpAccessHint", ["token"]),
  entry("subsonic", "services", "subsonic", "subsonicAccount", "subsonicAccountHint", ["navidrome", "client"]),
  entry("sharing", "services", "sharing", "sharing", "sharingHint", ["public link"]),
  entry("dlna", "services", "dlna", "dlna", "dlnaHint", ["cast", "upnp"]),
  entry("transcoding", "services", "transcoding", "transcoding", "transcodingHint", ["quality"]),
  adminEntry("diagnostics", "system", "diagnostics", "diagnostics", "diagnosticsHint", ["debug"]),
  adminEntry("playback-source-retention", "system", "playback-source-retention", "playbackSourceRetention", "playbackSourceRetentionHint", ["retention"]),
  adminEntry("history-retention", "system", "history-retention", "playbackHistoryRetention", "playbackHistoryRetentionHint", ["retention"]),
  adminEntry("registration", "users", "registration", "registration", "registrationHint", ["signup"]),
  adminEntry("user-management", "users", "user-management", "userManagement", "userManagement", ["role", "account"]),
];
```

If an existing translation key has a different identifier, reuse that existing key and keep the stable registry key/target ID shown above. Add missing descriptions in both languages. Mark all `adminEntry` values as administrator-only before matching.

- [ ] **Step 4: Mark focus targets and openable sections**

Add stable `data-settings-target` IDs to each registered card or section. Extend `SettingsSection` so a selected search result can force the section open. Do not render hidden administrator sections for regular users.

- [ ] **Step 5: Implement search behavior**

Normalize query and localized searchable text with `toLocaleLowerCase`. Filter permission first, then match. Selecting a result switches tabs, opens its section, waits one animation frame, calls `scrollIntoView({block:"center"})`, and focuses the first control or a temporary `tabIndex={-1}` section heading. Clearing restores the tab active before search began.

- [ ] **Step 6: Add mobile and accessibility styling**

Use a one-column result list, 44px rows, clear category labels, visible focus, and an explicit no-result state. Search result navigation is immediate and uses no movement animation. Ensure the search field does not force the settings rail wider than the viewport.

- [ ] **Step 7: Run settings tests and build**

Run: `cd frontend && node --test src/components/settings/SettingsSearch.test.mjs && pnpm build`

Expected: PASS.

- [ ] **Step 8: Commit settings search**

```bash
git add frontend/src/components/settings/settingsSearchRegistry.ts frontend/src/components/settings/SettingsSearch.tsx frontend/src/components/settings/SettingsSearch.test.mjs frontend/src/components/settings/SettingsNavigation.tsx frontend/src/App.tsx frontend/src/i18n.ts frontend/src/styles.css frontend/src/mobile.css
git commit -m "feat: search visible settings"
```

---

### Task 8: Add cross-feature mobile, accessibility, and localization checks

**Files:**
- Create: `frontend/scripts/check-library-curation.mjs`
- Modify: `frontend/package.json`
- Modify: `frontend/src/i18n.ts`
- Modify: `frontend/src/styles.css`
- Modify: `frontend/src/mobile.css`

**Interfaces:**
- Produces package script: `test:library-curation`.

- [ ] **Step 1: Write the failing contract check**

Assert all four sort strings appear in types, API, and control; review-summary API is wired; refresh flags exist for metadata and lyrics; Chinese and English keys are paired; mobile controls include `min-height:44px`; hover rules use pointer media queries; reduced-motion removes transforms; and no new `transition: all` or `ease-in` appears in touched selectors.

- [ ] **Step 2: Run the check and confirm any missing contract**

Run: `cd frontend && node scripts/check-library-curation.mjs`

Expected: failure until all required source contracts are present.

- [ ] **Step 3: Fix copy and responsive gaps found by the check**

Use concise paired labels for sorting, review, missing reasons, refresh states, settings search, cache fallback, empty completion, and retry. Ensure 360px layouts wrap metadata issues and keep sheets within safe-area insets.

- [ ] **Step 4: Register and run focused frontend checks**

Add:

```json
"test:library-curation": "node --test src/components/LibrarySortControl.test.mjs src/components/settings/SettingsSearch.test.mjs && node scripts/check-library-curation.mjs"
```

Run: `cd frontend && pnpm test:candidate-cache && pnpm test:library-curation && pnpm lint && pnpm build`

Expected: PASS with zero lint errors and a successful Vite production build.

- [ ] **Step 5: Commit quality checks**

```bash
git add frontend/scripts/check-library-curation.mjs frontend/package.json frontend/src/i18n.ts frontend/src/styles.css frontend/src/mobile.css
git commit -m "test: cover library curation workflow"
```

---

### Task 9: Full verification and v0.9.36 release

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `frontend/package.json`
- Rebuild: `backend/web/dist`

**Interfaces:**
- Produces release version `0.9.36`.

- [ ] **Step 1: Run the full backend suite**

Run: `cd backend && go test ./... -count=1`

Expected: PASS with zero failing packages.

- [ ] **Step 2: Run the full frontend verification suite**

Run: `cd frontend && pnpm test:candidate-cache && pnpm test:library-curation && pnpm test:dlna-api && pnpm test:mineradio-motion && pnpm test:paper-shaders && pnpm test:smartisan-tonearm && pnpm test:walkman-theme && pnpm lint && pnpm build`

Expected: PASS with zero test/lint/build failures.

- [ ] **Step 3: Inspect the production diff**

Run: `git status --short && git diff --check && git diff --stat && git diff -- frontend/src/styles.css frontend/src/mobile.css backend/internal/library/song_browse.go backend/internal/library/candidate_cache.go`

Expected: only scoped source/generated changes, no whitespace errors, no unrelated user files.

- [ ] **Step 4: Update release metadata**

Add a bilingual `0.9.36` changelog section covering library sorting, incomplete-metadata review, persistent candidate reuse/refresh, settings search, and mobile/accessibility polish. Change `frontend/package.json` version to `0.9.36`.

- [ ] **Step 5: Rebuild embedded frontend assets after the version bump**

Run: `cd frontend && pnpm build`

Expected: PASS and updated `backend/web/dist` assets.

- [ ] **Step 6: Re-run release gates after generated assets change**

Run: `cd backend && go test ./... -count=1 && cd ../frontend && pnpm test:candidate-cache && pnpm test:library-curation && pnpm lint && pnpm build && cd .. && git diff --check`

Expected: every command exits zero.

- [ ] **Step 7: Commit the release**

```bash
git add CHANGELOG.md frontend/package.json backend/web/dist
git commit -m "chore: release v0.9.36"
```

- [ ] **Step 8: Verify commit history and clean state**

Run: `git status --short --branch && git log -10 --oneline --decorate`

Expected: clean `main`, release commit at `HEAD`, implementation commits immediately below it.

- [ ] **Step 9: Push the verified branch**

Run: `git push origin main`

Expected: remote accepts the update and `main` advances to the v0.9.36 release commit.
