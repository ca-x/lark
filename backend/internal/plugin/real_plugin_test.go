package plugin

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"lark/backend/ent"
	"lark/backend/ent/enttest"
	"lark/backend/internal/library"
	"lark/backend/internal/plugin/larkhost"

	_ "github.com/lib-x/entsqlite"
)

// TestRealSongLoftPluginMatrix runs official packages downloaded from the
// SongLoft registry. It is opt-in because the repository does not vendor
// third-party binaries. Set LARK_REAL_PLUGIN_DIR to a directory containing
// one or more *.jsplugin.zip files.
func TestRealSongLoftPluginMatrix(t *testing.T) {
	dir := os.Getenv("LARK_REAL_PLUGIN_DIR")
	if dir == "" {
		t.Skip("set LARK_REAL_PLUGIN_DIR to run the official SongLoft plugin matrix")
	}
	archives, err := filepath.Glob(filepath.Join(dir, "*.jsplugin.zip"))
	if err != nil {
		t.Fatal(err)
	}
	sort.Strings(archives)
	if len(archives) == 0 {
		t.Fatalf("no *.jsplugin.zip files found in %s", dir)
	}

	client := enttest.Open(t, "sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared&_pragma=foreign_keys(1)", t.Name()))
	defer client.Close()
	archiveDir := t.TempDir()
	dataDir := t.TempDir()
	manager := NewManager(NewEntRepository(client), archiveDir, dataDir)
	t.Cleanup(func() { _ = manager.Close() })

	ctx := t.Context()
	for _, archive := range archives {
		t.Run(strings.TrimSuffix(filepath.Base(archive), ".jsplugin.zip"), func(t *testing.T) {
			zipData, err := os.ReadFile(archive)
			if err != nil {
				t.Fatal(err)
			}
			manifest := realPluginManifest(t, zipData)
			item, err := manager.Install(ctx, zipData)
			if err != nil {
				t.Fatalf("install official plugin %s: %v", manifest.EntryPath, err)
			}
			if item.EntryPath != manifest.EntryPath || item.Version != manifest.Version {
				t.Fatalf("stored metadata=%+v manifest=%+v", item, manifest)
			}
			if _, err := os.Stat(filepath.Join(archiveDir, manifest.EntryPath+".jsplugin.zip")); err != nil {
				t.Fatalf("official plugin archive was not stored: %v", err)
			}
			if _, err := os.Stat(filepath.Join(dataDir, manifest.EntryPath, "static", "index.html")); err != nil {
				t.Fatalf("official plugin frontend was not extracted: %v", err)
			}
			if _, err := manager.StaticFilePath(manifest.EntryPath, "/index.html"); err != nil {
				t.Fatalf("static path rejected: %v", err)
			}
			if err := manager.Enable(ctx, item.ID); err != nil {
				t.Fatalf("enable official plugin: %v", err)
			}
			items, err := manager.List(ctx)
			if err != nil {
				t.Fatal(err)
			}
			var active Plugin
			for _, candidate := range items {
				if candidate.EntryPath == manifest.EntryPath {
					active = candidate
				}
			}
			if active.Status != StatusActive || !active.HasFrontend {
				t.Fatalf("plugin is not active with frontend: %+v", active)
			}
			if manifest.EntryPath == "stats" && !manager.HasPlayEventSubscriber() {
				t.Fatal("official stats plugin did not register for play events")
			}
			if manifest.EntryPath == "lyrics" {
				enableRealLyricsProvider(t, ctx, manager, manifest.EntryPath)
				if !manager.HasLyricProvider() {
					t.Fatal("official lyrics plugin did not register its provider after enable")
				}
				if os.Getenv("LARK_REAL_PLUGIN_NETWORK") == "1" {
					assertRealLyricsSearch(t, ctx, manager, manifest.EntryPath)
				}
			}
			if manifest.EntryPath == "subsonic" {
				assertRealSubsonicPlaybackResolution(t, ctx, manager, manifest.EntryPath)
			}
			if manifest.EntryPath == "library-plus" {
				assertRealLibraryPlusReadsLibrary(t, ctx, client, manager, manifest.EntryPath)
			}
		})
	}
}

func assertRealLibraryPlusReadsLibrary(t *testing.T, ctx context.Context, client *ent.Client, manager *Manager, entryPath string) {
	t.Helper()
	libraryDir := t.TempDir()
	if _, err := client.Song.Create().SetTitle("Fixture").SetSourceType("local").SetSourceArtist("Artist").SetSourceAlbum("Album").SetPath(filepath.Join(libraryDir, "fixture.mp3")).SetFileName("fixture.mp3").SetFormat("mp3").SetSizeBytes(10).SetDurationSeconds(12).SetYear(2026).Save(ctx); err != nil {
		t.Fatal(err)
	}
	service := library.New(client, t.TempDir(), libraryDir, "", "", nil, nil)
	manager.SetHost(larkhost.New(client, service, larkhost.Config{DataDir: t.TempDir(), MusicDir: libraryDir}))
	response, err := manager.InvokeHTTP(ctx, entryPath, HTTPRequest{Method: http.MethodGet, Path: "/api/index", Headers: map[string]string{}})
	if err != nil {
		t.Fatalf("library-plus index call: %v", err)
	}
	if response.StatusCode != http.StatusOK || !strings.Contains(response.Body, `"total":1`) {
		t.Fatalf("library-plus index status=%d body=%s", response.StatusCode, response.Body)
	}
}

