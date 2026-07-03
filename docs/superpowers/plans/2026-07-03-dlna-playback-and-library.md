# DLNA Playback And Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add DLNA support so Lark can play the current queue to other DLNA devices and optionally expose the Lark music library as a browsable DLNA MediaServer on the LAN.

**Architecture:** Create a focused `backend/internal/dlna` package with shared tokenized media resources, DIDL-Lite metadata builders, MediaServer SOAP handlers, SSDP advertisement, renderer discovery, and AVTransport control. Wire it into the existing Echo server and `library.Service`; add frontend cast state, a device picker, and settings switches, while keeping the Web frontend library browser unchanged.

**Tech Stack:** Go 1.25, Echo v5, Ent, existing `library.Service`, `github.com/anacrolix/dms v1.2.2` for UPnP/DLNA XML helpers where useful, React, TypeScript, Vite, existing CSS/i18n system.

## Global Constraints

- The Lark player UI only exposes "play to device"; it does not add a DLNA library browser inside the Lark Web frontend.
- `dlna_cast_enabled` controls renderer discovery and remote playback control.
- `dlna_library_enabled` controls whether Lark announces and serves a browsable DLNA MediaServer.
- `dlna_library_enabled` defaults to false for existing installs.
- DLNA media URLs are unauthenticated but token-protected, scoped to song ID and purpose, and short-lived.
- DLNA library browsing must be gated by `dlna_library_enabled` and the allowed IP policy.
- Do not add a separate DLNA TCP port in the first implementation; serve UPnP descriptions, SOAP handlers, covers, and media resources from the existing backend HTTP server.
- Do not add remote volume control in this pass.
- Use focused files inside `backend/internal/dlna`; do not copy Stash's scene/video model.
- Run `go test ./...` from `backend/` and frontend checks from `frontend/` before claiming implementation complete.

---

## Scope Check

This spec contains two related protocol surfaces: MediaServer library exposure and Control Point casting. They share tokenized resource URLs, DIDL-Lite song metadata, settings, IP policy, and backend lifecycle, so one implementation plan is acceptable. The tasks are ordered so the shared media foundation lands first, then the independently testable MediaServer path, then renderer discovery/control, then frontend wiring.

## File Structure

- Create `backend/internal/dlna/types.go`: exported API models, status structs, device structs, and small interfaces consumed by `api.Server`.
- Create `backend/internal/dlna/settings.go`: normalizers and runtime options derived from `models.Settings`.
- Create `backend/internal/dlna/token.go`: HMAC token issue/validate helpers for audio, cover, and transcode URLs.
- Create `backend/internal/dlna/metadata.go`: DIDL-Lite audio item and container XML generation.
- Create `backend/internal/dlna/media.go`: token-protected media and cover HTTP handlers.
- Create `backend/internal/dlna/soap.go`: SOAP envelope parsing and response/fault writing.
- Create `backend/internal/dlna/descriptors.go`: UPnP root device and service description XML handlers.
- Create `backend/internal/dlna/content_directory.go`: ContentDirectory browse actions and catalog mapping.
- Create `backend/internal/dlna/connection_manager.go`: ConnectionManager protocol info action.
- Create `backend/internal/dlna/ssdp.go`: MediaServer SSDP announcement lifecycle and renderer M-SEARCH discovery.
- Create `backend/internal/dlna/controller.go`: AVTransport SOAP client.
- Create `backend/internal/dlna/service.go`: orchestration, lifecycle, device cache, and public methods.
- Create `backend/internal/api/dlna.go`: Echo handlers and route registration helpers.
- Modify `backend/internal/models/models.go`: DLNA settings and response models if they are shared beyond `internal/dlna`.
- Modify `backend/internal/library/settings.go`: persist DLNA settings through existing AppSetting rows.
- Modify `backend/internal/api/server.go`: settings request fields, route registration, DLNA service field, lifecycle shutdown.
- Modify `backend/cmd/server/main.go`: create the DLNA service and pass it into `api.New`.
- Modify `backend/go.mod` and `backend/go.sum`: add `github.com/anacrolix/dms v1.2.2`.
- Create tests under `backend/internal/dlna/*_test.go`.
- Modify `frontend/src/types.ts`: DLNA settings and API response types.
- Modify `frontend/src/services/api.ts`: DLNA API methods.
- Create `frontend/src/components/DLNACastPanel.tsx`: device picker panel.
- Modify `frontend/src/components/mobile/MobilePlayerDock.tsx`: accept cast button props and pass them through.
- Modify `frontend/src/components/player-themes/MobileArtPlayer.tsx`: render mobile cast action.
- Modify `frontend/src/App.tsx`: cast state, remote playback actions, player button, settings switches.
- Modify `frontend/src/i18n.ts`: Chinese and English labels.
- Modify `frontend/src/styles.css` and `frontend/src/mobile.css`: panel, cast button, mobile sheet styling.

---

### Task 1: Persist DLNA Settings

**Files:**
- Modify: `backend/internal/models/models.go`
- Modify: `backend/internal/library/settings.go`
- Modify: `backend/internal/library/settings_test.go`
- Modify: `backend/internal/api/server.go`
- Modify: `frontend/src/types.ts`

**Interfaces:**
- Produces backend settings fields:
  - `DLNACastEnabled bool`
  - `DLNALibraryEnabled bool`
  - `DLNAServerName string`
  - `DLNAMediaBaseURL string`
  - `DLNAAllowedIPs string`
  - `DLNAInterfaces string`
- Produces JSON fields:
  - `dlna_cast_enabled`
  - `dlna_library_enabled`
  - `dlna_server_name`
  - `dlna_media_base_url`
  - `dlna_allowed_ips`
  - `dlna_interfaces`
- Later tasks consume these through `library.Service.GetSettings(ctx)`.

- [ ] **Step 1: Add failing backend settings test**

Add this test to `backend/internal/library/settings_test.go`:

