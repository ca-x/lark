package api

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json/v2"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"lark/backend/internal/mygo"
	"lark/backend/internal/plugin"
	"lark/backend/internal/pluginapp"
)

func TestMygoMediaLifetimeAndLocalCancellation(t *testing.T) {
	client := newMygoMediaClient(mygo.Media{})
	defer client.CloseIdleConnections()
	if client.Timeout != 0 {
		t.Fatal("audio has a whole-body deadline")
	}
	ctx, cancel := context.WithCancel(t.Context())
	reader := &mygoMediaReader{ctx: ctx, Reader: bytes.NewReader([]byte("audio"))}
	if _, err := reader.Read(make([]byte, 1)); err != nil {
		t.Fatal(err)
	}
	cancel()
	if _, err := reader.Read(make([]byte, 1)); !errors.Is(err, context.Canceled) {
		t.Fatalf("read after disable: %v", err)
	}
	if _, err := reader.Seek(0, io.SeekStart); !errors.Is(err, context.Canceled) {
		t.Fatalf("seek after disable: %v", err)
	}
}

func TestPluginPlatformAuthIsolationAndRangePlayback(t *testing.T) {
	fixture := newSharingFixture(t)
	store := pluginapp.NewEntStore(fixture.client)
	manager := plugin.NewManager(plugin.NewEntRepository(fixture.client), t.TempDir(), t.TempDir())
	service, err := mygo.New(t.Context(), store, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	platform := pluginapp.New(store, plugin.Adapter{Manager: manager}, service)
	if err := platform.Start(t.Context()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = platform.Close(context.Background()) })
	server := New(fixture.client, fixture.service, "*", WithPluginManager(manager), WithPluginPlatform(platform, service, mygo.NewCatalog(http.DefaultClient)))
	var archive bytes.Buffer
	writer := zip.NewWriter(&archive)
	for name, contents := range map[string]string{
		"plugin.json": `{"id":"fixture","name":"Fixture","permissions":{},"settings":[{"key":"token","label":"Token"}]}`,
		"index.js":    `export function search(p) { if(p.query) host.storage.set("token", p.query);return {token:host.storage.get("token"),setting:host.setting("token")}; } export function stream(){return {url:"file:///package/tone.wav"}}`,
		"tone.wav":    "RIFF0000WAVEfmt 0000000000000000000000000000data0000fixture-audio",
	} {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write([]byte(contents)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	preview, err := service.Preview(t.Context(), archive.Bytes(), "fixture")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Install(t.Context(), preview.Token); err != nil {
		t.Fatal(err)
	}
	if err := service.SetEnabled(t.Context(), "fixture", true); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/api/plugin-platform", "/api/mygo/plugins", "/api/mygo/queue", "/api/mygo/plugins/fixture/stream?id=one"} {
		response := performShareRequest(server, http.MethodGet, path, "", nil)
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("anonymous %s = %d", path, response.Code)
		}
	}
	response := performShareRequest(server, http.MethodPut, "/api/plugin-platform", `{"songloft":true,"mygo":true}`, fixture.member)
	if response.Code != http.StatusForbidden {
		t.Fatal("member changed global switches", response.Code)
	}
	response = performShareRequest(server, http.MethodPut, "/api/plugin-platform", `{"songloft":true,"mygo":true}`, fixture.admin)
	if response.Code != http.StatusOK {
		t.Fatal(response.Body.String())
	}
	response = performShareRequest(server, http.MethodPatch, "/api/plugin-platform", `{"mygo":false}`, fixture.member)
	if response.Code != http.StatusForbidden {
		t.Fatal("member patched global switches", response.Code)
	}
	for _, patch := range []string{`{"songloft":false}`, `{"mygo":true}`} {
		response = performShareRequest(server, http.MethodPatch, "/api/plugin-platform", patch, fixture.admin)
		if response.Code != http.StatusOK {
			t.Fatal(response.Body.String())
		}
	}
	if platform.State() != (pluginapp.State{Songloft: false, MyGo: true}) {
		t.Fatal("independent admin patch overwrote another switch")
	}
	for _, step := range []struct {
		cookie   *http.Cookie
		query    string
		expected string
	}{{fixture.admin, "admin-private", "admin-private"}, {fixture.member, "member-private", "member-private"}, {fixture.admin, "", "admin-private"}} {
		body, _ := json.Marshal(map[string]string{"query": step.query})
		response = performShareRequest(server, http.MethodPost, "/api/mygo/plugins/fixture/call/search", string(body), step.cookie)
		if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), step.expected) {
			t.Fatalf("state isolation failed: %d %s", response.Code, response.Body.String())
		}
	}
	response = performShareRequest(server, http.MethodPut, "/api/mygo/plugins/fixture/settings", `{"token":"admin-setting"}`, fixture.admin)
	if response.Code != http.StatusNoContent {
		t.Fatal(response.Body.String())
	}
	response = performShareRequest(server, http.MethodGet, "/api/mygo/plugins/fixture/settings", "", fixture.member)
	if response.Code != http.StatusOK || strings.Contains(response.Body.String(), "admin-setting") {
		t.Fatal("settings leaked", response.Body.String())
	}
	response = performShareRequest(server, http.MethodPut, "/api/mygo/queue", `{"private":"admin-queue"}`, fixture.admin)
	if response.Code != http.StatusNoContent {
		t.Fatal(response.Body.String())
	}
	response = performShareRequest(server, http.MethodGet, "/api/mygo/queue", "", fixture.member)
	if response.Body.String() != "null" {
		t.Fatal("queue leaked", response.Body.String())
	}
	request := httptest.NewRequest(http.MethodGet, "/api/mygo/plugins/fixture/stream?id=one", nil)
	request.AddCookie(fixture.member)
	request.Header.Set("Range", "bytes=0-7")
	response = httptest.NewRecorder()
	server.echo.ServeHTTP(response, request)
	if response.Code != http.StatusPartialContent || response.Body.String() != "RIFF0000" || response.Header().Get("Content-Type") != "audio/wav" {
		t.Fatalf("range playback: %d %s", response.Code, response.Body.String())
	}
	response = performShareRequest(server, http.MethodGet, "/api/mygo/plugins/fixture/image?url=file%3A%2F%2F%2Fpackage%2Findex.js", "", fixture.member)
	if response.Code != http.StatusBadRequest {
		t.Fatal("source served as executable image", response.Code)
	}
	if count := fixture.client.Song.Query().CountX(t.Context()); count != len(fixture.songIDs) {
		t.Fatal("private source modified global Song table", count)
	}
	response = performShareRequest(server, http.MethodPut, "/api/plugin-platform", `{"songloft":false,"mygo":false}`, fixture.admin)
	if response.Code != http.StatusOK {
		t.Fatal(response.Body.String())
	}
	response = performShareRequest(server, http.MethodPost, "/api/mygo/plugins/fixture/call/search", `{}`, fixture.admin)
	if response.Code != http.StatusServiceUnavailable {
		t.Fatal("disabled ecosystem executed plugin", response.Code)
	}
	response = performShareRequest(server, http.MethodPut, "/api/plugin-platform", `{"songloft":false,"mygo":true}`, fixture.admin)
	if response.Code != http.StatusOK {
		t.Fatal(response.Body.String())
	}
	response = performShareRequest(server, http.MethodPost, "/api/mygo/plugins/fixture/call/search", `{}`, fixture.member)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "member-private") {
		t.Fatal("resume lost user state", response.Body.String())
	}
}
