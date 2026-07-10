# Settings and Candidate Loading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize settings into task-oriented categories, make metadata candidates path-first, and reuse lyric and metadata candidate requests for the browser session.

**Architecture:** Keep the existing settings persistence schema and provider matching logic. Add a scoped metadata-candidate API, a small frontend session cache with in-flight request deduplication, and a responsive settings category navigation component while leaving the settings controls owned by `SettingsPanel`.

**Tech Stack:** Go, Echo, Ent, React 19, TypeScript, CSS, Node test runner, Vite.

## Global Constraints

- Do not persist online candidate results across page reloads.
- Preserve the existing metadata-candidate response when `scope` is omitted.
- Do not change metadata writeback confirmation requirements.
- Mobile category controls must have at least 44-pixel touch targets.
- Cached candidate panels must open without a loading flash or movement animation.
- After all tests pass, bump `frontend/package.json` from `0.9.34` to `0.9.35`, update `CHANGELOG.md`, rebuild embedded frontend assets, commit, and push `main`.

---

## File Structure

- Modify `backend/internal/library/metadata_writeback.go`: define metadata candidate scopes and separate local/online work.
- Modify `backend/internal/library/metadata_writeback_test.go`: verify provider isolation and compatibility behavior.
- Modify `backend/internal/api/server.go`: pass the `scope` query parameter to the library service.
- Create `frontend/src/services/candidateCache.ts`: own session cache, in-flight promise reuse, keys, and invalidation.
- Create `frontend/src/services/candidateCache.test.mjs`: verify cache hits, empty arrays, failures, invalidation, and concurrent reuse.
- Modify `frontend/src/services/api.ts`: expose scoped metadata candidate calls.
- Modify `frontend/src/components/MetadataEditorDialog.tsx`: render path candidates first and append online candidates.
- Create `frontend/src/components/settings/SettingsNavigation.tsx`: render accessible desktop/mobile category navigation.
- Modify `frontend/src/types/app.ts`: replace the three-value settings tab type with six categories.
- Modify `frontend/src/App.tsx`: reorganize settings content, use lyric cache, and invalidate caches after writeback.
- Modify `frontend/src/i18n.ts`: add Chinese and English category/loading/error copy.
- Modify `frontend/src/styles.css` and `frontend/src/mobile.css`: category rail, stable candidate states, touch targets, and reduced motion.
- Create `frontend/scripts/check-settings-organization.mjs`: assert category membership and scoped/cached request wiring.
- Modify `frontend/package.json`: register focused tests and bump the release version.
- Modify `CHANGELOG.md`: add the bilingual `0.9.35` entry.
- Rebuild `backend/web/dist`: embed the verified frontend build.

---

### Task 1: Add scoped metadata candidate queries

**Files:**
- Modify: `backend/internal/library/metadata_writeback.go`
- Modify: `backend/internal/library/metadata_writeback_test.go`
- Modify: `backend/internal/api/server.go`

**Interfaces:**
- Produces: `type MetadataCandidateScope string`
- Produces: `ParseMetadataCandidateScope(string) MetadataCandidateScope`
- Changes: `SongMetadataCandidates(context.Context, int, MetadataCandidateScope) ([]models.MetadataCandidate, error)`
- Changes: `AlbumMetadataCandidates(context.Context, int, MetadataCandidateScope) ([]models.MetadataCandidate, error)`

- [ ] **Step 1: Write failing scope tests**

Add tests using an `online.Provider` fake whose `SearchSongs` and `SearchAlbums` methods increment counters. Create Ent song/album fixtures with paths such as `/music/Artist/Album/01 - Title.flac`, then assert:

```go
pathItems, err := service.SongMetadataCandidates(ctx, songID, MetadataCandidateScopePath)
if err != nil { t.Fatal(err) }
if provider.songSearches != 0 { t.Fatalf("path scope called provider %d times", provider.songSearches) }
if len(pathItems) != 1 || pathItems[0].Source != metadataPathCandidateSource {
    t.Fatalf("unexpected path candidates: %#v", pathItems)
}

onlineItems, err := service.SongMetadataCandidates(ctx, songID, MetadataCandidateScopeOnline)
if err != nil { t.Fatal(err) }
if provider.songSearches != 1 { t.Fatalf("online scope searches = %d", provider.songSearches) }
for _, item := range onlineItems {
    if item.Source == metadataPathCandidateSource { t.Fatalf("online scope included path: %#v", onlineItems) }
}

allItems, err := service.SongMetadataCandidates(ctx, songID, MetadataCandidateScopeAll)
if err != nil { t.Fatal(err) }
if len(allItems) < 2 || allItems[0].Source != metadataPathCandidateSource {
    t.Fatalf("combined scope did not preserve path-first response: %#v", allItems)
}
```

