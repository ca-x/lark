package plugin

import (
	"archive/zip"
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"runtime"
	"strings"
	"testing"

	"lark/backend/ent/enttest"
	"lark/backend/internal/plugin/host"
	"lark/backend/internal/plugin/larkhost"

	_ "github.com/lib-x/entsqlite"
)

func TestManagerRunsSongLoftCompatibilityFixture(t *testing.T) {
	ctx := context.Background()
	client := enttest.Open(t, "sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared&_pragma=foreign_keys(1)", t.Name()))
	defer client.Close()
	repo := NewEntRepository(client)
	root := t.TempDir()
	zipData := fixtureZip(t)
	installed, err := NewPackageInstaller(root).InstallPackage(ctx, zipData)
	if err != nil {
		t.Fatal(err)
	}
	manifest := installed.Manifest
	item, err := repo.Create(ctx, Plugin{
		Name: manifest.Name, Version: manifest.Version, Description: manifest.Description,
		Author: manifest.Author, EntryPath: manifest.EntryPath, Main: manifest.Main,
		Permissions: manifest.Permissions, PublicPaths: manifest.PublicPaths,
		ExternalPaths: manifest.ExternalPaths, EntryHash: manifest.EntryHash,
		ZipHash: manifest.ZipHash, Status: StatusInactive,
	})
	if err != nil {
		t.Fatal(err)
	}
	mgr := NewManager(repo, root, t.TempDir())
	t.Cleanup(func() { _ = mgr.Close() })
	if err := mgr.Enable(ctx, item.ID); err != nil {
		t.Fatalf("Enable: %v", err)
	}

	response, err := mgr.InvokeHTTP(ctx, manifest.EntryPath, HTTPRequest{Method: "GET", Path: "/storage", Headers: map[string]string{}})
	if err != nil {
		t.Fatalf("InvokeHTTP storage: %v", err)
	}
	if response.StatusCode != 200 || response.Body != `{"ok":true}` {
		t.Fatalf("storage response = %+v", response)
	}
	if !mgr.HasLyricProvider() || !mgr.HasCoverProvider() {
		t.Fatal("onInit provider registration was not observed")
	}
	lyrics, err := mgr.SearchLyrics(ctx, "Song", "Artist", "Album", 120, "", "")
	if err != nil || lyrics == nil || lyrics.Lyric != "[00:00.00]fixture" {
		t.Fatalf("SearchLyrics: payload=%+v err=%v", lyrics, err)
	}
	if err := mgr.Disable(ctx, item.ID); err != nil {
		t.Fatalf("Disable: %v", err)
	}
	if mgr.HasLyricProvider() || mgr.HasCoverProvider() {
		t.Fatal("provider registrations survived disable")
	}
}

func TestManagerBridgeOutlivesEnableRequest(t *testing.T) {
	client := enttest.Open(t, "sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared&_pragma=foreign_keys(1)", t.Name()))
	defer client.Close()
	manager := NewManager(NewEntRepository(client), t.TempDir(), t.TempDir())
	t.Cleanup(func() { _ = manager.Close() })

	manifest := validManifest("bridge-lifecycle")
	mainCode := []byte(`
globalThis.onInit = async function() {};
globalThis.onHTTPRequest = async function() {
  await songloft.storage.set('config.json', {enabled: true});
  return {statusCode: 200, headers: {}, body: '{"ok":true}'};
};`)
	item, err := manager.Install(t.Context(), buildPluginZip(t, manifest, []zipEntry{{name: "main.js", data: mainCode}}))
	if err != nil {
		t.Fatal(err)
	}
	enableCtx, cancelEnable := context.WithCancel(t.Context())
	if err := manager.Enable(enableCtx, item.ID); err != nil {
		t.Fatal(err)
	}
	cancelEnable()

	response, err := manager.InvokeHTTP(t.Context(), manifest.EntryPath, HTTPRequest{
		Method: "PUT", Path: "/config", Headers: map[string]string{},
	})
	if err != nil {
		t.Fatalf("InvokeHTTP after enable request ended: %v", err)
	}
	if response.StatusCode != 200 || response.Body != `{"ok":true}` {
		t.Fatalf("response = %+v", response)
	}
}