func assertRealSubsonicPlaybackResolution(t *testing.T, ctx context.Context, manager *Manager, entryPath string) {
	t.Helper()
	upstream := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/rest/stream" || request.URL.Query().Get("id") != "track-1" || request.URL.Query().Get("u") != "alice" {
			http.Error(response, "unexpected Subsonic request", http.StatusBadRequest)
			return
		}
		response.Header().Set("Content-Type", "audio/mpeg")
		response.Header().Set("Accept-Ranges", "bytes")
		_, _ = response.Write([]byte("real-subsonic-audio"))
	}))
	t.Cleanup(upstream.Close)

	configBody, err := json.Marshal(map[string]string{
		"name": "test-server", "url": upstream.URL, "username": "alice", "password": "secret",
	})
	if err != nil {
		t.Fatal(err)
	}
	response, err := manager.InvokeHTTP(ctx, entryPath, HTTPRequest{
		Method: http.MethodPost, Path: "/lists",
		Headers: map[string]string{"Content-Type": "application/json"}, Body: string(configBody),
	})
	if err != nil {
		t.Fatalf("configure official Subsonic plugin: %v", err)
	}
	if response.StatusCode != http.StatusOK {
		t.Fatalf("configure official Subsonic plugin status=%d body=%s", response.StatusCode, response.Body)
	}

	resolved, err := manager.ResolveSongURL(
		ctx, entryPath, `{"configName":"test-server","songId":"track-1"}`,
		"Fixture", "Artist", 10,
	)
	if err != nil {
		t.Fatalf("resolve official Subsonic audio: %v", err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, resolved.URL, nil)
	if err != nil {
		t.Fatal(err)
	}
	streamResponse, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("fetch official Subsonic resolved URL: %v", err)
	}
	body, readErr := io.ReadAll(streamResponse.Body)
	closeErr := streamResponse.Body.Close()
	if readErr != nil || closeErr != nil {
		t.Fatalf("read official Subsonic stream: read=%v close=%v", readErr, closeErr)
	}
	if streamResponse.StatusCode != http.StatusOK || string(body) != "real-subsonic-audio" {
		t.Fatalf("official Subsonic stream status=%d body=%q", streamResponse.StatusCode, body)
	}
}

func enableRealLyricsProvider(t *testing.T, ctx context.Context, manager *Manager, entryPath string) {
	t.Helper()
	response, err := manager.InvokeHTTP(ctx, entryPath, HTTPRequest{
		Method:  "PUT",
		Path:    "/config",
		Headers: map[string]string{"Content-Type": "application/json"},
		Body:    `{"enabled":true,"provider":"lrclib","customUrl":""}`,
	})
	if err != nil {
		t.Fatalf("enable official lyrics provider: %v", err)
	}
	if response.StatusCode != 200 {
		t.Fatalf("enable official lyrics provider status=%d body=%s", response.StatusCode, response.Body)
	}
}

func realPluginManifest(t *testing.T, zipData []byte) *Manifest {
	t.Helper()
	reader, err := zip.NewReader(bytes.NewReader(zipData), int64(len(zipData)))
	if err != nil {
		t.Fatal(err)
	}
	for _, file := range reader.File {
		if file.Name != "plugin.json" {
			continue
		}
		rc, err := file.Open()
		if err != nil {
			t.Fatal(err)
		}
		data, readErr := io.ReadAll(rc)
		closeErr := rc.Close()
		if readErr != nil {
			t.Fatal(readErr)
		}
		if closeErr != nil {
			t.Fatal(closeErr)
		}
		manifest, err := ParseManifest(data)
		if err != nil {
			t.Fatal(err)
		}
		return manifest
	}
	t.Fatal("plugin.json not found")
	return nil
}

func assertRealLyricsSearch(t *testing.T, ctx context.Context, manager *Manager, entryPath string) {
	t.Helper()
	searchCtx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	response, err := manager.InvokeHTTP(searchCtx, entryPath, HTTPRequest{
		Method:  "GET",
		Path:    "/lyric-search",
		Query:   "title=Imagine&artist=John+Lennon&album=Imagine&duration=183",
		Headers: map[string]string{},
	})
	if err != nil {
		t.Fatalf("call official lyrics plugin: %v", err)
	}
	if response.StatusCode != 200 {
		t.Fatalf("official lyrics plugin status=%d body=%s", response.StatusCode, response.Body)
	}
	var payload LyricPayload
	if err := json.Unmarshal([]byte(response.Body), &payload); err != nil || payload.IsEmpty() {
		t.Fatalf("official lyrics payload=%+v body=%q err=%v", payload, response.Body, err)
	}
}