Add equivalent album assertions for `SearchAlbums`.

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `go test ./internal/library -run 'Test(Song|Album)MetadataCandidatesScope' -count=1`

Expected: compile failure because the scope type and new signatures do not exist.

- [ ] **Step 3: Implement scope parsing and provider isolation**

Add:

```go
type MetadataCandidateScope string

const (
    MetadataCandidateScopeAll    MetadataCandidateScope = "all"
    MetadataCandidateScopePath   MetadataCandidateScope = "path"
    MetadataCandidateScopeOnline MetadataCandidateScope = "online"
)

func ParseMetadataCandidateScope(value string) MetadataCandidateScope {
    switch strings.ToLower(strings.TrimSpace(value)) {
    case string(MetadataCandidateScopePath):
        return MetadataCandidateScopePath
    case string(MetadataCandidateScopeOnline):
        return MetadataCandidateScopeOnline
    default:
        return MetadataCandidateScopeAll
    }
}
```

In both service methods, compute the path candidate without querying providers. Return it immediately for `path`; skip it for `online`; for `all`, prepend it to the sorted online results exactly as today. Preserve empty-array JSON behavior.

Update handlers:

```go
scope := library.ParseMetadataCandidateScope(c.QueryParam("scope"))
items, err := s.lib.SongMetadataCandidates(c.Request().Context(), id, scope)
```

and the equivalent album call.

- [ ] **Step 4: Run backend tests**

Run: `go test ./internal/library ./internal/api -count=1`

Expected: PASS.

- [ ] **Step 5: Commit backend scope support**

```bash
git add backend/internal/library/metadata_writeback.go backend/internal/library/metadata_writeback_test.go backend/internal/api/server.go
git commit -m "feat: scope metadata candidate queries"
```

---

### Task 2: Add the frontend candidate session cache

**Files:**
- Create: `frontend/src/services/candidateCache.ts`
- Create: `frontend/src/services/candidateCache.test.mjs`
- Modify: `frontend/package.json`

**Interfaces:**
- Produces: `getCandidateCache<T>(key: string): T[] | undefined`
- Produces: `loadCandidateCache<T>(key: string, loader: () => Promise<T[]>): Promise<T[]>`
- Produces: `invalidateCandidateCache(...keys: string[]): void`
- Produces: `metadataCandidateCacheKey(type, id, scope): string`
- Produces: `lyricCandidateCacheKey(songID): string`

- [ ] **Step 1: Write the cache tests**

Create Node tests that assert one loader call for two concurrent requests, cache reuse afterward, empty-array reuse, rejected-loader retry, and targeted invalidation:

```js
const first = loadCandidateCache("lyrics:7", loader);
const second = loadCandidateCache("lyrics:7", loader);
assert.strictEqual(first, second);
assert.deepEqual(await first, [{ id: "a" }]);
assert.equal(calls, 1);
assert.deepEqual(await loadCandidateCache("lyrics:7", loader), [{ id: "a" }]);
assert.equal(calls, 1);
```

- [ ] **Step 2: Run the test and confirm failure**

Run: `node --test src/services/candidateCache.test.mjs`

Expected: module-not-found failure.

- [ ] **Step 3: Implement the cache**

Use module-level maps and delete only the in-flight entry in `finally`:

```ts
const values = new Map<string, unknown[]>();
const requests = new Map<string, Promise<unknown[]>>();

export function getCandidateCache<T>(key: string): T[] | undefined {
  return values.get(key) as T[] | undefined;
}

export function loadCandidateCache<T>(key: string, loader: () => Promise<T[]>): Promise<T[]> {
  if (values.has(key)) return Promise.resolve(values.get(key) as T[]);
  const existing = requests.get(key);
  if (existing) return existing as Promise<T[]>;
  const request = loader()
    .then((items) => {
      values.set(key, items);
      return items;
    })
    .finally(() => requests.delete(key));
  requests.set(key, request);
  return request;
}
```

Add key helpers and invalidation without adding TTL or local storage.

- [ ] **Step 4: Register and run the test**

Add `"test:candidate-cache": "node --test src/services/candidateCache.test.mjs"` to `frontend/package.json`.

Run: `pnpm test:candidate-cache`

Expected: PASS.

- [ ] **Step 5: Commit the cache**

```bash
git add frontend/src/services/candidateCache.ts frontend/src/services/candidateCache.test.mjs frontend/package.json
git commit -m "feat: cache candidate searches per session"
```

---

### Task 3: Make metadata candidates path-first

**Files:**
- Modify: `frontend/src/services/api.ts`
- Modify: `frontend/src/components/MetadataEditorDialog.tsx`
- Modify: `frontend/src/i18n.ts`
- Modify: `frontend/src/styles.css`
- Modify: `frontend/src/mobile.css`