func TestManagerEnableReturnsAfterSynchronousRegistrations(t *testing.T) {
	previousProcs := runtime.GOMAXPROCS(1)
	t.Cleanup(func() { runtime.GOMAXPROCS(previousProcs) })

	client := enttest.Open(t, "sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared&_pragma=foreign_keys(1)", t.Name()))
	defer client.Close()
	manager := NewManager(NewEntRepository(client), t.TempDir(), t.TempDir())
	t.Cleanup(func() { _ = manager.Close() })

	manifest := validManifest("sync-registration")
	mainCode := []byte(`
globalThis.onInit = async function() {
  songloft.lyrics.registerProvider();
  songloft.covers.registerProvider();
  songloft.events.onPlayEvent(function() {});
};`)
	item, err := manager.Install(t.Context(), buildPluginZip(t, manifest, []zipEntry{{name: "main.js", data: mainCode}}))
	if err != nil {
		t.Fatal(err)
	}
	if err := manager.Enable(t.Context(), item.ID); err != nil {
		t.Fatal(err)
	}

	if !manager.HasLyricProvider() || !manager.HasCoverProvider() || !manager.HasPlayEventSubscriber() {
		t.Fatal("Enable returned before synchronous plugin registrations became visible")
	}
}

func fixtureZip(t *testing.T) []byte {
	t.Helper()
	manifest, err := os.ReadFile("testdata/compat/plugin.json")
	if err != nil {
		t.Fatal(err)
	}
	main, err := os.ReadFile("testdata/compat/main.js")
	if err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	writer := zip.NewWriter(&buf)
	for _, item := range []struct {
		name string
		data []byte
	}{{"plugin.json", manifest}, {"main.js", main}} {
		entry, err := writer.Create(item.name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write(item.data); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestManagerPermissionDeniedBeforeHostDispatch(t *testing.T) {
	ctx := context.Background()
	client := enttest.Open(t, "sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared&_pragma=foreign_keys(1)", t.Name()))
	defer client.Close()
	repo := NewEntRepository(client)
	root := t.TempDir()
	installed, err := NewPackageInstaller(root).InstallPackage(ctx, fixtureZip(t))
	if err != nil {
		t.Fatal(err)
	}
	item, err := repo.Create(ctx, Plugin{Name: "No songs", Version: "1.0.0", EntryPath: installed.Manifest.EntryPath, Main: installed.Manifest.Main, Permissions: []string{}, Status: StatusInactive})
	if err != nil {
		t.Fatal(err)
	}
	mgr := NewManager(repo, root, t.TempDir())
	t.Cleanup(func() { _ = mgr.Close() })
	if err := mgr.Enable(ctx, item.ID); err != nil {
		t.Fatalf("Enable without optional host permissions: %v", err)
	}
	// Exercise the explicit bridge permission path directly with a minimal service.
	service := &Service{plugin: Plugin{EntryPath: "no-songs", Permissions: nil}}
	_, err = mgr.handleBridge(ctx, service, "songs.list", "{}")
	var bridgeErr *host.Error
	if !errors.As(err, &bridgeErr) || bridgeErr.Code != host.CodePermissionDenied {
		t.Fatalf("permission error = %v", err)
	}
}

func TestManagerBroadcastsPlayEventsToSubscribers(t *testing.T) {
	client := enttest.Open(t, "sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared&_pragma=foreign_keys(1)", t.Name()))
	defer client.Close()
	manifest := validManifest("event-plugin")
	manifest.Permissions = []string{}
	mainCode := []byte(`
var received = [];
globalThis.onInit = async function() {
  songloft.events.onPlayEvent(function(event) { received.push(event); });
};
globalThis.onDeinit = async function() { songloft.events.offPlayEvent(); };
globalThis.onHTTPRequest = async function() {
  return {statusCode: 200, headers: {}, body: JSON.stringify(received)};
};`)
	manager := NewManager(NewEntRepository(client), t.TempDir(), t.TempDir())
	t.Cleanup(func() { _ = manager.Close() })
	item, err := manager.Install(t.Context(), buildPluginZip(t, manifest, []zipEntry{{name: "main.js", data: mainCode}}))
	if err != nil {
		t.Fatal(err)
	}
	if err := manager.Enable(t.Context(), item.ID); err != nil {
		t.Fatal(err)
	}
	if err := manager.BroadcastPlayEvent(PlayEvent{
		Type: "finish", Source: "lark-player", Timestamp: 1_777_000_000_000,
		Song: PlayEventSong{ID: 42, Title: "Imagine", Artist: "John Lennon"},
	}); err != nil {
		t.Fatal(err)
	}
	response, err := manager.InvokeHTTP(t.Context(), manifest.EntryPath, HTTPRequest{Method: "GET", Path: "/events", Headers: map[string]string{}})
	if err != nil {
		t.Fatal(err)
	}
	const expected = `[{"type":"finish","song":{"id":42,"title":"Imagine","artist":"John Lennon"},"source":"lark-player","timestamp":1777000000000}]`
	if response.Body != expected {
		t.Fatalf("events body=%s want=%s", response.Body, expected)
	}
}

func TestManagerRunsAndCleansUpSongLoftCommands(t *testing.T) {
	client := enttest.Open(t, "sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared&_pragma=foreign_keys(1)", t.Name()))
	defer client.Close()
	pluginDataDir := t.TempDir()
	adapter := larkhost.New(nil, nil, larkhost.Config{DataDir: pluginDataDir})
	manager := NewManager(NewEntRepository(client), t.TempDir(), pluginDataDir, adapter)
	t.Cleanup(func() { _ = manager.Close() })

	manifest := validManifest("command-plugin")
	manifest.Permissions = []string{PermCommand}
	mainCode := []byte(`
globalThis.onHTTPRequest = async function(req) {
  if (req.path === '/exec') {
    var result = await songloft.command.exec('/bin/sh', ['-c', 'printf plugin-command'], {});
    return {statusCode: 200, headers: {}, body: JSON.stringify(result)};
  }
  if (req.path === '/start') {
    var started = await songloft.command.start('worker', '/bin/sh', ['-c', 'while :; do sleep 1; done'], {});
    var running = await songloft.command.isRunning('worker');
    return {statusCode: 200, headers: {}, body: JSON.stringify({pid: started.pid, running: running})};
  }
  return {statusCode: 404, headers: {}, body: ''};
};`)
	item, err := manager.Install(t.Context(), buildPluginZip(t, manifest, []zipEntry{{name: "main.js", data: mainCode}}))
	if err != nil {
		t.Fatal(err)
	}
	if err := manager.Enable(t.Context(), item.ID); err != nil {
		t.Fatal(err)
	}

	executed, err := manager.InvokeHTTP(t.Context(), manifest.EntryPath, HTTPRequest{Method: "GET", Path: "/exec", Headers: map[string]string{}})
	if err != nil {
		t.Fatal(err)
	}
	if executed.Body != `{"exitCode":0,"stdout":"plugin-command","stderr":""}` {
		t.Fatalf("command exec response = %s", executed.Body)
	}
	started, err := manager.InvokeHTTP(t.Context(), manifest.EntryPath, HTTPRequest{Method: "GET", Path: "/start", Headers: map[string]string{}})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(started.Body, `"running":true`) {
		t.Fatalf("command start response = %s", started.Body)
	}
	if err := manager.Disable(t.Context(), item.ID); err != nil {
		t.Fatal(err)
	}
	info, err := adapter.Auth().PluginInfo(t.Context(), manifest.EntryPath)
	if err != nil {
		t.Fatal(err)
	}
	running, err := adapter.Commands().IsRunning(t.Context(), info, "worker")
	if err != nil || running {
		t.Fatalf("background command survived plugin disable: running=%v err=%v", running, err)
	}
}

