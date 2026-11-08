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
)

func TestRealRadioPluginImportAndPlayback(t *testing.T) {
	directory := os.Getenv("LARK_REAL_PLUGIN_DIR")
	if directory == "" {
		t.Skip("set LARK_REAL_PLUGIN_DIR to the original Songloft package directory")
	}
	archive, err := os.ReadFile(filepath.Join(directory, "radio.jsplugin.zip"))
	if err != nil {
		t.Fatal(err)
	}
	client := enttest.Open(t, "sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared&_pragma=foreign_keys(1)", t.Name()))
	defer client.Close()
	ctx := t.Context()
	service := library.New(client, t.TempDir(), t.TempDir(), "", "", nil, nil)
	admin, token, err := service.SetupAdmin(ctx, "admin", "password")
	if err != nil {
		t.Fatal(err)
	}
	manager := plugin.NewManager(plugin.NewEntRepository(client), t.TempDir(), t.TempDir(), plugin.WithHost(larkhost.New(client, service, larkhost.Config{UserID: admin.ID})))
	t.Cleanup(func() { _ = manager.Close() })
	installed, err := manager.Install(ctx, archive)
	if err != nil {
		t.Fatal(err)
	}
	if err := manager.Enable(ctx, installed.ID); err != nil {
		t.Fatal(err)
	}
	server := New(client, service, "*", WithPluginManager(manager))
	cookie := &http.Cookie{Name: sessionCookieName, Value: token}
	response := performShareRequest(server, http.MethodPost, "/api/v1/playlists", `{"name":"Original radio fixture","type":"radio"}`, cookie)
	var list struct {
		ID   int    `json:"id"`
		Type string `json:"type"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &list); err != nil || response.Code != http.StatusCreated || list.Type != "radio" {
		t.Fatalf("playlist=%d %s err=%v", response.Code, response.Body.String(), err)
	}
	pluginLists, err := manager.InvokeHTTP(ctx, "radio", plugin.HTTPRequest{Method: http.MethodGet, Path: "/api/playlists", Headers: map[string]string{}})
	if err != nil || pluginLists.StatusCode != http.StatusOK || !strings.Contains(pluginLists.Body, fmt.Sprintf(`"id":%d`, list.ID)) {
		t.Fatalf("original radio lists=%+v err=%v", pluginLists, err)
	}
	saved, err := manager.InvokeHTTP(ctx, "radio", plugin.HTTPRequest{Method: http.MethodPost, Path: "/api/settings", Headers: map[string]string{"Content-Type": "application/json"}, Body: fmt.Sprintf(`{"last_playlist_id":%d}`, list.ID)})
	if err != nil || saved.StatusCode != http.StatusOK {
		t.Fatalf("settings=%+v %v", saved, err)
	}
	upstream := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Range") != "bytes=2-5" {
			t.Errorf("missing audio range: %v", request.Header)
		}
		response.Header().Set("Content-Type", "audio/mpeg")
		response.Header().Set("Content-Range", "bytes 2-5/8")
		response.WriteHeader(http.StatusPartialContent)
		_, _ = response.Write([]byte("2345"))
	}))
	t.Cleanup(upstream.Close)
	body := fmt.Sprintf(`[{"url":%q,"title":"Fixture station"}]`, upstream.URL+"/stream")
	response = performShareRequest(server, http.MethodPost, "/api/v1/songs/radio", body, cookie)
	var imported struct {
		Songs []songLoftSong `json:"songs"`
		Count int            `json:"count"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &imported); err != nil || response.Code != http.StatusCreated || imported.Count != 1 || len(imported.Songs) != 1 || !imported.Songs[0].IsLive {
		t.Fatalf("import=%d %s err=%v", response.Code, response.Body.String(), err)
	}
	response = performShareRequest(server, http.MethodPost, "/api/v1/songs/radio", body, cookie)
	var duplicate struct {
		Songs []songLoftSong `json:"songs"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &duplicate); err != nil || len(duplicate.Songs) != 1 || duplicate.Songs[0].ID != imported.Songs[0].ID {
		t.Fatalf("radio duplicate=%s %v", response.Body.String(), err)
	}
	response = performShareRequest(server, http.MethodPost, fmt.Sprintf("/api/v1/playlists/%d/songs", list.ID), fmt.Sprintf(`{"song_ids":[%d]}`, imported.Songs[0].ID), cookie)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"added":1`) {
		t.Fatalf("add=%d %s", response.Code, response.Body.String())
	}
	request := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/songs/%d/stream", imported.Songs[0].ID), nil)
	request.AddCookie(cookie)
	request.Header.Set("Range", "bytes=2-5")
	response = httptest.NewRecorder()
	server.echo.ServeHTTP(response, request)
	if response.Code != http.StatusPartialContent || response.Body.String() != "2345" || response.Header().Get("Content-Range") != "bytes 2-5/8" {
		t.Fatalf("radio playback=%d %s headers=%v", response.Code, response.Body.String(), response.Header())
	}
	if err := manager.Disable(ctx, installed.ID); err != nil {
		t.Fatal(err)
	}
	if err := manager.Enable(ctx, installed.ID); err != nil {
		t.Fatal(err)
	}
	settings, err := manager.InvokeHTTP(ctx, "radio", plugin.HTTPRequest{Method: http.MethodGet, Path: "/api/settings", Headers: map[string]string{}})
	if err != nil || !strings.Contains(settings.Body, fmt.Sprintf(`"last_playlist_id":%d`, list.ID)) {
		t.Fatalf("settings did not persist: %+v %v", settings, err)
	}
}
