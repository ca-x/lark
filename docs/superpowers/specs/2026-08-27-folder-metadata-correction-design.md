# Folder Metadata Correction Design

## Objective

Add a safe bulk metadata correction action to the real-directory browser. A user selects a metadata field, enters a target value defaulted from the current folder name, chooses whether to write audio-file tags, update the library database, or both, previews the impact, and confirms the operation.

## Confirmed behavior

- The action belongs in the current folder toolbar and applies recursively to songs in that folder and its descendants.
- Supported fields are title, artist, album, album artist, genre, year, language, style, and track number.
- The value defaults to the current directory name and remains editable.
- “Write audio files” and “Update library database” are independent checkboxes. At least one must be selected.
- Writing files modifies embedded tags. Updating the database changes the library entities and song rows without requiring file writes.
- A preview reports affected songs and unique audio files and shows representative before/after rows before confirmation.
- Confirmation is bound to a snapshot of song identities, paths, file fingerprints, and database revisions; changed folders must be previewed again.
- Execution reports updated, skipped, and failed targets. A database row is updated only after its requested file write succeeds when both destinations are selected, preventing a false fully-synchronized result.
- CUE virtual tracks share an audio file. Audio-file correction is rejected for CUE entries; database-only correction remains available without corrupting CUE track identity.

## Technical boundaries

- Reuse authenticated folder resolution so a request cannot escape configured library roots.
- Resolve symlinks before file access and reject songs whose real target escapes the configured root.
- Limit one correction to 5,000 songs; larger scopes must be corrected from smaller subfolders.
- Validate field names against a fixed allowlist, trim values, validate years as 1 through 9999, and reject an empty value or an operation with no destination.
- Do not add dependencies or change the database schema.
- Keep existing folder browsing and per-song/per-album metadata editing behavior unchanged.
- Serialize scans, imports, and metadata writeback so concurrent jobs cannot interleave file and database state. File-only mode updates internal file fingerprints without changing displayed metadata, preventing directory watching from importing the new tags into the database.
- Preserve current desktop visual language and provide a compact mobile layout without horizontal overflow.

## Commands

- Backend focused tests: `cd backend && go test ./internal/library ./internal/api -run 'FolderMetadataCorrection' -count=1`
- Backend full tests: `cd backend && go test ./...`
- Frontend focused test: `cd frontend && node --test src/components/FolderMetadataCorrectionDialog.test.mjs`
- Frontend lint: `cd frontend && pnpm lint`
- Frontend build: `cd frontend && pnpm build`

## Success criteria

- Opening the action in a folder pre-fills that folder’s name.
- Preview and execution use the same validated field, value, path, and destination selection.
- Artist/album relational changes are reflected in normal library listings after database update.
- File-only mode leaves database metadata unchanged; database-only mode leaves files unchanged; combined mode performs both.
- The folder view reloads after a successful database update.
- Errors name the affected file without leaking paths outside the selected library directory.