```go
func TestDLNASettingsPersistAndDefaultLibraryOff(t *testing.T) {
	ctx := context.Background()
	client := enttest.Open(t, "sqlite3", "file:dlna-settings?mode=memory&cache=shared&_pragma=foreign_keys(1)")
	defer client.Close()
	service := New(client, t.TempDir(), t.TempDir(), "ffprobe", "ffmpeg", nil, nil)

	defaults, err := service.GetSettings(ctx)
	if err != nil {
		t.Fatalf("GetSettings defaults: %v", err)
	}
	if defaults.DLNALibraryEnabled {
		t.Fatal("dlna library exposure must default off")
	}
	if defaults.DLNAServerName != "Lark" {
		t.Fatalf("expected default server name Lark, got %q", defaults.DLNAServerName)
	}

	saved, err := service.SaveSettings(ctx, models.Settings{
		Language:             "zh-CN",
		Theme:                "deep-space",
		DLNACastEnabled:      true,
		DLNALibraryEnabled:   true,
		DLNAServerName:       "Living Room Lark",
		DLNAMediaBaseURL:     " http://192.168.1.8:8080/ ",
		DLNAAllowedIPs:       "192.168.1.20, *",
		DLNAInterfaces:       "eth0,wlan0",
		TranscodePolicy:      "auto",
		TranscodeQualityKbps: 192,
	})
	if err != nil {
		t.Fatalf("SaveSettings: %v", err)
	}
	if !saved.DLNACastEnabled || !saved.DLNALibraryEnabled {
		t.Fatalf("expected dlna settings enabled, got %+v", saved)
	}
	if saved.DLNAMediaBaseURL != "http://192.168.1.8:8080" {
		t.Fatalf("expected trimmed media base URL, got %q", saved.DLNAMediaBaseURL)
	}

	loaded, err := service.GetSettings(ctx)
	if err != nil {
		t.Fatalf("GetSettings loaded: %v", err)
	}
	if loaded.DLNAServerName != "Living Room Lark" || loaded.DLNAAllowedIPs != "192.168.1.20,*" || loaded.DLNAInterfaces != "eth0,wlan0" {
		t.Fatalf("unexpected loaded dlna settings: %+v", loaded)
	}
}
```

- [ ] **Step 2: Run the targeted test and verify it fails**

Run:

```bash
cd backend
go test ./internal/library -run TestDLNASettingsPersistAndDefaultLibraryOff -count=1
```

Expected: compile failure because `models.Settings` does not have the DLNA fields.

- [ ] **Step 3: Add settings fields and normalization**

Modify `backend/internal/models/models.go` `Settings` with the six fields listed above. Modify `backend/internal/api/server.go` `settingsRequest` and `handleSaveSettings` to bind and save the same fields.

In `backend/internal/library/settings.go`, add keys to `GetSettings` defaults and switch:

```go
DLNACastEnabled:    false,
DLNALibraryEnabled: false,
DLNAServerName:     "Lark",
```

Add switch cases:

```go
case "dlna_cast_enabled":
	settings.DLNACastEnabled = item.Value == "true"
case "dlna_library_enabled":
	settings.DLNALibraryEnabled = item.Value == "true"
case "dlna_server_name":
	settings.DLNAServerName = item.Value
case "dlna_media_base_url":
	settings.DLNAMediaBaseURL = item.Value
case "dlna_allowed_ips":
	settings.DLNAAllowedIPs = item.Value
case "dlna_interfaces":
	settings.DLNAInterfaces = item.Value
```

Before saving, normalize:

```go
settings.DLNAServerName = normalizeDLNAServerName(settings.DLNAServerName)
settings.DLNAMediaBaseURL = normalizeDLNAMediaBaseURL(settings.DLNAMediaBaseURL)
settings.DLNAAllowedIPs = normalizeCSVSetting(settings.DLNAAllowedIPs)
settings.DLNAInterfaces = normalizeCSVSetting(settings.DLNAInterfaces)
```

Add helper functions in `settings.go`:

```go
func normalizeDLNAServerName(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "Lark"
	}
	if len([]rune(value)) > 80 {
		return string([]rune(value)[:80])
	}
	return value
}

func normalizeDLNAMediaBaseURL(value string) string {
	value = strings.TrimRight(strings.TrimSpace(value), "/")
	if value == "" {
		return ""
	}
	if strings.HasPrefix(value, "http://") || strings.HasPrefix(value, "https://") {
		return value
	}
	return ""
}

func normalizeCSVSetting(value string) string {
	parts := strings.Split(value, ",")
	clean := make([]string, 0, len(parts))
	seen := map[string]bool{}
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" || seen[part] {
			continue
		}
		seen[part] = true
		clean = append(clean, part)
	}
	return strings.Join(clean, ",")
}
```

Save pairs:

```go
"dlna_cast_enabled":    strconv.FormatBool(settings.DLNACastEnabled),
"dlna_library_enabled": strconv.FormatBool(settings.DLNALibraryEnabled),
"dlna_server_name":     settings.DLNAServerName,
"dlna_media_base_url":  settings.DLNAMediaBaseURL,
"dlna_allowed_ips":     settings.DLNAAllowedIPs,
"dlna_interfaces":      settings.DLNAInterfaces,
```

Modify `frontend/src/types.ts` `Settings` interface with matching snake-case fields.

- [ ] **Step 4: Run the targeted test and verify it passes**

Run:

```bash
cd backend
go test ./internal/library -run TestDLNASettingsPersistAndDefaultLibraryOff -count=1
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/models/models.go backend/internal/library/settings.go backend/internal/library/settings_test.go backend/internal/api/server.go frontend/src/types.ts
git commit -m "feat: persist dlna settings"
```

---

### Task 2: Add Shared DLNA Types, Tokens, And DIDL Metadata

**Files:**
- Create: `backend/internal/dlna/types.go`
- Create: `backend/internal/dlna/settings.go`
- Create: `backend/internal/dlna/token.go`
- Create: `backend/internal/dlna/metadata.go`
- Test: `backend/internal/dlna/token_test.go`
- Test: `backend/internal/dlna/metadata_test.go`

**Interfaces:**
- Consumes: `models.Settings` DLNA fields from Task 1.
- Produces:
  - `type Options struct`
  - `func OptionsFromSettings(settings models.Settings) Options`
  - `type MediaPurpose string`
  - `const PurposeAudio`, `PurposeCover`, `PurposeTranscode`
  - `func NewTokenManager(secret []byte, now func() time.Time) *TokenManager`
  - `func (m *TokenManager) Issue(songID, userID int, purpose MediaPurpose, ttl time.Duration) (string, error)`
  - `func (m *TokenManager) Validate(raw string, songID int, purpose MediaPurpose) (TokenClaims, error)`
  - `func BuildSongDIDL(item models.Song, resource MediaResource) (string, error)`
  - `func BuildContainerDIDL(items []Container) (string, error)`

