package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"lark/backend/ent/enttest"
	"lark/backend/internal/library"
	"lark/backend/internal/plugin"

	_ "github.com/lib-x/entsqlite"
)

func TestProxyPluginMediaForwardsRangeAndPluginHeaders(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Range") != "bytes=2-5" {
			t.Errorf("upstream Range = %q", request.Header.Get("Range"))
		}
		if request.Header.Get("Authorization") != "Bearer source-token" {
			t.Errorf("upstream Authorization = %q", request.Header.Get("Authorization"))
		}
		if request.Header.Get("Referer") != "https://app.example.test/" {
			t.Errorf("upstream Referer = %q", request.Header.Get("Referer"))
		}
		response.Header().Set("Content-Type", "audio/mpeg")
		response.Header().Set("Content-Range", "bytes 2-5/8")
		response.Header().Set("Accept-Ranges", "bytes")
		response.WriteHeader(http.StatusPartialContent)
		_, _ = response.Write([]byte("2345"))
	}))
	t.Cleanup(upstream.Close)

	request := httptest.NewRequest(http.MethodGet, "/api/stream/1", nil)
	request.Header.Set("Range", "bytes=2-5")
	response := httptest.NewRecorder()
	err := proxyPluginMedia(
		request.Context(), response, request, upstream.URL+"/track.mp3",
		map[string]string{
			"Authorization": "Bearer source-token",
			"Referer":       "https://app.example.test/",
		},
		newPluginMediaClient(),
	)
	if err != nil {
		t.Fatal(err)
	}
	if response.Code != http.StatusPartialContent || response.Body.String() != "2345" {
		t.Fatalf("proxy response status=%d body=%q", response.Code, response.Body.String())
	}
	if response.Header().Get("Content-Range") != "bytes 2-5/8" || response.Header().Get("Accept-Ranges") != "bytes" {
		t.Fatalf("proxy response headers = %v", response.Header())
	}
}

func TestProxyPluginMediaAllowsPrivateSongSources(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.WriteHeader(http.StatusOK)
		_, _ = response.Write([]byte("private-nas-audio"))
	}))
	t.Cleanup(upstream.Close)

	request := httptest.NewRequest(http.MethodGet, "/api/stream/1", nil)
	response := httptest.NewRecorder()
	if err := proxyPluginMedia(request.Context(), response, request, upstream.URL, nil, newPluginMediaClient()); err != nil {
		t.Fatal(err)
	}
	if response.Body.String() != "private-nas-audio" {
		t.Fatalf("private source body = %q", response.Body.String())
	}
}

func TestPluginMediaRejectsUnsafeURLAndHeaders(t *testing.T) {
	for _, rawURL := range []string{"file:///etc/passwd", "javascript:alert(1)", "/relative/audio.mp3"} {
		if _, err := parsePluginMediaURL(rawURL); err == nil {
			t.Errorf("parsePluginMediaURL(%q) unexpectedly succeeded", rawURL)
		}
	}

	tests := []map[string]string{
		{"Host": "metadata.internal"},
		{"Connection": "keep-alive"},
		{"Range": "bytes=0-"},
		{"X-Bad": "ok\r\nInjected: yes"},
	}
	for _, headers := range tests {
		if err := applyPluginMediaRequestHeaders(make(http.Header), headers); err == nil {
			t.Errorf("headers %v unexpectedly accepted", headers)
		}
	}
}

func TestPluginMediaIPPolicyBlocksMetadataButAllowsPrivateServers(t *testing.T) {
	for _, address := range []string{"169.254.169.254", "fe80::1", "0.0.0.0", "ff02::1"} {
		if isAllowedPluginMediaIP(netip.MustParseAddr(address)) {
			t.Fatalf("unsafe media address %s was allowed", address)
		}
	}
	for _, address := range []string{"127.0.0.1", "10.0.0.2", "192.168.1.20", "8.8.8.8"} {
		if !isAllowedPluginMediaIP(netip.MustParseAddr(address)) {
			t.Fatalf("valid media address %s was rejected", address)
		}
	}
}