**Interfaces:**
- Consumes: cache helpers from Task 2.
- Produces: scoped API calls `songMetadataCandidates(id, scope)` and `albumMetadataCandidates(id, scope)`.

- [ ] **Step 1: Add a focused source contract check**

In `frontend/scripts/check-settings-organization.mjs`, assert that `api.ts` contains `scope=${encodeURIComponent(scope)}`, and that the metadata editor requests `"path"` before `"online"`, imports `loadCandidateCache`, and retains existing candidates while online loading.

- [ ] **Step 2: Run the source check and confirm failure**

Run: `node scripts/check-settings-organization.mjs`

Expected: assertion failure for missing scoped API/cache wiring.

- [ ] **Step 3: Add scoped API methods**

Use:

```ts
songMetadataCandidates: (id: number, scope: "path" | "online" | "all" = "all") =>
  request<MetadataCandidate[] | null>(`/api/songs/${id}/metadata-candidates?scope=${encodeURIComponent(scope)}`).then(arrayOrEmpty),
```

and the equivalent album method.

- [ ] **Step 4: Implement path-first dialog loading**

Track separate `pathCandidates`, `onlineCandidates`, `onlineLoading`, and `onlineError` state. On target change, synchronously seed state from cache, then load missing path data. After committing the path result, load missing online data. Guard every state update with the existing cancellation flag.

Merge by `source:id`, keeping path entries first. Do not replace a populated list with a spinner. Show copy equivalent to “正在补充在线候选” and “在线候选加载失败，可稍后重试” while preserving the local button.

After successful writeback, invalidate both metadata scope keys for the target before calling `onSaved`.

- [ ] **Step 5: Add responsive candidate styling**

Ensure candidate buttons have `min-height:44px` on mobile, long text uses ellipsis, and the online status is an inline row. Use opacity-only transition at most 180ms and disable it under `prefers-reduced-motion: reduce`.

- [ ] **Step 6: Run frontend checks**

Run: `pnpm test:candidate-cache && node scripts/check-settings-organization.mjs && pnpm build`

Expected: PASS.

- [ ] **Step 7: Commit path-first metadata loading**

```bash
git add frontend/src/services/api.ts frontend/src/components/MetadataEditorDialog.tsx frontend/src/i18n.ts frontend/src/styles.css frontend/src/mobile.css frontend/scripts/check-settings-organization.mjs
git commit -m "feat: show path metadata before online matches"
```

---

### Task 4: Reuse lyric candidate results

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/services/candidateCache.ts`

**Interfaces:**
- Consumes: `lyricCandidateCacheKey`, `getCandidateCache`, `loadCandidateCache`, and `invalidateCandidateCache`.

- [ ] **Step 1: Extend the source contract check**

Assert that `openLyricCandidates` checks cached results before setting loading, calls `loadCandidateCache`, and no longer calls `api.lyricCandidates` directly on every opening.

- [ ] **Step 2: Run the check and confirm failure**

Run: `node scripts/check-settings-organization.mjs`

Expected: failure for lyric cache wiring.

- [ ] **Step 3: Implement cache-first lyric opening**

Use the song ID captured before awaiting:

```ts
const songID = current.id;
const key = lyricCandidateCacheKey(songID);
const cached = getCandidateCache<LyricCandidate>(key);
setLyricCandidatesOpen(true);
if (cached !== undefined) {
  setLyricCandidates(cached);
  setLyricCandidatesLoading(false);
  return;
}
setLyricCandidatesLoading(true);
try {
  const items = await loadCandidateCache(key, () => api.lyricCandidates(songID));
  if (currentRef.current?.id === songID) setLyricCandidates(items);
} finally {
  if (currentRef.current?.id === songID) setLyricCandidatesLoading(false);
}
```

Do not clear the cache when the candidate panel closes or a lyric is selected. When metadata writeback returns song IDs, invalidate their lyric keys.

- [ ] **Step 4: Run frontend verification**

Run: `pnpm test:candidate-cache && node scripts/check-settings-organization.mjs && pnpm build`

Expected: PASS.

- [ ] **Step 5: Commit lyric request reuse**

```bash
git add frontend/src/App.tsx frontend/src/services/candidateCache.ts frontend/scripts/check-settings-organization.mjs
git commit -m "fix: reuse lyric candidate searches"
```

---

### Task 5: Reorganize settings and mobile navigation

**Files:**
- Create: `frontend/src/components/settings/SettingsNavigation.tsx`
- Modify: `frontend/src/types/app.ts`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/i18n.ts`
- Modify: `frontend/src/styles.css`
- Modify: `frontend/src/mobile.css`
- Modify: `frontend/scripts/check-settings-organization.mjs`