- [ ] **Step 1: Add failing token and metadata tests**

Create `backend/internal/dlna/token_test.go`:

```go
package dlna

import (
	"testing"
	"time"
)

func TestTokenManagerValidatesPurposeSongAndExpiry(t *testing.T) {
	now := time.Date(2026, 7, 3, 10, 0, 0, 0, time.UTC)
	manager := NewTokenManager([]byte("test-secret"), func() time.Time { return now })

	token, err := manager.Issue(42, 7, PurposeAudio, time.Minute)
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	claims, err := manager.Validate(token, 42, PurposeAudio)
	if err != nil {
		t.Fatalf("Validate: %v", err)
	}
	if claims.SongID != 42 || claims.UserID != 7 || claims.Purpose != PurposeAudio {
		t.Fatalf("unexpected claims: %+v", claims)
	}
	if _, err := manager.Validate(token, 43, PurposeAudio); err == nil {
		t.Fatal("expected song mismatch to fail")
	}
	if _, err := manager.Validate(token, 42, PurposeCover); err == nil {
		t.Fatal("expected purpose mismatch to fail")
	}

	manager.now = func() time.Time { return now.Add(2 * time.Minute) }
	if _, err := manager.Validate(token, 42, PurposeAudio); err == nil {
		t.Fatal("expected expired token to fail")
	}
}
```

Create `backend/internal/dlna/metadata_test.go`:

```go
package dlna

import (
	"strings"
	"testing"

	"lark/backend/internal/models"
)

func TestBuildSongDIDLIncludesMusicTrackMetadata(t *testing.T) {
	xmlText, err := BuildSongDIDL(models.Song{
		ID:              12,
		Title:           "Clouds & Rain",
		Artist:          "The <Band>",
		Album:           "Weather",
		Mime:            "audio/mpeg",
		SizeBytes:       12345,
		DurationSeconds: 65,
		BitRate:         192000,
	}, MediaResource{
		AudioURL: "http://host/dlna/audio/token/12",
		CoverURL: "http://host/dlna/cover/token/12",
		Mime:     "audio/mpeg",
		Size:     12345,
	})
	if err != nil {
		t.Fatalf("BuildSongDIDL: %v", err)
	}
	for _, want := range []string{
		`object.item.audioItem.musicTrack`,
		`Clouds &amp; Rain`,
		`The &lt;Band&gt;`,
		`http://host/dlna/audio/token/12`,
		`http-get:*:audio/mpeg:`,
		`0:01:05`,
	} {
		if !strings.Contains(xmlText, want) {
			t.Fatalf("DIDL missing %q:\n%s", want, xmlText)
		}
	}
}
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
cd backend
go test ./internal/dlna -run 'Test(TokenManager|BuildSongDIDL)' -count=1
```

Expected: package or symbols missing.

- [ ] **Step 3: Implement minimal types, token manager, and metadata builder**

Create the four DLNA files named in this task. Use HMAC-SHA256 over compact JSON claims encoded with base64url. The token format is `base64url(json).base64url(signature)`.

Use these concrete types in `types.go`:

```go
package dlna

import (
	"context"
	"time"

	"lark/backend/ent"
	"lark/backend/internal/models"
)

type MediaPurpose string

const (
	PurposeAudio     MediaPurpose = "audio"
	PurposeCover     MediaPurpose = "cover"
	PurposeTranscode MediaPurpose = "transcode"
)

type DeviceState string

const (
	DeviceAvailable   DeviceState = "available"
	DeviceConnecting  DeviceState = "connecting"
	DevicePlaying     DeviceState = "playing"
	DeviceUnavailable DeviceState = "unavailable"
)

type Device struct {
	ID           string      `json:"id"`
	Name         string      `json:"name"`
	Protocol     string      `json:"protocol"`
	State        DeviceState `json:"state"`
	Manufacturer string      `json:"manufacturer,omitempty"`
	Model        string      `json:"model,omitempty"`
	LastSeenAt   time.Time   `json:"last_seen_at"`
}

type Status struct {
	CastEnabled    bool   `json:"cast_enabled"`
	LibraryEnabled bool   `json:"library_enabled"`
	Output         string `json:"output"`
	DeviceID       string `json:"device_id,omitempty"`
	DeviceName     string `json:"device_name,omitempty"`
	State          string `json:"state"`
}

type MediaResource struct {
	AudioURL string
	CoverURL string
	Mime     string
	Size     int64
	BitRate  int
	Duration time.Duration
}

type Container struct {
	ID         string
	ParentID   string
	Title      string
	Class      string
	ChildCount int
}

