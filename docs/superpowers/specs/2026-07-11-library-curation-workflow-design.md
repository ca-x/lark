# Library Curation Workflow Design

## Goal

Build a focused library-curation workflow that makes the song library easier to sort, automatically identifies incomplete metadata, persists online metadata and lyric candidate results, and makes the existing settings hierarchy searchable on desktop and mobile.

## Scope

This release covers:

- song-library sorting by library-added time and filename in both directions;
- an automatically derived review view for songs with incomplete metadata;
- persistent online metadata and lyric candidate caches;
- explicit candidate refresh and invalidation behavior;
- settings search across controls visible to the current user;
- desktop and mobile interaction, accessibility, error handling, and release verification.

This release does not add unified multi-source tracks, mixed-source queues, personalized discovery, multi-app passwords, a general background-task/SSE framework, audio fingerprinting, playlist import, or acquisition/download features.

## Product Flow

The workflow stays inside the existing library and metadata editor instead of adding a separate administration application:

```text
Song library
├── Sort by added time or filename
├── Filter to automatically detected incomplete songs
└── Open the existing metadata editor
    ├── Show the path-derived candidate immediately
    ├── Reuse a valid persistent online-result cache
    ├── Query online providers only on a cache miss or explicit refresh
    ├── Let the user confirm and write back metadata
    └── Remove the song from review when its metadata becomes complete
```

The default library behavior remains added-time descending so existing users and older clients retain the current ordering.

## Song Sorting

The paginated song endpoint accepts a `sort` query parameter with four values:

- `added_desc`: `created_at DESC, id DESC`;
- `added_asc`: `created_at ASC, id ASC`;
- `filename_asc`: normalized filename ascending, then `id ASC`;
- `filename_desc`: normalized filename descending, then `id DESC`.

The added-time field is the song record's `created_at`, meaning the time the song entered the Lark library. It is not the audio file modification time.

Invalid or omitted values fall back to `added_desc`. The selected sort becomes part of the existing song-page cache and singleflight key. Every ordering includes the song ID as a deterministic tiebreaker so changing pages cannot skip or duplicate songs with equal primary values.

Filename sorting is case-insensitive and uses the stored `file_name`, not the full path. The implementation must preserve deterministic database pagination; it must not fetch the entire library and sort it in the browser.

Changing sort resets the library to page one while preserving the search term, favorites state, and incomplete-review filter.

## Incomplete Metadata Review

The normal song-page endpoint accepts `review=incomplete`. The review predicate includes a song when any of these conditions is true:

- it has no associated artist;
- it has no associated album;
- its trimmed title is empty or equals a recognized unknown-title placeholder;
- its artist or album equals a recognized scanner-generated unknown placeholder.

Recognized placeholders include the scanner's actual English and Chinese unknown values. Placeholder matching is centralized in the backend rather than duplicated in handlers or the frontend.

Review state is derived from current library data and is not stored separately. A successful metadata writeback that makes the song complete therefore removes it from the next review query automatically.

`GET /api/library/review-summary` returns:

```json
{
  "incomplete_songs": 12
}
```

The summary failure must not prevent normal library browsing. The song-page response remains the source of truth for the current review page.

Review rows display the exact missing reasons returned by the backend, such as missing artist or missing album. This avoids reproducing placeholder rules in TypeScript and keeps Chinese and English presentation independent of detection logic.

## Persistent Candidate Cache

Persistent candidates use a dedicated Ent entity rather than `AppSetting`. Each record stores:

- user ID;
- target type (`song` or `album`);
- target ID;
- query kind (`metadata_online` or `lyrics`);
- a query snapshot hash;
- serialized candidate summaries;
- creation, update, and expiration timestamps.

The unique key covers user, target type, target ID, query kind, and snapshot hash. Indexes support lookup by unique key and cleanup by expiration time.

The query snapshot is derived from the normalized fields that affect provider matching. For songs it includes title, artist, album, duration, path, and the candidate-cache schema version. Album metadata uses album title, album artist, year, and schema version. Changing relevant metadata produces a new hash, so stale results cannot be returned for a renamed target.

Path-derived metadata is inexpensive and remains generated locally on demand. Only online candidate summaries are persisted.

### Expiration