func TestProxyPluginMediaUsesBasicAuthWithoutLeakingUserInfo(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		username, password, ok := request.BasicAuth()
		if !ok || username != "alice" || password != "secret" {
			t.Errorf("upstream BasicAuth = %q %q %t", username, password, ok)
		}
		if strings.Contains(request.URL.String(), "alice") || strings.Contains(request.URL.String(), "secret") {
			t.Errorf("userinfo leaked into upstream URL %q", request.URL.String())
		}
		response.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(upstream.Close)

	authenticatedURL := strings.Replace(upstream.URL, "http://", "http://alice:secret@", 1)
	request := httptest.NewRequest(http.MethodHead, "/api/stream/1", nil)
	response := httptest.NewRecorder()
	if err := proxyPluginMedia(request.Context(), response, request, authenticatedURL, nil, newPluginMediaClient()); err != nil {
		t.Fatal(err)
	}
	if response.Code != http.StatusOK || response.Body.Len() != 0 {
		t.Fatalf("HEAD proxy status=%d body=%q", response.Code, response.Body.String())
	}
}

func TestRealSubsonicPluginStreamsThroughLark(t *testing.T) {
	realPluginDir := os.Getenv("LARK_REAL_PLUGIN_DIR")
	if realPluginDir == "" {
		t.Skip("set LARK_REAL_PLUGIN_DIR to run the official Subsonic playback integration")
	}
	archive, err := os.ReadFile(filepath.Join(realPluginDir, "subsonic.jsplugin.zip"))
	if err != nil {
		t.Fatal(err)
	}

	upstream := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/rest/stream" || request.URL.Query().Get("id") != "track-1" {
			http.Error(response, "unexpected Subsonic stream request", http.StatusBadRequest)
			return
		}
		if request.Header.Get("Range") != "bytes=4-7" {
			http.Error(response, "missing range", http.StatusBadRequest)
			return
		}
		response.Header().Set("Content-Type", "audio/mpeg")
		response.Header().Set("Content-Range", "bytes 4-7/12")
		response.Header().Set("Accept-Ranges", "bytes")
		response.WriteHeader(http.StatusPartialContent)
		_, _ = response.Write([]byte("4567"))
	}))
	t.Cleanup(upstream.Close)

	client := enttest.Open(t, "sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared&_pragma=foreign_keys(1)", t.Name()))
	defer client.Close()
	service := library.New(client, t.TempDir(), t.TempDir(), "ffprobe", "ffmpeg", nil, nil)
	manager := plugin.NewManager(plugin.NewEntRepository(client), t.TempDir(), t.TempDir())
	t.Cleanup(func() { _ = manager.Close() })
	installed, err := manager.Install(t.Context(), archive)
	if err != nil {
		t.Fatal(err)
	}
	if err := manager.Enable(t.Context(), installed.ID); err != nil {
		t.Fatal(err)
	}
	configBody, err := json.Marshal(map[string]string{
		"name": "lark-test", "url": upstream.URL, "username": "alice", "password": "secret",
	})
	if err != nil {
		t.Fatal(err)
	}
	pluginResponse, err := manager.InvokeHTTP(t.Context(), "subsonic", plugin.HTTPRequest{
		Method: http.MethodPost, Path: "/lists",
		Headers: map[string]string{"Content-Type": "application/json"}, Body: string(configBody),
	})
	if err != nil || pluginResponse.StatusCode != http.StatusOK {
		t.Fatalf("configure Subsonic plugin response=%+v err=%v", pluginResponse, err)
	}
	item, err := client.Song.Create().
		SetTitle("Real plugin track").SetSourceType("remote").SetSourceArtist("Artist").
		SetPath("plugin://subsonic/track-1").SetFileName("Real plugin track").
		SetPluginEntryPath("subsonic").SetSourceData(`{"configName":"lark-test","songId":"track-1"}`).
		SetDurationSeconds(12).Save(t.Context())
	if err != nil {
		t.Fatal(err)
	}

	server := New(client, service, "*", WithPluginManager(manager))
	request := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/stream/%d?mode=auto", item.ID), nil)
	request.Header.Set("Range", "bytes=4-7")
	response := httptest.NewRecorder()
	echoContext := server.echo.NewContext(request, response)
	if err := server.streamSong(echoContext, item.ID); err != nil {
		t.Fatal(err)
	}
	if response.Code != http.StatusPartialContent || response.Body.String() != "4567" {
		t.Fatalf("Lark plugin stream status=%d body=%q", response.Code, response.Body.String())
	}
	if response.Header().Get("Content-Range") != "bytes 4-7/12" {
		t.Fatalf("Lark plugin stream Content-Range = %q", response.Header().Get("Content-Range"))
	}
}