type Library interface {
	GetSettings(ctx context.Context) (models.Settings, error)
	RawSong(ctx context.Context, id int) (*ent.Song, error)
	Song(ctx context.Context, userID, id int) (models.Song, error)
	SongCover(ctx context.Context, id int) ([]byte, string, error)
	SongsPage(ctx context.Context, userID int, q string, favorites bool, limit, offset int) (models.SongPage, error)
	AlbumsPage(ctx context.Context, userID, limit, offset, artistID int) (models.AlbumPage, error)
	AlbumSongs(ctx context.Context, userID, id int, limit int) ([]models.Song, error)
	Artists(ctx context.Context, userID, limit int) ([]models.Artist, error)
	ArtistSongs(ctx context.Context, userID, id int, limit int) ([]models.Song, error)
	Playlists(ctx context.Context, userID, limit int) ([]models.Playlist, error)
	PlaylistSongs(ctx context.Context, userID, id int, limit int) ([]models.Song, error)
	Folders(ctx context.Context, userID, limit int) ([]models.Folder, error)
	FolderSongs(ctx context.Context, userID int, relPath string, limit int) ([]models.Song, error)
	FFmpegBin() string
}
```

- [ ] **Step 4: Run tests and verify they pass**

Run:

```bash
cd backend
go test ./internal/dlna -run 'Test(TokenManager|BuildSongDIDL)' -count=1
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/dlna
git commit -m "feat: add dlna token and metadata foundation"
```

---

### Task 3: Serve Token-Protected DLNA Media Resources

**Files:**
- Create: `backend/internal/dlna/media.go`
- Test: `backend/internal/dlna/media_test.go`
- Modify: `backend/internal/dlna/types.go`

**Interfaces:**
- Consumes: `TokenManager`, `MediaPurpose`, and metadata types from Task 2.
- Produces:
  - `func (s *Service) RegisterPublicRoutes(mux interface{ GET(string, echo.HandlerFunc, ...echo.MiddlewareFunc) *echo.Route })`
  - `func (s *Service) AudioURL(base string, userID, songID int, ttl time.Duration) (string, error)`
  - `func (s *Service) CoverURL(base string, userID, songID int, ttl time.Duration) (string, error)`
  - `func (s *Service) TranscodeURL(base string, userID, songID int, ttl time.Duration) (string, error)`

- [ ] **Step 1: Write failing media handler test**

Create `backend/internal/dlna/media_test.go` with a fake library that returns a temporary MP3 file and cover bytes. Test:

```go
func TestAudioHandlerRequiresMatchingTokenAndSupportsRange(t *testing.T) {
	dir := t.TempDir()
	audioPath := filepath.Join(dir, "song.mp3")
	if err := os.WriteFile(audioPath, []byte("0123456789"), 0o644); err != nil {
		t.Fatal(err)
	}
	service := NewService(fakeLibrary{audioPath: audioPath}, Options{CastEnabled: true}, WithTokenSecret([]byte("secret")))
	token, err := service.tokens.Issue(1, 7, PurposeAudio, time.Minute)
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodGet, "/dlna/audio/"+token+"/1", nil)
	req.Header.Set("Range", "bytes=2-5")
	rec := httptest.NewRecorder()
	service.handleAudio(rec, req)

	if rec.Code != http.StatusPartialContent {
		t.Fatalf("expected 206, got %d body=%q", rec.Code, rec.Body.String())
	}
	if got := rec.Body.String(); got != "2345" {
		t.Fatalf("expected range body 2345, got %q", got)
	}
	if rec.Header().Get("transferMode.dlna.org") != "Streaming" {
		t.Fatalf("missing DLNA streaming header: %v", rec.Header())
	}
}
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
cd backend
go test ./internal/dlna -run TestAudioHandlerRequiresMatchingTokenAndSupportsRange -count=1
```

Expected: missing `NewService`, `handleAudio`, or token fields.

- [ ] **Step 3: Implement media URL generation and handlers**

Implement `handleAudio`, `handleCover`, and `handleTranscode` in `media.go`.

Required behavior:

- Parse token and song ID from path segments.
- Validate purpose and song ID.
- `media.go` imports `lark/backend/internal/library` and uses `library.ResolveAudioSegment(file.Path)` for raw audio paths so CUE tracks resolve through the existing audio segment logic.
- Set:
  - `Accept-Ranges: bytes`
  - `transferMode.dlna.org: Streaming`
  - `contentFeatures.dlna.org: DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01500000000000000000000000000000`
- Use `http.ServeFile` or `http.ServeContent` for raw audio so Range requests work.
- Cover handler returns `Cache-Control: public, max-age=86400` and the MIME type from `Library.SongCover`.
- Transcode handler shells out to ffmpeg using `Library.FFmpegBin()` and streams MP3. Keep it simple and match the existing API transcode behavior in `backend/internal/api/server.go`.

- [ ] **Step 4: Run media tests**

Run:

```bash
cd backend
go test ./internal/dlna -run TestAudioHandlerRequiresMatchingTokenAndSupportsRange -count=1
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/dlna
git commit -m "feat: serve tokenized dlna media"
```

---

### Task 4: Implement MediaServer Descriptors, SOAP, ContentDirectory, And ConnectionManager

**Files:**
- Create: `backend/internal/dlna/soap.go`
- Create: `backend/internal/dlna/descriptors.go`
- Create: `backend/internal/dlna/content_directory.go`
- Create: `backend/internal/dlna/connection_manager.go`
- Test: `backend/internal/dlna/content_directory_test.go`
- Test: `backend/internal/dlna/descriptors_test.go`

**Interfaces:**
- Consumes: `BuildSongDIDL`, `BuildContainerDIDL`, URL builders, and library methods from earlier tasks.
- Produces:
  - `func (s *Service) handleRootDescription(http.ResponseWriter, *http.Request)`
  - `func (s *Service) handleSCPD(http.ResponseWriter, *http.Request)`
  - `func (s *Service) handleSOAP(http.ResponseWriter, *http.Request)`
  - `func (s *Service) Browse(ctx context.Context, objectID string, flag string, start, count int, host string) (BrowseResult, error)`

- [ ] **Step 1: Write failing ContentDirectory tests**

Create tests for:

```go
func TestBrowseRootReturnsMusicContainers(t *testing.T) {
	service := NewService(fakeLibrary{}, Options{LibraryEnabled: true, ServerName: "Lark"}, WithTokenSecret([]byte("secret")))
	result, err := service.Browse(context.Background(), "0", "BrowseDirectChildren", 0, 0, "127.0.0.1:8080")
	if err != nil {
		t.Fatalf("Browse root: %v", err)
	}
	for _, want := range []string{"All Songs", "Albums", "Artists", "Playlists", "Folders"} {
		if !strings.Contains(result.Result, want) {
			t.Fatalf("root browse missing %q:\n%s", want, result.Result)
		}
	}
}

