package plugin

import (
	"fmt"
	"sync"
	"testing"

	"lark/backend/ent/enttest"

	_ "github.com/lib-x/entsqlite"
)

func TestManagerConcurrentEnsureLoadedCreatesOneService(t *testing.T) {
	client := enttest.Open(t, "sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared&_pragma=foreign_keys(1)", t.Name()))
	defer client.Close()
	repo := NewEntRepository(client)
	manager := NewManager(repo, t.TempDir(), t.TempDir())
	t.Cleanup(func() { _ = manager.Close() })

	manifest := validManifest("lazy-load")
	code := []byte(`globalThis.onHTTPRequest = async function() { return {statusCode: 200, headers: {}, body: 'ok'}; };`)
	item, err := manager.Install(t.Context(), buildPluginZip(t, manifest, []zipEntry{{name: "main.js", data: code}}))
	if err != nil {
		t.Fatal(err)
	}
	if err := repo.SetStatus(t.Context(), item.ID, StatusActive); err != nil {
		t.Fatal(err)
	}

	const callers = 16
	var wait sync.WaitGroup
	errorsByCaller := make([]error, callers)
	for index := range callers {
		wait.Add(1)
		go func() {
			defer wait.Done()
			response, invokeErr := manager.InvokeHTTP(t.Context(), manifest.EntryPath, HTTPRequest{Method: "GET", Path: "/", Headers: map[string]string{}})
			if invokeErr == nil && (response.StatusCode != 200 || response.Body != "ok") {
				invokeErr = fmt.Errorf("unexpected response %+v", response)
			}
			errorsByCaller[index] = invokeErr
		}()
	}
	wait.Wait()
	for index, err := range errorsByCaller {
		if err != nil {
			t.Fatalf("caller %d: %v", index, err)
		}
	}
}

func TestManagerDisablePersistsInactiveStatusWhenDeinitFails(t *testing.T) {
	client := enttest.Open(t, "sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared&_pragma=foreign_keys(1)", t.Name()))
	defer client.Close()
	repo := NewEntRepository(client)
	manager := NewManager(repo, t.TempDir(), t.TempDir())
	t.Cleanup(func() { _ = manager.Close() })

	manifest := validManifest("deinit-error")
	code := []byte(`globalThis.onDeinit = async function() { throw new Error('deinit failed'); };`)
	item, err := manager.Install(t.Context(), buildPluginZip(t, manifest, []zipEntry{{name: "main.js", data: code}}))
	if err != nil {
		t.Fatal(err)
	}
	if err := manager.Enable(t.Context(), item.ID); err != nil {
		t.Fatal(err)
	}
	if err := manager.Disable(t.Context(), item.ID); err == nil {
		t.Fatal("Disable unexpectedly hid the deinit failure")
	}
	stored, err := repo.GetByID(t.Context(), item.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Status != StatusInactive {
		t.Fatalf("stored status = %q, want %q", stored.Status, StatusInactive)
	}
}