func TestManagerSupportsSongLoftInterPluginSendAndCall(t *testing.T) {
	client := enttest.Open(t, "sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared&_pragma=foreign_keys(1)", t.Name()))
	defer client.Close()
	manager := NewManager(NewEntRepository(client), t.TempDir(), t.TempDir())
	t.Cleanup(func() { _ = manager.Close() })

	receiverManifest := validManifest("receiver")
	receiverManifest.Permissions = []string{PermInterPlugin}
	receiverCode := []byte(`
var notifications = [];
songloft.comm.onMessage('notify', function(payload, from) {
  notifications.push({payload: payload, from: from});
});
songloft.comm.onMessage('sum', async function(payload, from) {
  return {value: payload.a + payload.b, from: from};
});
globalThis.onHTTPRequest = async function() {
  return {statusCode: 200, headers: {}, body: JSON.stringify(notifications)};
};`)
	receiver, err := manager.Install(t.Context(), buildPluginZip(t, receiverManifest, []zipEntry{{name: "main.js", data: receiverCode}}))
	if err != nil {
		t.Fatal(err)
	}
	if err := manager.Enable(t.Context(), receiver.ID); err != nil {
		t.Fatal(err)
	}

	senderManifest := validManifest("sender")
	senderManifest.Permissions = []string{PermInterPlugin}
	senderCode := []byte(`
globalThis.onHTTPRequest = async function() {
  await songloft.comm.send('receiver', 'notify', {id: 7});
  var response = await songloft.comm.call('receiver', 'sum', {a: 2, b: 5}, 2000);
  return {statusCode: 200, headers: {}, body: JSON.stringify(response)};
};`)
	sender, err := manager.Install(t.Context(), buildPluginZip(t, senderManifest, []zipEntry{{name: "main.js", data: senderCode}}))
	if err != nil {
		t.Fatal(err)
	}
	if err := manager.Enable(t.Context(), sender.ID); err != nil {
		t.Fatal(err)
	}

	response, err := manager.InvokeHTTP(t.Context(), "sender", HTTPRequest{Method: "GET", Path: "/", Headers: map[string]string{}})
	if err != nil {
		t.Fatal(err)
	}
	if response.Body != `{"success":true,"data":{"value":7,"from":"sender"}}` {
		t.Fatalf("call response = %s", response.Body)
	}
	notifications, err := manager.InvokeHTTP(t.Context(), "receiver", HTTPRequest{Method: "GET", Path: "/", Headers: map[string]string{}})
	if err != nil {
		t.Fatal(err)
	}
	if notifications.Body != `[{"payload":{"id":7},"from":"sender"}]` {
		t.Fatalf("notifications = %s", notifications.Body)
	}
}

