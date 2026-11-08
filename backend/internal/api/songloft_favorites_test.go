package api

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"lark/backend/ent/enttest"
	"lark/backend/internal/library"
	pluginhost "lark/backend/internal/plugin/host"
	"lark/backend/internal/plugin/larkhost"

	_ "github.com/lib-x/entsqlite"
)

func TestSongloftHTTPFavoritesMatchBridgeAndPreserveOrdinaryPlaylist(t *testing.T) {
	client := enttest.Open(t, "sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared&_pragma=foreign_keys(1)", t.Name()))
	defer client.Close()
	ctx := t.Context()
	service := library.New(client, t.TempDir(), t.TempDir(), "", "", nil, nil)
	admin, adminToken, err := service.SetupAdmin(ctx, "admin", "password")
	if err != nil {
		t.Fatal(err)
	}
	settings, err := service.GetSettings(ctx)
	if err != nil {
		t.Fatal(err)
	}
	settings.RegistrationEnabled = true
	if _, err := service.SaveSettings(ctx, settings); err != nil {
		t.Fatal(err)
	}
	_, otherToken, err := service.Register(ctx, "member", "password")
	if err != nil {
		t.Fatal(err)
	}
	native, err := service.CreatePlaylist(ctx, admin.ID, "Preserved", "", "")
	if err != nil || native.ID != 1 {
		t.Fatalf("native=%+v %v", native, err)
	}
	track := client.Song.Create().SetTitle("Fixture").SetPath("/fixture.flac").SetFileName("fixture.flac").SaveX(ctx)
	server := New(client, service, "*")
	request := func(token, method, path, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: token})
		response := httptest.NewRecorder()
		server.echo.ServeHTTP(response, req)
		return response
	}
	body := fmt.Sprintf(`{"song_ids":[%d]}`, track.ID)
	response := request(adminToken, http.MethodPost, "/api/v1/playlists/1/songs", body)
	if response.Code != http.StatusOK {
		t.Fatalf("favorite=%d %s", response.Code, response.Body.String())
	}
	bridge := larkhost.New(client, service, larkhost.Config{UserID: admin.ID}).Playlists()
	items, err := bridge.Songs(ctx, 1, pluginhost.PlaylistSongQuery{})
	if err != nil || len(items) != 1 || items[0].ID != track.ID {
		t.Fatalf("HTTP/bridge mismatch %+v %v", items, err)
	}
	response = request(otherToken, http.MethodGet, "/api/v1/playlists/1/songs", "")
	if response.Code != http.StatusOK || strings.Contains(response.Body.String(), "Fixture") {
		t.Fatalf("favorites leak: %d %s", response.Code, response.Body.String())
	}
	response = request(otherToken, http.MethodGet, "/api/v1/playlists/1000000001/songs", "")
	if response.Code != http.StatusNotFound {
		t.Fatalf("owner boundary=%d %s", response.Code, response.Body.String())
	}
	for _, path := range []string{"2", "-1", "1000000000", "9007199254740992"} {
		response = request(adminToken, http.MethodGet, "/api/v1/playlists/"+path, "")
		if response.Code != http.StatusBadRequest {
			t.Fatalf("invalid ID %s accepted: %d %s", path, response.Code, response.Body.String())
		}
	}
	response = request(adminToken, http.MethodDelete, fmt.Sprintf("/api/v1/playlists/1/songs/%d", track.ID), "")
	if response.Code != http.StatusNoContent {
		t.Fatalf("remove=%d %s", response.Code, response.Body.String())
	}
	response = request(adminToken, http.MethodDelete, "/api/v1/playlists/1", "")
	if response.Code != http.StatusNotImplemented {
		t.Fatalf("delete builtin=%d %s", response.Code, response.Body.String())
	}
	nativeSongs, err := service.PlaylistSongs(ctx, admin.ID, native.ID, 0)
	if err != nil || len(nativeSongs) != 0 {
		t.Fatalf("ordinary playlist corrupted: %+v %v", nativeSongs, err)
	}
}