- online metadata candidates expire after seven days;
- lyric candidates expire after 24 hours;
- successful empty results use the same expiration as non-empty results;
- timeouts, provider errors, rate limits, cancellation, and parse errors are not cached.

Expired rows are treated as misses. Candidate lookups opportunistically delete expired entries with a bounded cleanup operation; this release does not add a resident cleanup worker.

### Loading and refresh

Existing scoped metadata endpoints retain their compatible behavior and gain an optional `refresh` parameter:

```text
GET /api/songs/:id/metadata-candidates?scope=path|online|all&refresh=true|false
GET /api/albums/:id/metadata-candidates?scope=path|online|all&refresh=true|false
GET /api/songs/:id/lyrics/candidates?refresh=true|false
```

For an online request:

1. Build the query snapshot and look for an unexpired user-scoped cache entry.
2. Return the cached candidate array immediately when present, including an empty array.
3. On a miss, use singleflight to collapse concurrent identical provider calls.
4. Persist and return a successful result.
5. Return an error without writing the cache when the provider operation fails.

`refresh=true` bypasses the existing value but still participates in singleflight. A successful refresh atomically replaces the prior cache record. A failed refresh leaves the prior cached value stored and visible in the editor.

The browser-session cache remains as a first-level cache. The backend persistent cache is authoritative across reloads and devices.

### Cache invalidation

A successful song metadata writeback invalidates metadata and lyric cache rows for that song and metadata cache rows for affected albums. Album writeback invalidates the album metadata cache and the related song metadata snapshots. Deleting a song or album removes associated candidate cache rows through explicit cleanup.

Lyric cache rows contain candidate summaries only. Selecting a lyric candidate still resolves the full lyric body through the existing candidate-selection flow, preventing large lyric bodies from multiplying inside the cache table.

## API Compatibility and Models

`GET /api/songs/page` gains optional parameters:

```text
sort=added_desc|added_asc|filename_asc|filename_desc
review=incomplete
```

Omitting both parameters preserves the current response shape and default ordering. The internal song-list service accepts typed sort and review values rather than raw handler strings.

Songs returned in incomplete-review mode include a `metadata_issues` array containing stable machine keys:

```json
["missing_artist", "missing_album"]
```

Normal song responses may omit the array when it is empty. The frontend maps these keys to localized copy.

The frontend API accepts the selected sort explicitly. All song-page callers that do not expose sorting pass or receive the default value without changing behavior.

## Desktop Interaction

The library toolbar adds a compact sort trigger close to search and filtering. The trigger always communicates its current state using one of these labels:

- newest added;
- oldest added;
- filename A-Z;
- filename Z-A.

The menu is anchored to the trigger. Pointer-opened menus may use an origin-aware opacity and scale transition lasting no more than 180 milliseconds with a strong ease-out curve. Keyboard-opened menus appear immediately. Selecting a value closes the menu, resets pagination, and starts the new request without animating the song rows into their new positions.

The library toolbar also exposes a stable incomplete-review filter with its count. A zero count does not remove or shift the control; it changes to a quiet completed state.

The review view reuses the normal song list. Each row shows localized issue labels and opens the existing metadata editor. After a successful writeback, a newly complete row may fade and collapse for at most 180 milliseconds before the page and summary reconcile. A failed writeback leaves the row in place.

## Mobile Interaction

Mobile exposes one sort button with a minimum 44-pixel target. It opens a bottom sheet containing a single-select list of all four values. The active value uses both text and an icon/checkmark rather than color alone. Selection closes the sheet, resets to page one, returns the list to the top, and preserves search and review state.

The review entry and count fit the existing mobile library toolbar without adding a second row of four sorting buttons. Review rows stack their metadata issues beneath the primary title and remain readable at approximately 360 CSS pixels without horizontal scrolling.

Candidate and settings-search actions use at least 44-pixel touch targets. Hover styling is gated behind `@media (hover: hover) and (pointer: fine)` so taps do not leave controls in a false hover state.

## Candidate Editor Interaction

Opening a metadata editor follows this sequence:

1. Render any session-cached data synchronously.
2. Request and render the path candidate immediately when needed.
3. Request online candidates from the persistent-cache-aware endpoint.
4. Append online candidates without moving or replacing the path candidate.

A persistent cache hit does not display a loading flash. A cache miss displays a quiet online-only loading state beneath the usable path result. Online failure preserves the path candidate, prior cached candidates, and manual editing.

