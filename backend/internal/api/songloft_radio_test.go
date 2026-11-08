package api

import (
	"encoding/json/v2"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"lark/backend/ent/enttest"
	"lark/backend/internal/library"
	"lark/backend/internal/plugin"
	"lark/backend/internal/plugin/larkhost"

	_ "github.com/lib-x/entsqlite"
)

func TestSongloftRadioImportAndTypedPlaylist(t *testing.T) {
	client := enttest.Open(t, "sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared&_pragma=foreign_keys(1)", t.Name()))
	defer client.Close()
	service := library.New(client, t.TempDir(), t.TempDir(), "", "", nil, nil)
	admin, _, err := service.SetupAdmin(t.Context(), "admin", "password")
	if err != nil {
		t.Fatal(err)
	}
	repository := plugin.NewEntRepository(client)
	_, err = repository.Create(t.Context(), plugin.Plugin{Name: "Radio", Version: "1.0.0", EntryPath: "radio", Main: "main.js", Permissions: []string{"songs.write", "playlists.*"}, Status: plugin.StatusActive})
	if err != nil {
		t.Fatal(err)
	}
	manager := plugin.NewManager(repository, t.TempDir(), t.TempDir(), plugin.WithHost(larkhost.New(client, service, larkhost.Config{UserID: admin.ID})))
	t.Cleanup(func() { _ = manager.Close() })
	server := New(client, service, "*", WithPluginManager(manager))
	token := manager.HostToken("radio")
	response := performSongLoftRequest(server, http.MethodPost, "/api/v1/songs/radio", `[{"url":"https://radio.example/stream","title":"Fixture station","artist":"Fixture","is_video":false}]`, token)
	if response.Code != http.StatusCreated {
		t.Fatalf("import status=%d body=%s", response.Code, response.Body.String())
	}
	var imported struct {
		Songs []songLoftSong `json:"songs"`
		Count int            `json:"count"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &imported); err != nil || imported.Count != 1 || len(imported.Songs) != 1 || imported.Songs[0].Type != "radio" || !imported.Songs[0].IsLive {
		t.Fatalf("import=%s err=%v", response.Body.String(), err)
	}
	response = performSongLoftRequest(server, http.MethodPost, "/api/v1/playlists", `{"name":"Fixture radio list","type":"radio"}`, token)
	if response.Code != http.StatusCreated {
		t.Fatalf("create=%d %s", response.Code, response.Body.String())
	}
	var playlist struct {
		ID   int    `json:"id"`
		Type string `json:"type"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &playlist); err != nil || playlist.Type != "radio" || playlist.ID <= 1_000_000_000 {
		t.Fatalf("playlist=%s err=%v", response.Body.String(), err)
	}
	path := fmt.Sprintf("/api/v1/playlists/%d/songs", playlist.ID)
	local := client.Song.Create().SetTitle("Local fixture").SetPath("/local.flac").SetFileName("local.flac").SaveX(t.Context())
	body := fmt.Sprintf(`{"song_ids":[%d,%d,999999,%d]}`, imported.Songs[0].ID, imported.Songs[0].ID, local.ID)
	response = performSongLoftRequest(server, http.MethodPost, path, body, token)
	var added struct {
		Added   int `json:"added"`
		Skipped int `json:"skipped"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &added); err != nil || response.Code != http.StatusOK || added.Added != 1 || added.Skipped != 3 {
		t.Fatalf("add=%d %s err=%v", response.Code, response.Body.String(), err)
	}
	response = performSongLoftRequest(server, http.MethodGet, fmt.Sprintf("/api/v1/playlists/%d", playlist.ID), "", token)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"type":"radio"`) {
		t.Fatalf("radio type not retained: %d %s", response.Code, response.Body.String())
	}
	for _, body := range []string{`[]`, `[{"url":"file:///etc/passwd","title":"bad"}]`, `[{"url":"https://example.com","title":""}]`} {
		response = performSongLoftRequest(server, http.MethodPost, "/api/v1/songs/radio", body, token)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("invalid import accepted: %d %s", response.Code, response.Body.String())
		}
	}
}
