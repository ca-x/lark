# Folder Metadata Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add previewed, confirmed bulk metadata correction from the real-directory browser with independent audio-file and database destinations.

**Architecture:** Add a focused library service that resolves the authenticated folder, validates a typed correction request, derives unique real-file groups, previews changes, and executes writes. Expose preview and execution endpoints, then add a dedicated React dialog owned by the existing folder browser.

**Tech Stack:** Go 1.27, Echo, Ent, taglib, React 19, TypeScript 6, CSS, Node test runner, Vite.

**Spec:** `docs/superpowers/specs/2026-08-27-folder-metadata-correction-design.md`

## Global Constraints

- No new dependencies or database migrations.
- Folder paths must be resolved through the existing authenticated library-root resolver.
- At least one destination is required.
- Combined mode updates a database row only after the corresponding requested file write succeeds.
- Existing folder and metadata-editor behavior remains compatible.

---

### Task 1: Backend correction service

**Files:**
- Create: `backend/internal/library/folder_metadata_correction.go`
- Create: `backend/internal/library/folder_metadata_correction_test.go`
- Modify: `backend/internal/models/models.go`

**Interfaces:**
- Produces `FolderMetadataField`, `ParseFolderMetadataField`, `FolderMetadataCorrectionInput`, `PreviewFolderMetadataCorrection`, and `CorrectFolderMetadata`.
- Produces preview/result JSON models with song/file counts and representative before/after items.

- [ ] Write a failing service test proving recursive selection, field allowlisting, destination validation, preview stability, database-only artist correction, file-only isolation, and combined-mode failure handling.
- [ ] Run `cd backend && go test ./internal/library -run FolderMetadataCorrection -count=1` and confirm RED.
- [ ] Implement the minimum service and models using existing folder resolution, metadata tag writers, and Ent helpers.
- [ ] Run the focused service test and confirm GREEN.

### Task 2: Authenticated HTTP API

**Files:**
- Modify: `backend/internal/api/server.go`
- Modify: `backend/internal/api/diagnostics_test.go`

**Interfaces:**
- Produces `POST /api/folders/metadata-correction/preview`.
- Produces `POST /api/folders/metadata-correction` with explicit confirmation.

- [ ] Write failing handler tests for authentication, validation, preview, and missing confirmation.
- [ ] Run `cd backend && go test ./internal/api -run FolderMetadataCorrection -count=1` and confirm RED.
- [ ] Register handlers, decode bounded JSON, validate through the service, and map errors without exposing unrestricted filesystem access.
- [ ] Run the focused API test and confirm GREEN.

### Task 3: Folder correction dialog

**Files:**
- Create: `frontend/src/components/FolderMetadataCorrectionDialog.tsx`
- Create: `frontend/src/components/FolderMetadataCorrectionDialog.test.mjs`
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/services/api.ts`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/i18n.ts`

**Interfaces:**
- Consumes the two folder metadata endpoints.
- Produces a dialog with field/value controls, two destination checkboxes, preview rows, final confirmation, and result summary.

- [ ] Write a failing source-contract test for all field choices, both destination controls, preview-before-execute, and localized labels.
- [ ] Run `cd frontend && node --test src/components/FolderMetadataCorrectionDialog.test.mjs` and confirm RED.
- [ ] Implement typed API calls and the dialog, add the toolbar button, and reload the active directory after database changes.
- [ ] Run the focused frontend test and TypeScript build.

### Task 4: Responsive styling and verification

**Files:**
- Modify: `frontend/src/styles.css`
- Modify: `frontend/src/mobile.css`
- Rebuild: `backend/web/dist`

- [ ] Add existing-theme dialog styles, visible focus, disabled/busy states, and a 375px layout with 44px touch targets.
- [ ] Run backend focused and full tests, frontend focused test, lint, and production build.
- [ ] Run the application and verify the folder dialog at desktop and 375px widths; inspect preview, validation, cancel, failure, and success states.
- [ ] Rebuild embedded frontend assets and review `git diff --check` plus the final scoped diff.
