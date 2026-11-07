package plugin

import (
	"fmt"
	_ "github.com/lib-x/entsqlite"
	"lark/backend/ent/enttest"
	"testing"
)

func TestSuspendResumePreservesPluginIntent(t *testing.T) {
	client := enttest.Open(t, "sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared&_pragma=foreign_keys(1)", t.Name()))
	defer client.Close()
	manager := NewManager(NewEntRepository(client), t.TempDir(), t.TempDir())
	t.Cleanup(func() { _ = manager.Close() })
	item, err := manager.Install(t.Context(), fixtureZip(t))
	if err != nil {
		t.Fatal(err)
	}
	if err := manager.Enable(t.Context(), item.ID); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := manager.Suspend(t.Context()); err != nil {
			t.Fatal(err)
		}
		if _, err := manager.InvokeHTTP(t.Context(), item.EntryPath, HTTPRequest{Method: "GET", Path: "/storage"}); err == nil {
			t.Fatal("disabled ecosystem executed code")
		}
		items, err := manager.List(t.Context())
		if err != nil || items[0].Status != StatusActive {
			t.Fatal("suspend lost intent", err)
		}
		if err := manager.Resume(t.Context()); err != nil {
			t.Fatal(err)
		}
		if _, err := manager.InvokeHTTP(t.Context(), item.EntryPath, HTTPRequest{Method: "GET", Path: "/storage"}); err != nil {
			t.Fatal(err)
		}
	}
}

func TestThrowingDeinitCannotUndoSuspend(t *testing.T) {
	client := enttest.Open(t, "sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared&_pragma=foreign_keys(1)", t.Name()))
	defer client.Close()
	manager := NewManager(NewEntRepository(client), t.TempDir(), t.TempDir())
	t.Cleanup(func() { _ = manager.Close() })
	manifest := validManifest("deinit-error")
	source := []byte(`globalThis.onInit=async function(){}; globalThis.onDeinit=async function(){throw new Error("cleanup failed")}; globalThis.onHTTPRequest=async function(){return {statusCode:200,body:"running"}};`)
	item, err := manager.Install(t.Context(), buildPluginZip(t, manifest, []zipEntry{{name: "main.js", data: source}}))
	if err != nil {
		t.Fatal(err)
	}
	if err := manager.Enable(t.Context(), item.ID); err != nil {
		t.Fatal(err)
	}
	if err := manager.Suspend(t.Context()); err == nil {
		t.Fatal("deinit error was hidden")
	}
	if !manager.Suspended() {
		t.Fatal("failed cleanup undid execution gate")
	}
	if _, err := manager.InvokeHTTP(t.Context(), item.EntryPath, HTTPRequest{Method: "GET", Path: "/"}); err == nil {
		t.Fatal("disabled plugin still executed")
	}
}
