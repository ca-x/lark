package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"lark/backend/ent/enttest"
	"lark/backend/internal/library"
	"lark/backend/internal/plugin"
	"lark/backend/internal/plugin/larkhost"

	_ "github.com/lib-x/entsqlite"
	taglib "go.senan.xyz/taglib"
)

func TestSongLoftPluginTokenReadsLibraryAndEnforcesWritePermission(t *testing.T) {
	client := enttest.Open(t, "sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared&_pragma=foreign_keys(1)", t.Name()))
	defer client.Close()
	service := library.New(client, t.TempDir(), t.TempDir(), "", "", nil, nil)
	if _, _, err := service.SetupAdmin(t.Context(), "admin", "password"); err != nil {
		t.Fatal(err)
	}
	item, err := client.Song.Create().
		SetTitle("Fixture").SetSourceType("local").SetSourceArtist("Artist").SetSourceAlbum("Album").
		SetPath("/music/Artist/Album/Fixture.flac").SetFileName("Fixture.flac").SetFormat("flac").
		SetSizeBytes(1234).SetDurationSeconds(125).SetBitRate(900).SetSampleRate(48000).SetYear(2026).
		Save(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	repository := plugin.NewEntRepository(client)
	installed, err := repository.Create(t.Context(), plugin.Plugin{
		Name: "Library Reader", Version: "1.0.0", EntryPath: "library-reader", Main: "main.js",
		Permissions: []string{plugin.PermSongsRead}, Status: plugin.StatusActive,
	})
	if err != nil {
		t.Fatal(err)
	}
	manager := plugin.NewManager(repository, t.TempDir(), t.TempDir())
	t.Cleanup(func() { _ = manager.Close() })
	server := New(client, service, "*", WithPluginManager(manager))
	token := manager.HostToken(installed.EntryPath)

	response := performSongLoftRequest(server, http.MethodGet, "/api/v1/songs?limit=100000&offset=0", "", token)
	if response.Code != http.StatusOK {
		t.Fatalf("list status=%d body=%s", response.Code, response.Body.String())
	}
	var payload struct {
		Songs []map[string]any `json:"songs"`
		Total int              `json:"total"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Total != 1 || len(payload.Songs) != 1 || int(payload.Songs[0]["id"].(float64)) != item.ID {
		t.Fatalf("list payload=%s", response.Body.String())
	}
	for _, field := range []string{"file_path", "file_size", "format", "bit_rate", "sample_rate", "year", "added_at", "updated_at"} {
		if _, found := payload.Songs[0][field]; !found {
			t.Errorf("SongLoft song is missing %q: %s", field, response.Body.String())
		}
	}

	response = performSongLoftRequest(server, http.MethodPut, fmt.Sprintf("/api/v1/songs/%d", item.ID), `{"title":"Changed"}`, token)
	if response.Code != http.StatusForbidden {
		t.Fatalf("read-only write status=%d body=%s", response.Code, response.Body.String())
	}
	response = performSongLoftRequest(server, http.MethodGet, "/api/v1/songs", "", token+"tampered")
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("tampered token status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestSongLoftLibraryMutationContractWritesRealTagsAndCreatesRemoteSongs(t *testing.T) {
	client := enttest.Open(t, "sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared&_pragma=foreign_keys(1)", t.Name()))
	defer client.Close()
	libraryDir := t.TempDir()
	audioPath := filepath.Join(libraryDir, "fixture.flac")
	testdata := filepath.Join(os.Getenv("HOME"), "go", "pkg", "mod", "go.senan.xyz", "taglib@v0.12.0", "testdata", "eg.flac")
	audio, err := os.ReadFile(testdata)
	if err != nil {
		t.Skip("taglib testdata is unavailable")
	}
	if err := os.WriteFile(audioPath, audio, 0o644); err != nil {
		t.Fatal(err)
	}
	service := library.New(client, t.TempDir(), libraryDir, "", "", nil, nil)
	admin, _, err := service.SetupAdmin(t.Context(), "admin", "password")
	if err != nil {
		t.Fatal(err)
	}
	local, err := client.Song.Create().SetTitle("Old").SetSourceType("local").SetPath(audioPath).
		SetFileName("fixture.flac").SetFormat("flac").Save(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	repository := plugin.NewEntRepository(client)
	installed, err := repository.Create(t.Context(), plugin.Plugin{
		Name: "Library Writer", Version: "1.0.0", EntryPath: "library-writer", Main: "main.js",
		Permissions: []string{"songs.*", "playlists.*"}, Status: plugin.StatusActive,
	})
	if err != nil {
		t.Fatal(err)
	}
	manager := plugin.NewManager(repository, t.TempDir(), t.TempDir(), larkhost.New(client, service, larkhost.Config{UserID: admin.ID, DataDir: t.TempDir(), MusicDir: libraryDir}))
	t.Cleanup(func() { _ = manager.Close() })
	server := New(client, service, "*", WithPluginManager(manager))
	token := manager.HostToken(installed.EntryPath)

	tagsBody := `{"title":"New Title","artist":"New Artist","album":"New Album","year":2026,"genre":"Rock","language":"zh","style":"Live","track":"3/12"}`
	response := performSongLoftRequest(server, http.MethodPut, fmt.Sprintf("/api/v1/songs/%d/tags", local.ID), tagsBody, token)
	if response.Code != http.StatusOK {
		t.Fatalf("write tags status=%d body=%s", response.Code, response.Body.String())
	}
	writtenTags, err := taglib.ReadTags(audioPath)
	if err != nil {
		t.Fatal(err)
	}
	for key, want := range map[string]string{
		taglib.Title: "New Title", taglib.Artist: "New Artist", taglib.Album: "New Album",
		taglib.Date: "2026", taglib.Genre: "Rock", taglib.Language: "zh", "STYLE": "Live", taglib.TrackNumber: "3/12",
	} {
		if values := writtenTags[key]; len(values) == 0 || values[0] != want {
			t.Errorf("tag %s=%v want %q", key, values, want)
		}
	}
	stored, err := client.Song.Get(t.Context(), local.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Genre != "Rock" || stored.Language != "zh" || stored.Style != "Live" || stored.Track != "3/12" {
		t.Fatalf("stored extended tags=%+v", stored)
	}

	remoteBody := `[{"title":"Remote Track","artist":"Remote Artist","album":"Remote Album","source_data":"{\"songId\":\"track-1\"}","dedup_key":"track-1"}]`
	response = performSongLoftRequest(server, http.MethodPost, "/api/v1/songs/remote", remoteBody, token)
	if response.Code != http.StatusCreated {
		t.Fatalf("remote import status=%d body=%s", response.Code, response.Body.String())
	}
	var imported struct {
		Songs []songLoftSong `json:"songs"`
		Count int            `json:"count"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &imported); err != nil || imported.Count != 1 || imported.Songs[0].PluginEntryPath != installed.EntryPath {
		t.Fatalf("remote import payload=%s err=%v", response.Body.String(), err)
	}

	response = performSongLoftRequest(server, http.MethodPost, "/api/v1/playlists", `{"name":"Imported","description":"fixture","type":"normal"}`, token)
	if response.Code != http.StatusCreated {
		t.Fatalf("playlist create status=%d body=%s", response.Code, response.Body.String())
	}
	var playlist struct {
		ID int `json:"id"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &playlist); err != nil || playlist.ID == 0 {
		t.Fatalf("playlist payload=%s err=%v", response.Body.String(), err)
	}
	response = performSongLoftRequest(server, http.MethodPost, fmt.Sprintf("/api/v1/playlists/%d/songs", playlist.ID), fmt.Sprintf(`{"song_ids":[%d]}`, imported.Songs[0].ID), token)
	if response.Code != http.StatusOK {
		t.Fatalf("playlist add status=%d body=%s", response.Code, response.Body.String())
	}
	items, err := service.PlaylistSongs(t.Context(), admin.ID, playlist.ID, 0)
	if err != nil || len(items) != 1 || items[0].ID != imported.Songs[0].ID {
		t.Fatalf("playlist songs=%+v err=%v", items, err)
	}
}

func performSongLoftRequest(server *Server, method, target, body, token string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, target, strings.NewReader(body))
	request.Header.Set("Authorization", "Bearer "+token)
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	response := httptest.NewRecorder()
	server.echo.ServeHTTP(response, request)
	return response
}
