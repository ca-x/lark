# SongLoft Compatibility Baseline

Lark's JS plugin compatibility layer is derived from SongLoft at commit
`825f70f603a773fc8c0ded555a0cbe753d2a0d52`.

Upstream repository: <https://github.com/songloft-org/songloft>

The compatibility work covers the public behavior of these upstream areas:

- `internal/jsruntime`: QuickJS VM management, async event loop, fetch, timers,
  Buffer, crypto, compression, and WebSocket polyfills.
- `internal/jsplugin`: manifest validation, package integrity, permissions,
  lifecycle, scheduling, host bridges, HTTP routing, and plugin communication.

Lark replaces SongLoft's Chi, sqlc, database, authentication, and music service
dependencies with adapters for Echo, Ent, and Lark's library service. Files
derived from SongLoft retain the Apache-2.0 attribution recorded in the root
`NOTICE.md`.