**Interfaces:**
- Produces: `SettingsTab = "account" | "playback" | "library" | "services" | "system" | "users"`.
- Produces: `SettingsNavigation({ activeTab, tabs, onTabChange })`.

- [ ] **Step 1: Add settings organization assertions**

Make the script assert all six IDs and labels exist, old `profile/site` tab IDs are absent from the settings tab list, user management is admin-only, and mobile CSS uses horizontal overflow rather than `flex-direction:column` for `.settings-tabs`.

- [ ] **Step 2: Run the check and confirm failure**

Run: `node scripts/check-settings-organization.mjs`

Expected: failure for missing category IDs and old mobile layout.

- [ ] **Step 3: Add the navigation component and type**

Render a `role="tablist"` container with buttons using `aria-selected`, `aria-controls`, and a ref callback that calls `scrollIntoView({ block: "nearest", inline: "nearest" })` for the selected item after a category change. Do not animate category panel movement.

- [ ] **Step 4: Reassign existing controls without changing persistence**

Move the existing JSX blocks into these conditions:

```text
account  -> profile card
playback -> language/theme/font, player styles, resume, display, queue, lyrics UI/font, UI sounds, device history
library  -> directories, offline cache, grouping, smart playlists, writeback, path assist, lyric sidecar saving
services -> scrobbling, MCP, Subsonic credentials/server, sharing, DLNA, transcoding
system   -> diagnostics, playback-source retention, history retention
users    -> registration and user list
```

Keep administrator checks on global switches and hide the `system` and `users` tabs from regular users. Use existing `SettingsSection` for dense groups; default the primary group open and secondary advanced groups closed where the page would otherwise become a long wall.

- [ ] **Step 5: Add bilingual category copy**

Add Chinese and English keys for account, playback/appearance, media library, services/connections, and system settings. Reuse `userManagement` for users.

- [ ] **Step 6: Implement desktop and mobile styling**

Desktop keeps a compact pill rail. Mobile uses:

```css
.settings-tabs {
  display:flex;
  flex-direction:row;
  width:100%;
  overflow-x:auto;
  scroll-snap-type:x proximity;
  -webkit-overflow-scrolling:touch;
}
.settings-tabs button {
  flex:0 0 auto;
  width:auto;
  min-height:44px;
  scroll-snap-align:start;
}
```

Remove the current mobile chevron accordion styling for top-level categories. Add `:active { transform:scale(.97) }` with a 140–160ms transform transition and disable transforms for reduced motion.

- [ ] **Step 7: Run UI verification**

Run: `node scripts/check-settings-organization.mjs && pnpm lint && pnpm build`

Expected: PASS.

- [ ] **Step 8: Commit settings reorganization**

```bash
git add frontend/src/components/settings/SettingsNavigation.tsx frontend/src/types/app.ts frontend/src/App.tsx frontend/src/i18n.ts frontend/src/styles.css frontend/src/mobile.css frontend/scripts/check-settings-organization.mjs
git commit -m "feat: reorganize settings by task"
```

---

### Task 6: Release verification, version bump, embedded build, and push

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/pnpm-lock.yaml`
- Modify: `CHANGELOG.md`
- Modify: `backend/web/dist/**`

**Interfaces:**
- Produces release version `0.9.35`.

- [ ] **Step 1: Run the complete backend suite**

Run: `go test ./... -count=1` from `backend`.

Expected: PASS.

- [ ] **Step 2: Run the complete frontend verification**

Run: `pnpm test:candidate-cache && node scripts/check-settings-organization.mjs && pnpm lint && pnpm build` from `frontend`.

Expected: PASS and a fresh `dist` directory.

- [ ] **Step 3: Bump version and changelog**

Set both package manifest and lockfile importer version to `0.9.35`. Add bilingual changelog entries dated `2026-07-10` covering settings categories/mobile navigation, path-first metadata candidates, and lyric/metadata request reuse.

- [ ] **Step 4: Rebuild embedded assets**

Run: `pnpm build` from `frontend`, then copy the generated `frontend/dist` contents into `backend/web/dist` using the repository's existing build workflow. Confirm stale hashed assets are removed only from `backend/web/dist/assets` and user source files are untouched.

- [ ] **Step 5: Verify the release tree**

Run:

```bash
git diff --check
git status --short
go test ./... -count=1
```

from the appropriate backend/repository directories, followed by the frontend verification command again if embedded assets changed after the previous build.

Expected: only intended source, changelog, version, plan, and generated dist changes; all tests PASS.

- [ ] **Step 6: Commit the release**

```bash
git add CHANGELOG.md frontend/package.json frontend/pnpm-lock.yaml backend/web/dist
git commit -m "chore: release v0.9.35"
```

- [ ] **Step 7: Push main**

Run: `git push origin main`

Expected: remote `main` advances to the release commit.