func TestManagerResolvesSongLoftPluginMusicURL(t *testing.T) {
	client := enttest.Open(t, "sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared&_pragma=foreign_keys(1)", t.Name()))
	defer client.Close()
	manager := NewManager(NewEntRepository(client), t.TempDir(), t.TempDir())
	t.Cleanup(func() { _ = manager.Close() })

	manifest := validManifest("source-plugin")
	mainCode := []byte(`
globalThis.onHTTPRequest = async function(req) {
  if (req.method !== 'POST' || req.path !== '/api/music/url') {
    return {statusCode: 404, headers: {}, body: ''};
  }
  var input = JSON.parse(req.body);
  if (input.source_data.id !== 'track-1' || !input.fallback.enabled || input.fallback.title !== 'Imagine') {
    return {statusCode: 400, headers: {}, body: 'bad request'};
  }
  return {
    statusCode: 200,
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      url: 'https://media.example.test/track.mp3?token=short-lived',
      headers: {Authorization: 'Bearer source-token', Referer: 'https://app.example.test/'},
      source_data: {id: 'track-1-fallback'},
      used_fallback: true
    })
  };
};`)
	item, err := manager.Install(t.Context(), buildPluginZip(t, manifest, []zipEntry{{name: "main.js", data: mainCode}}))
	if err != nil {
		t.Fatal(err)
	}
	if err := manager.Enable(t.Context(), item.ID); err != nil {
		t.Fatal(err)
	}

	resolved, err := manager.ResolveSongURL(
		t.Context(), manifest.EntryPath, `{"id":"track-1"}`,
		"Imagine", "John Lennon", 183,
	)
	if err != nil {
		t.Fatal(err)
	}
	if resolved.URL != "https://media.example.test/track.mp3?token=short-lived" {
		t.Fatalf("resolved URL = %q", resolved.URL)
	}
	if resolved.Headers["Authorization"] != "Bearer source-token" || !resolved.UsedFallback {
		t.Fatalf("resolved metadata = %+v", resolved)
	}
	if string(resolved.SourceData) != `{"id":"track-1-fallback"}` {
		t.Fatalf("resolved source data = %s", resolved.SourceData)
	}
}

func TestManagerRejectsInvalidPluginMusicSourceData(t *testing.T) {
	manager := NewManager(nil, t.TempDir(), t.TempDir())
	t.Cleanup(func() { _ = manager.Close() })
	_, err := manager.ResolveSongURL(t.Context(), "source-plugin", "not-json", "", "", 0)
	if err == nil || !strings.Contains(err.Error(), "valid JSON") {
		t.Fatalf("ResolveSongURL error = %v", err)
	}
}

func TestManagerLyricQueryUsesUnambiguousSpaceEncoding(t *testing.T) {
	client := enttest.Open(t, "sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared&_pragma=foreign_keys(1)", t.Name()))
	defer client.Close()
	manager := NewManager(NewEntRepository(client), t.TempDir(), t.TempDir())
	t.Cleanup(func() { _ = manager.Close() })
	manifest := validManifest("query-lyrics")
	mainCode := []byte(`
globalThis.onInit = async function() { songloft.lyrics.registerProvider(); };
globalThis.onHTTPRequest = async function(req) {
  return {statusCode: 200, headers: {}, body: JSON.stringify({lyric: req.query})};
};`)
	item, err := manager.Install(t.Context(), buildPluginZip(t, manifest, []zipEntry{{name: "main.js", data: mainCode}}))
	if err != nil {
		t.Fatal(err)
	}
	if err := manager.Enable(t.Context(), item.ID); err != nil {
		t.Fatal(err)
	}
	manager.RegisterLyricProvider(manifest.EntryPath)

	payload, err := manager.SearchLyrics(t.Context(), "Across the Universe", "The Beatles", "Let It Be", 228, "", "")
	if err != nil {
		t.Fatal(err)
	}
	if payload == nil || !strings.Contains(payload.Lyric, "artist=The%20Beatles") || strings.Contains(payload.Lyric, "+") {
		t.Fatalf("plugin lyric query = %+v", payload)
	}
}
