# Settings and Candidate Loading Design

## Goal

Make the settings area easier to navigate on desktop and mobile, show locally derived metadata immediately, and prevent repeated online lyric or metadata candidate searches during the same browser session.

## Scope

This change covers:

- settings information architecture and responsive navigation;
- song and album metadata candidate loading;
- lyric candidate request reuse;
- loading, empty, error, and cache invalidation behavior;
- focused backend and frontend verification.

It does not add persistent online-result storage, change provider matching algorithms, or alter metadata writeback confirmation requirements.

## Settings Information Architecture

Replace the current three broad categories with six task-oriented categories:

1. **Account**
   - nickname;
   - avatar.
2. **Playback and appearance**
   - language and application theme;
   - uploaded application font;
   - desktop or mobile home-player style;
   - Mineradio stage effects;
   - artist/album presentation style;
   - playback resume behavior;
   - persistent queue;
   - lyric presentation and drag-to-seek;
   - UI sounds;
   - playback-history separation by device;
   - lyric font selection and size.
3. **Media library**
   - library directories and directory health checks;
   - offline cache usage and automatic caching;
   - metadata grouping;
   - smart playlists;
   - audio-tag writeback;
   - path-assisted metadata extraction;
   - automatic lyric sidecar saving.
4. **Services and connections**
   - scrobbling;
   - MCP access token;
   - Subsonic client credentials and server switch;
   - public sharing;
   - DLNA casting and library serving;
   - transcoding policy and quality.
5. **System**
   - diagnostics;
   - playback-source retention;
   - playback-history retention.
6. **User management**
   - registration switch;
   - user list and role management.

Account and playback preferences remain available to regular users. Administrative controls remain hidden or replaced with the existing administrator-only message when appropriate. User management is shown only to administrators.

The existing settings values and persistence APIs remain unchanged. This is a presentation and ownership reorganization, not a settings schema migration.

## Responsive Settings Navigation

Desktop uses a compact category rail above the active panel. The selected category is visually clear without relying only on color.

Mobile uses a horizontally scrollable, single-row category rail instead of the current vertical tab stack. Requirements:

- the active category scrolls into view when selected;
- controls keep a minimum 44-pixel touch target;
- the rail does not wrap and does not consume most of the first viewport;
- content is a single-column stack;
- dense groups use the existing collapsible settings-section pattern;
- changing categories is immediate and has no movement animation;
- frequent controls avoid decorative animation; press feedback may use a subtle transform lasting no more than 160 milliseconds;
- reduced-motion preferences remove transform-based feedback.

## Metadata Candidate Loading

### API behavior

The song and album metadata-candidate endpoints accept an optional scope:

- `path`: return only candidates derived locally from the audio path;
- `online`: query only configured online providers;
- omitted or `all`: retain the existing combined response for compatibility.

Path scope must not call an online provider. Online scope does not duplicate the path candidate.

### Client flow

When the metadata editor opens:

1. Read any cached path and online results for the song or album.
2. If a complete cached entry exists, show it immediately and make no request.
3. Otherwise request the path scope first.
4. Render the path candidate as soon as it arrives.
5. Start the online request after the path result has been committed to the UI.
6. Append online candidates without clearing or replacing the path candidate.

The candidate header distinguishes available results from online loading. A path candidate remains interactive while online providers are running. Failure of online search preserves the local result and uses a quiet inline failure state rather than turning the whole editor into an error state.

Cache keys include target type and ID. Cached arrays and in-flight promises are reused for the browser session. A successful metadata writeback invalidates the affected target so a later edit uses the new title, artist, album, or path-derived state.

## Lyric Candidate Loading

Lyric candidates use a session-level cache keyed by song ID and a second map for in-flight requests.

Opening the candidate panel follows these rules:

- cached candidates open instantly without a loading flash or network request;
- repeated clicks while the first request is running await the same promise;
- the first request shows the existing matching state;
- closing the panel does not discard candidates;
- empty results are cached for the session, preventing repeated unsuccessful searches;
- request failures are not cached, allowing a later retry;
- metadata changes affecting a song invalidate that song's lyric-candidate cache.

Selecting a lyric does not require another candidate search and does not clear the cached candidate list.

## Candidate UI and Motion

Local metadata candidates appear first and remain in a stable position while online items are appended. Candidate buttons use at least 44-pixel touch targets on mobile, truncate long titles safely, and preserve source and artist information.

No list entrance stagger is used because candidate panels may be opened repeatedly. Cached content appears immediately. Online completion may use a short opacity transition only; it must not move the path result or block interaction.

Loading indicators describe only the online portion of the work. Empty copy is shown only after both local and online lookups have completed with no candidates.

## Error Handling

- Path lookup failure does not prevent online lookup.
- Online metadata failure keeps local candidates visible.
- Lyric candidate failure clears the loading state and permits retry.
- Stale responses cannot update a dialog after it closes or switches targets.
- Cache entries are written only by successful requests.

## Verification

Backend tests cover:

- path scope returning the local candidate without invoking online providers;
- online scope omitting the path candidate;
- default scope preserving the combined response;
- song and album endpoint scope parsing.

Frontend verification covers:

- settings category membership and administrator visibility;
- desktop and narrow mobile layout behavior;
- metadata path-first rendering and online append behavior;
- session-cache hits and in-flight request reuse;
- empty-result caching;
- failed-request retry behavior;
- cache invalidation following metadata writeback.

The final release workflow runs Go tests, frontend checks, and a production frontend build. After successful verification, update the changelog and bump the frontend package version from `0.9.34` to `0.9.35`, rebuild embedded frontend assets, commit the implementation, and push the current branch.