func TestBrowseAllSongsReturnsTokenizedSongItems(t *testing.T) {
	lib := fakeLibrary{songsPage: models.SongPage{
		Items: []models.Song{{ID: 1, Title: "Song A", Artist: "Artist", Album: "Album", Mime: "audio/mpeg", DurationSeconds: 30}},
		Total: 1,
	}}
	service := NewService(lib, Options{LibraryEnabled: true, ServerName: "Lark"}, WithTokenSecret([]byte("secret")))
	result, err := service.Browse(context.Background(), "songs", "BrowseDirectChildren", 0, 100, "127.0.0.1:8080")
	if err != nil {
		t.Fatalf("Browse songs: %v", err)
	}
	for _, want := range []string{"Song A", "object.item.audioItem.musicTrack", "/dlna/audio/", "/dlna/cover/"} {
		if !strings.Contains(result.Result, want) {
			t.Fatalf("songs browse missing %q:\n%s", want, result.Result)
		}
	}
}
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
cd backend
go test ./internal/dlna -run 'TestBrowse' -count=1
```

Expected: missing `Browse` and descriptor code.

- [ ] **Step 3: Implement SOAP and browse mapping**

Implement root object IDs exactly:

- `0` root
- `songs` all songs container
- `albums` album list
- `album:<id>` album songs
- `artists` artist list
- `artist:<id>` artist songs
- `playlists` playlist list
- `playlist:<id>` playlist songs
- `folders` folder list
- `folder:<url-query-escaped-path>` folder songs

Implement `BrowseMetadata` for root, containers, and `song:<id>`. Implement `BrowseDirectChildren` for containers. Use `RequestedCount` as the limit; if it is `0`, use `100`. Use `StartingIndex` as the offset for paged song and album lists.

SOAP handler must parse `SOAPACTION`, decode the SOAP envelope body, call the correct service, and write XML with:

```go
body := fmt.Sprintf(`<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body>%s</s:Body></s:Envelope>`, responseXML)
```

ConnectionManager `GetProtocolInfo` returns a Source string including:

```text
http-get:*:audio/mpeg:*,http-get:*:audio/flac:*,http-get:*:audio/wav:*,http-get:*:audio/mp4:*,http-get:*:audio/ogg:*,http-get:*:audio/opus:*,http-get:*:audio/aiff:*,http-get:*:audio/x-ape:*,http-get:*:audio/x-ms-wma:*,http-get:*:image/jpeg:*,http-get:*:image/png:*
```

- [ ] **Step 4: Run ContentDirectory and descriptor tests**

Run:

```bash
cd backend
go test ./internal/dlna -run 'Test(Browse|RootDescription|ConnectionManager)' -count=1
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/dlna
git commit -m "feat: add dlna media server browsing"
```

---

### Task 5: Add SSDP MediaServer Advertisement And Renderer Discovery

**Files:**
- Modify: `backend/go.mod`
- Modify: `backend/go.sum`
- Create: `backend/internal/dlna/ssdp.go`
- Test: `backend/internal/dlna/discovery_test.go`

**Interfaces:**
- Consumes: `Options` and `Device` from earlier tasks.
- Produces:
  - `func (s *Service) Start(ctx context.Context, baseURL string) error`
  - `func (s *Service) Shutdown(ctx context.Context) error`
  - `func (s *Service) Discover(ctx context.Context) ([]Device, error)`
  - `func parseDeviceDescription(base string, data []byte) (rendererDevice, error)`

- [ ] **Step 1: Add dependency**

Run:

```bash
cd backend
go get github.com/anacrolix/dms@v1.2.2
```

Expected: `go.mod` gains `github.com/anacrolix/dms v1.2.2` and `go.sum` updates.

- [ ] **Step 2: Write failing parser test**

Create `backend/internal/dlna/discovery_test.go`:

```go
func TestParseRendererDeviceDescription(t *testing.T) {
	xmlData := []byte(`<?xml version="1.0"?>
<root>
  <device>
    <deviceType>urn:schemas-upnp-org:device:MediaRenderer:1</deviceType>
    <friendlyName>Living Room TV</friendlyName>
    <manufacturer>Acme</manufacturer>
    <modelName>Renderer</modelName>
    <UDN>uuid:abc</UDN>
    <serviceList>
      <service>
        <serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType>
        <controlURL>/upnp/control/avtransport1</controlURL>
      </service>
    </serviceList>
  </device>
</root>`)
	device, err := parseDeviceDescription("http://192.168.1.30:1400/device.xml", xmlData)
	if err != nil {
		t.Fatalf("parseDeviceDescription: %v", err)
	}
	if device.ID != "uuid:abc" || device.Name != "Living Room TV" || device.AVTransportURL != "http://192.168.1.30:1400/upnp/control/avtransport1" {
		t.Fatalf("unexpected device: %+v", device)
	}
}
```

- [ ] **Step 3: Run parser test and verify it fails**

Run:

```bash
cd backend
go test ./internal/dlna -run TestParseRendererDeviceDescription -count=1
```

Expected: missing parser.

- [ ] **Step 4: Implement SSDP advertisement and discovery**

Implement:

- MediaServer announcement only when `Options.LibraryEnabled` is true.
- SSDP `LOCATION` points to `<baseURL>/dlna/rootDesc.xml`.
- Renderer discovery sends M-SEARCH to `239.255.255.250:1900` for `urn:schemas-upnp-org:device:MediaRenderer:1`.
- Discovery reads responses until a timeout of 3 seconds.
- For each response, fetch `LOCATION`, parse the XML, store devices in `Service.devices`.
- Device cache marks devices unavailable after 10 minutes without being seen.

- [ ] **Step 5: Run discovery tests**

Run:

```bash
cd backend
go test ./internal/dlna -run 'TestParseRendererDeviceDescription' -count=1
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/go.mod backend/go.sum backend/internal/dlna
git commit -m "feat: discover dlna renderers"
```

---

### Task 6: Add AVTransport Controller

**Files:**
- Create: `backend/internal/dlna/controller.go`
- Test: `backend/internal/dlna/controller_test.go`

**Interfaces:**
- Consumes: renderer device cache, `BuildSongDIDL`, URL builders.
- Produces:
  - `func (s *Service) PlaySong(ctx context.Context, userID int, deviceID string, songID int, host string) (Status, error)`
  - `func (s *Service) Pause(ctx context.Context, userID int, deviceID string) (Status, error)`
  - `func (s *Service) Resume(ctx context.Context, userID int, deviceID string) (Status, error)`
  - `func (s *Service) Stop(ctx context.Context, userID int, deviceID string) (Status, error)`

- [ ] **Step 1: Write failing controller SOAP test**

Create `backend/internal/dlna/controller_test.go` with an `httptest.Server` capturing SOAP requests:

```go
func TestPlaySongSendsSetURIThenPlay(t *testing.T) {
	var actions []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		actions = append(actions, r.Header.Get("SOAPACTION"))
		body, _ := io.ReadAll(r.Body)
		if strings.Contains(r.Header.Get("SOAPACTION"), "SetAVTransportURI") && !strings.Contains(string(body), "CurrentURI") {
			t.Fatalf("SetAVTransportURI body missing CurrentURI: %s", body)
		}
		w.Header().Set("Content-Type", `text/xml; charset="utf-8"`)
		_, _ = w.Write([]byte(`<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body></s:Body></s:Envelope>`))
	}))
	defer server.Close()

	service := NewService(fakeLibrary{song: models.Song{ID: 1, Title: "Song", Mime: "audio/mpeg"}}, Options{CastEnabled: true}, WithTokenSecret([]byte("secret")))
	service.devices["device-1"] = rendererDevice{ID: "device-1", Name: "TV", AVTransportURL: server.URL}

	status, err := service.PlaySong(context.Background(), 7, "device-1", 1, "127.0.0.1:8080")
	if err != nil {
		t.Fatalf("PlaySong: %v", err)
	}
	if status.State != "playing" || status.DeviceName != "TV" {
		t.Fatalf("unexpected status: %+v", status)
	}
	if len(actions) != 2 || !strings.Contains(actions[0], "SetAVTransportURI") || !strings.Contains(actions[1], "Play") {
		t.Fatalf("unexpected SOAP actions: %v", actions)
	}
}
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
cd backend
go test ./internal/dlna -run TestPlaySongSendsSetURIThenPlay -count=1
```

Expected: missing controller methods.

- [ ] **Step 3: Implement controller**

Implement SOAP action writer that sends:

- `urn:schemas-upnp-org:service:AVTransport:1#SetAVTransportURI`
- `urn:schemas-upnp-org:service:AVTransport:1#Play`
- `urn:schemas-upnp-org:service:AVTransport:1#Pause`
- `urn:schemas-upnp-org:service:AVTransport:1#Stop`