The editor adds an explicit localized refresh action. While refresh is running it is disabled and communicates progress. A successful result replaces the online candidate region using an opacity-only transition no longer than 180 milliseconds. A failed refresh retains the previous candidates and presents a retryable inline error.

Lyrics follow the same cache-hit, cache-miss, empty-result, failure, and explicit-refresh rules. Reopening a candidate panel never repeats a valid search merely because the panel was closed.

Stale responses are guarded by the current target ID and request generation. They cannot update an editor that has closed or switched targets.

## Settings Search

The settings page adds a search field above category navigation. A searchable registry describes each existing setting with:

- a stable key;
- owning category and section;
- localized title and description;
- localized search aliases;
- required role;
- a focus target.

Search operates only over registry items visible to the current user. Administrator-only controls are excluded before matching, preventing search from revealing their existence to regular users.

Results show the matching setting and its category in a single-column list. Selecting a result:

1. switches to the owning category;
2. opens the containing section;
3. scrolls the target into view;
4. moves focus to the control or its section heading.

Clearing the query returns to the category that was active before search. No-result copy is explicit and does not substitute unrelated fuzzy matches. Search covers localized titles, descriptions, and deliberate aliases; it does not index hidden raw configuration keys.

## Motion and Accessibility

Sorting and filtering are high-frequency actions. They receive no list-reordering animation and no decorative stagger. Candidate cache hits render immediately.

Allowed motion is limited to:

- 120-160 millisecond press feedback on pointer-triggered pressable controls;
- an origin-aware menu transition no longer than 180 milliseconds;
- an opacity-only candidate replacement no longer than 180 milliseconds;
- a short review-row completion transition that communicates removal.

Transitions target exact properties and use custom ease-out curves. No UI transition uses `ease-in`, `transition: all`, or a `scale(0)` entry state.

Under `prefers-reduced-motion: reduce`, transform-based feedback, menu movement, and row collapse are removed. Necessary color and short opacity state changes may remain. Keyboard-triggered sorting and settings navigation do not animate.

All controls have accessible names, visible focus states, and keyboard operation. The sort menu and mobile bottom sheet expose their single-selection semantics. Focus returns to the sort trigger after dismissal and moves predictably after a review item leaves the list.

## Error Handling

- A failed sort request keeps the existing list, restores the last successfully loaded sort selection, and shows a non-blocking error.
- A failed review-summary request leaves ordinary browsing operational and renders the review control without a count.
- A persistent-cache read failure degrades to a provider query.
- A persistent-cache write failure still returns the successful provider result and is logged server-side.
- Online metadata or lyric failure never clears a path result or valid prior candidate list.
- Failed explicit refresh leaves the previous cached value intact.
- Failed metadata writeback leaves the song in review and reports the specific error.
- Request cancellation and target changes prevent stale UI updates.
- Backend provider requests retain bounded timeouts.

## Verification

Backend tests cover:

- all four sort orders and deterministic tiebreakers;
- default-sort compatibility;
- sorting combined with search, favorites, pagination, and incomplete review;
- incomplete-song detection and automatic removal after writeback;
- review-summary counts;
- user isolation for candidate caches;
- seven-day metadata and 24-hour lyric expiration;
- successful empty-result caching;
- failure non-caching;
- concurrent request collapse;
- refresh bypass and atomic replacement;
- writeback invalidation;
- graceful cache read and write failure behavior.

Frontend tests and source-contract checks cover:

- sort selection, page reset, and state preservation;
- current sort labels and menu selection semantics;
- review counts and localized issue labels;
- immediate cache-hit rendering without a loading flash;
- path-first online append behavior;
- refresh failure preserving old candidates;
- settings-search role filtering and focus navigation;
- layout at narrow mobile widths, minimum touch targets, and reduced motion;
- complete Chinese and English copy.

Release verification runs the full Go test suite, all frontend tests and contract checks, TypeScript validation, and a production frontend build. Generated embedded frontend assets are rebuilt and inspected.

After successful verification:

- update the bilingual changelog;
- bump `frontend/package.json` from `0.9.35` to `0.9.36`;
- rebuild embedded frontend assets;
- commit the implementation and release changes;
- push the current `main` branch.

No release tag is created or moved unless the repository's established release workflow explicitly requires it.
