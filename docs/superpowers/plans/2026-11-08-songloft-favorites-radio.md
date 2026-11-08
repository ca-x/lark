# Songloft Favorites And Radio Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Songloft built-in favorites and radio import work without corrupting ordinary Lark playlists.

**Architecture:** Reserve compatibility playlist ID 1 for the authenticated user's favorites. Ordinary playlists use a positive compatibility namespace above 1,000,000,000; the database IDs remain unchanged. HTTP and JS bridges share a playlist adapter; radio songs use the existing remote stream pipeline with explicit radio metadata.

**Tech Stack:** Go, Ent/SQLite, QuickJS, React/TypeScript.

**Spec:** User-approved scope: repair the discovered favorites-ID and radio-import gaps together before releasing v0.18.15.

## Global Constraints

- Never renumber database rows, rewrite opaque plugin storage, merge users' favorites, or reinterpret stale ordinary playlist IDs as another playlist.
- Existing plugins must reload/reselect cached ordinary playlist IDs; reject legacy IDs outside the compatibility namespace.
- Negative playlist IDs remain plugin-local temporary IDs. Keep compatibility IDs within JavaScript's safe integer range.
- Preserve plugin permissions, owner checks, package integrity, and existing MyGo/Songloft runtime separation.
- Release server and Docker only after tests, CI and artifact checks pass.

## Review Focus

- Native playlist 1 already exists; favorite writes must leave its membership untouched.
- Two users share song IDs but must never share favorites or ordinary playlist access.
- Persisted old plugin IDs must fail explicitly instead of silently targeting another playlist.
- SDK playback and queue source IDs must use the same mapping as HTTP/backend bridges.
- Invalid radio URLs and unsupported playlist types must fail without partial success claims.

## Task 1: Playlist Identity And Favorites

- [x] Add failing tests for native ID 1, two-user favorite isolation, ordinary CRUD and stale IDs.
- [x] Implement shared ID helpers and favorites-aware PlaylistHost; route HTTP through the same adapter.
- [x] Translate SDK playlist playback/source identities, including built-in favorites.
- [x] Run focused Go and frontend/browser regressions.

## Task 2: Radio Import

- [x] Capture upstream request/response and add failing radio import/type tests.
- [x] Add persistent playlist type metadata with a backwards-compatible default.
- [x] Implement validated, deduplicated radio import using existing streaming support.
- [x] Verify original radio plugin import through the real HTTP host and playback proxy.

## Task 3: Ship

- [x] Update compatibility docs, cache migration notice and release notes.
- [x] Complete independent review, full/race tests, build/lint and browser regressions.
- Release gate after committing this document: commit/push, verify CI, tag v0.18.15, verify binaries/Docker, publish release.