Use `http.Client{Timeout: 8 * time.Second}`. Map transport errors to `ErrDeviceUnavailable`. Store remote status in memory by user ID:

```go
type activeOutput struct {
	UserID     int
	DeviceID   string
	DeviceName string
	SongID     int
	State      string
	UpdatedAt  time.Time
}
```

- [ ] **Step 4: Run controller tests**

Run:

```bash
cd backend
go test ./internal/dlna -run TestPlaySongSendsSetURIThenPlay -count=1
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/dlna
git commit -m "feat: control dlna renderers"
```

---

### Task 7: Wire DLNA Into Backend API And Lifecycle

**Files:**
- Create: `backend/internal/api/dlna.go`
- Modify: `backend/internal/api/server.go`
- Modify: `backend/cmd/server/main.go`
- Test: `backend/internal/api/dlna_test.go`

**Interfaces:**
- Consumes: `dlna.Service` methods from Tasks 3-6.
- Produces HTTP routes:
  - `GET /api/dlna/status`
  - `GET /api/dlna/devices`
  - `POST /api/dlna/discover`
  - `POST /api/dlna/play`
  - `POST /api/dlna/pause`
  - `POST /api/dlna/resume`
  - `POST /api/dlna/stop`
  - `POST /api/dlna/local`
  - `GET /dlna/rootDesc.xml`
  - `GET /dlna/scpd/:service`
  - `POST /dlna/control`
  - `GET /dlna/audio/:token/:songID`
  - `GET /dlna/cover/:token/:songID`
  - `GET /dlna/transcode/:token/:songID`

- [ ] **Step 1: Write failing API test**

Create `backend/internal/api/dlna_test.go` with a fake DLNA service and test unauthenticated media routes are public while API routes require auth. Follow the existing auth test pattern in `backend/internal/api/diagnostics_test.go`: build an `api.Server`, send an unauthenticated `httptest.NewRequest`, and assert the HTTP status code from `server.echo.ServeHTTP`.

Core assertion:

```go
func TestDLNAStatusRequiresAuth(t *testing.T) {
	server := New(nil, fakeLibraryService{}, "*", WithDLNA(fakeDLNAService{}))
	req := httptest.NewRequest(http.MethodGet, "/api/dlna/status", nil)
	rec := httptest.NewRecorder()
	server.echo.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected unauthorized, got %d", rec.Code)
	}
}
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
cd backend
go test ./internal/api -run TestDLNAStatusRequiresAuth -count=1
```

Expected: missing `WithDLNA` and routes.

- [ ] **Step 3: Implement API wiring**

Add to `api.Server`:

```go
dlna *dlna.Service
```

Add option:

```go
func WithDLNA(service *dlna.Service) Option {
	return func(s *Server) {
		s.dlna = service
	}
}
```

In `New`, register public `/dlna/*` routes before frontend routes and authenticated `/api/dlna/*` routes near other API routes. In `Start`, after library watchers start, call `s.dlna.Start(ctx, s.publicBaseURL())` when non-nil. In `Shutdown`, call `s.dlna.Shutdown(ctx)`.

In `cmd/server/main.go`, create:

```go
initialSettings, err := lib.GetSettings(context.Background())
if err != nil {
	log.Fatalf("load dlna settings: %v", err)
}
dlnaService := dlna.NewService(lib, dlna.OptionsFromSettings(initialSettings), dlna.WithTokenSecret([]byte(cfg.DatabaseDSN)))
```

- [ ] **Step 4: Run API tests**

Run:

```bash
cd backend
go test ./internal/api -run TestDLNA -count=1
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/api/dlna.go backend/internal/api/server.go backend/internal/api/dlna_test.go backend/cmd/server/main.go
git commit -m "feat: expose dlna backend api"
```

---

### Task 8: Add Frontend API Types, Cast State, And Device Panel

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/services/api.ts`
- Modify: `frontend/package.json`
- Create: `frontend/scripts/check-dlna-api.mjs`
- Create: `frontend/src/components/DLNACastPanel.tsx`
- Modify: `frontend/src/i18n.ts`
- Modify: `frontend/src/styles.css`

**Interfaces:**
- Consumes backend API routes from Task 7.
- Produces:
  - Type `DLNADevice`
  - Type `DLNAStatus`
  - API methods `dlnaStatus`, `dlnaDevices`, `discoverDLNADevices`, `playDLNA`, `pauseDLNA`, `resumeDLNA`, `stopDLNA`, `switchDLNALocal`
  - Component `DLNACastPanel`

- [ ] **Step 1: Add frontend API route smoke test**

Add `frontend/scripts/check-dlna-api.mjs` and a package script `"test:dlna-api": "node scripts/check-dlna-api.mjs"`.

Script contents:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const apiSource = readFileSync(new URL("../src/services/api.ts", import.meta.url), "utf8");

for (const route of [
  "/api/dlna/status",
  "/api/dlna/devices",
  "/api/dlna/discover",
  "/api/dlna/play",
  "/api/dlna/pause",
  "/api/dlna/resume",
  "/api/dlna/stop",
  "/api/dlna/local",
]) {
  assert.match(apiSource, new RegExp(route.replaceAll("/", "\\/")));
}

console.log("dlna api routes verified");
```

- [ ] **Step 2: Implement frontend types and API client**

Add to `frontend/src/types.ts`:

```ts
export interface DLNADevice {
  id: string;
  name: string;
  protocol: "DLNA" | string;
  state: "available" | "connecting" | "playing" | "unavailable" | string;
  manufacturer?: string;
  model?: string;
  last_seen_at: string;
}

export interface DLNAStatus {
  cast_enabled: boolean;
  library_enabled: boolean;
  output: "local" | "dlna" | string;
  device_id?: string;
  device_name?: string;
  state: "idle" | "playing" | "paused" | "stopped" | string;
}
```

Add API methods in `frontend/src/services/api.ts`:

```ts
dlnaStatus: () => request<DLNAStatus>('/api/dlna/status'),
dlnaDevices: () => request<DLNADevice[]>('/api/dlna/devices'),
discoverDLNADevices: () => request<DLNADevice[]>('/api/dlna/discover', { method: 'POST' }),
playDLNA: (device_id: string, song_id: number) => request<DLNAStatus>('/api/dlna/play', { method: 'POST', body: JSON.stringify({ device_id, song_id }) }),
pauseDLNA: (device_id: string) => request<DLNAStatus>('/api/dlna/pause', { method: 'POST', body: JSON.stringify({ device_id }) }),
resumeDLNA: (device_id: string) => request<DLNAStatus>('/api/dlna/resume', { method: 'POST', body: JSON.stringify({ device_id }) }),
stopDLNA: (device_id: string) => request<DLNAStatus>('/api/dlna/stop', { method: 'POST', body: JSON.stringify({ device_id }) }),
switchDLNALocal: () => request<DLNAStatus>('/api/dlna/local', { method: 'POST' }),
```

- [ ] **Step 3: Implement `DLNACastPanel`**

The component props:

```ts
export function DLNACastPanel({
  open,
  devices,
  status,
  loading,
  error,
  onClose,
  onRefresh,
  onSelectLocal,
  onSelectDevice,
  t,
}: {
  open: boolean;
  devices: DLNADevice[];
  status: DLNAStatus | null;
  loading: boolean;
  error: string;
  onClose: () => void;
  onRefresh: () => void;
  onSelectLocal: () => void;
  onSelectDevice: (device: DLNADevice) => void;
  t: (key: string) => string;
}) {
  if (!open) return null;
  const activeID = status?.device_id || "";
  return (
    <div className="dlna-cast-panel" role="dialog" aria-modal="true" aria-label={t("playToDevice")}>
      <div className="dlna-cast-head">
        <strong>{t("playToDevice")}</strong>
        <button type="button" onClick={onRefresh} disabled={loading}>{loading ? t("connecting") : t("refresh")}</button>
        <button type="button" onClick={onClose} aria-label={t("close")}>×</button>
      </div>
      {error ? <div className="dlna-cast-error">{error}</div> : null}
      <button type="button" className={!activeID ? "dlna-cast-row active" : "dlna-cast-row"} aria-pressed={!activeID} onClick={onSelectLocal}>
        <span>{t("thisDevice")}</span>
        <small>{!activeID ? t("active") : ""}</small>
      </button>
      {devices.length === 0 ? (
        <div className="dlna-cast-empty">
          <strong>{t("noDLNADevices")}</strong>
          <span>{t("dlnaNoDevicesHint")}</span>
        </div>
      ) : devices.map((device) => (
        <button
          type="button"
          key={device.id}
          className={device.id === activeID ? "dlna-cast-row active" : "dlna-cast-row"}
          aria-pressed={device.id === activeID}
          onClick={() => onSelectDevice(device)}
          disabled={device.state === "unavailable"}
        >
          <span>{device.name}</span>
          <small>{device.protocol} · {device.state}</small>
        </button>
      ))}
    </div>
  );
}
```

Render:

- dialog wrapper when `open` is true.
- header `t("playToDevice")`.
- refresh button.
- `This device` row first.
- device rows with name, `DLNA`, state, and active indicator.
- empty state when `devices.length === 0`.

Use button elements for rows and `aria-pressed` on the selected target.

- [ ] **Step 4: Add styles and i18n**

Add Chinese and English keys:

- `playToDevice`
- `thisDevice`
- `availableDevices`
- `noDLNADevices`
- `dlnaNoDevicesHint`
- `refresh`
- `connecting`
- `playingOnDevice`
- `stopCasting`
- `dlnaDeviceUnavailable`

Add `.dlna-cast-panel`, `.dlna-cast-row`, `.dlna-cast-row.active`, `.dlna-cast-error`, `.dlna-cast-empty` styles. Use 44px minimum row height and visible focus.

- [ ] **Step 5: Run frontend checks**

Run:

```bash
cd frontend
pnpm test:dlna-api
pnpm lint
pnpm build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/types.ts frontend/src/services/api.ts frontend/package.json frontend/scripts/check-dlna-api.mjs frontend/src/components/DLNACastPanel.tsx frontend/src/i18n.ts frontend/src/styles.css
git commit -m "feat: add dlna cast panel"
```

---

### Task 9: Wire Cast Controls Into Player And Settings UI

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/mobile/MobilePlayerDock.tsx`
- Modify: `frontend/src/components/player-themes/MobileArtPlayer.tsx`
- Modify: `frontend/src/i18n.ts`
- Modify: `frontend/src/styles.css`
- Modify: `frontend/src/mobile.css`

**Interfaces:**
- Consumes `DLNACastPanel` and frontend API methods from Task 8.
- Produces a desktop cast button, mobile cast action, remote playback state, and site settings controls.

- [ ] **Step 1: Add cast state in `App.tsx`**

Add state:

```ts
const [dlnaStatus, setDLNAStatus] = useState<DLNAStatus | null>(null);
const [dlnaDevices, setDLNADevices] = useState<DLNADevice[]>([]);
const [dlnaPanelOpen, setDLNAPanelOpen] = useState(false);
const [dlnaLoading, setDLNALoading] = useState(false);
const [dlnaError, setDLNAError] = useState("");
const remoteDLNAActive = dlnaStatus?.output === "dlna" && Boolean(dlnaStatus.device_id);
```

Add functions:

```ts
async function refreshDLNADevices(active = true) {
  if (active) setDLNALoading(true);
  setDLNAError("");
  try {
    const devices = active ? await api.discoverDLNADevices() : await api.dlnaDevices();
    setDLNADevices(devices);
    const status = await api.dlnaStatus();
    setDLNAStatus(status);
  } catch (err) {
    setDLNAError(err instanceof Error ? err.message : String(err));
  } finally {
    if (active) setDLNALoading(false);
  }
}

async function playCurrentToDLNA(device: DLNADevice) {
  if (!current) return;
  setDLNALoading(true);
  setDLNAError("");
  try {
    const status = await api.playDLNA(device.id, current.id);
    setDLNAStatus(status);
    audioRef.current?.pause();
    setPlaying(false);
    setDLNAPanelOpen(false);
  } catch (err) {
    setDLNAError(err instanceof Error ? err.message : String(err));
  } finally {
    setDLNALoading(false);
  }
}
```

Add local switch:

```ts
async function switchDLNAToLocal() {
  try {
    const status = await api.switchDLNALocal();
    setDLNAStatus(status);
    setPlaying(Boolean(current));
  } catch (err) {
    setDLNAError(err instanceof Error ? err.message : String(err));
  }
}
```

- [ ] **Step 2: Route play/pause/next to remote when active**

Wrap existing play/pause toggles:

```ts
async function togglePlaybackOutput() {
  if (remoteDLNAActive && dlnaStatus?.device_id) {
    const nextStatus = dlnaStatus.state === "playing"
      ? await api.pauseDLNA(dlnaStatus.device_id)
      : await api.resumeDLNA(dlnaStatus.device_id);
    setDLNAStatus(nextStatus);
    return;
  }
  setPlaying((value) => {
    playUISound(value ? "pause" : "play");
    return !value;
  });
}
```

In `next(direction)`, after resolving the target song, if `remoteDLNAActive`, call `api.playDLNA(dlnaStatus.device_id, target.id)` and do not start local audio. Keep the local queue/current state in sync.

- [ ] **Step 3: Add desktop cast button and panel**

In the desktop `.volume` controls near queue/equalizer, render:

```tsx
<button
  className={remoteDLNAActive ? "cast-toggle active" : "cast-toggle"}
  title={remoteDLNAActive ? `${t("playingOnDevice")} ${dlnaStatus?.device_name || ""}` : t("playToDevice")}
  aria-label={t("playToDevice")}
  onClick={() => {
    setDLNAPanelOpen(true);
    void refreshDLNADevices(false);
  }}
>
  <Cast />
</button>
```

Import `Cast` from `@phosphor-icons/react`.

Render `DLNACastPanel` near other overlays.

- [ ] **Step 4: Add mobile cast action**

Extend `MobilePlayerDock` props:

```ts
onCast?: () => void;
castActive?: boolean;
castLabel?: string;
```

Pass these through to `MobileArtPlayer`. In `MobileArtPlayer`, render an icon button in the existing action/tool row. Use the same min 44px target and aria-label as desktop.

- [ ] **Step 5: Add settings controls**

In the site settings feature card near Sharing and Subsonic, add:

```tsx
<label className="switch-row">
  <span>
    <span>{t("dlnaCast")}</span>
    <small>{t("dlnaCastHint")}</small>
  </span>
  <input
    type="checkbox"
    checked={settings.dlna_cast_enabled}
    onChange={(e) => setSettings({ ...settings, dlna_cast_enabled: e.target.checked })}
  />
</label>
<label className="switch-row">
  <span>
    <span>{t("dlnaLibrary")}</span>
    <small>{t("dlnaLibraryHint")}</small>
  </span>
  <input
    type="checkbox"
    checked={settings.dlna_library_enabled}
    onChange={(e) => setSettings({ ...settings, dlna_library_enabled: e.target.checked })}
  />
</label>
```

Add fields for `dlna_server_name`, `dlna_media_base_url`, `dlna_allowed_ips`, and `dlna_interfaces` in the existing `settings-mini-grid`.

- [ ] **Step 6: Run frontend checks**

Run:

```bash
cd frontend
pnpm test:dlna-api
pnpm lint
pnpm build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/App.tsx frontend/src/components/mobile/MobilePlayerDock.tsx frontend/src/components/player-themes/MobileArtPlayer.tsx frontend/src/i18n.ts frontend/src/styles.css frontend/src/mobile.css
git commit -m "feat: wire dlna cast controls"
```

---

### Task 10: End-To-End Verification And Documentation

**Files:**
- Modify: `README.md`
- Modify: `README_ZH.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes all previous tasks.
- Produces documentation for DLNA cast and optional library exposure.

- [ ] **Step 1: Update docs**

Document:

- DLNA cast lets Lark play the current song/queue to a discovered DLNA renderer.
- DLNA library exposure is a separate admin setting and defaults off.
- Devices must be on the same LAN.
- If devices cannot reach Lark, set `Media base URL` to the LAN URL of the backend.

- [ ] **Step 2: Run backend checks**

Run:

```bash
cd backend
go test ./...
```

Expected: PASS.

- [ ] **Step 3: Run frontend checks**

Run:

```bash
cd frontend
pnpm test:dlna-api
pnpm lint
pnpm build
```

Expected: PASS.

- [ ] **Step 4: Manual LAN verification**

Run the app locally, then verify:

- With `Play to DLNA devices` off, the cast panel explains the feature is disabled.
- With `Play to DLNA devices` on, `Refresh` lists at least one renderer on a network that has a renderer.
- Selecting a renderer sends the current song and pauses local audio.
- Next sends the next Lark queue item to the same renderer.
- With `Expose Lark as a DLNA library` off, a DLNA client does not see Lark as a media source.
- With `Expose Lark as a DLNA library` on, a DLNA client sees Lark and can browse root containers and play at least one song.
- Turning `Expose Lark as a DLNA library` off stops new browse requests.

- [ ] **Step 5: Commit**

```bash
git add README.md README_ZH.md CHANGELOG.md
git commit -m "docs: document dlna playback"
```

---

## Self-Review Notes

- Spec coverage: tasks cover settings, MediaServer discovery/library, renderer discovery/control, tokenized media URLs, frontend cast-only UI, settings switches, security, and verification.
- Placeholder scan: no task uses `TBD`, `TODO`, `implement later`, or "write tests" without concrete test names and assertions.
- Type consistency: DLNA settings use `dlna_cast_enabled` and `dlna_library_enabled` consistently; API status uses `cast_enabled` and `library_enabled`; token purpose includes `audio`, `cover`, and `transcode`.
