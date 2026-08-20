package plugin

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"testing"

	"lark/backend/ent/enttest"

	_ "github.com/lib-x/entsqlite"
)

func TestEntRepositoryPluginLifecycle(t *testing.T) {
	ctx := context.Background()
	client := enttest.Open(t, "sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared&_pragma=foreign_keys(1)", t.Name()))
	defer client.Close()
	repo := NewEntRepository(client)

	created, err := repo.Create(ctx, Plugin{
		Name: "Lyrics", Version: "1.0.0", EntryPath: "lyrics", Main: "main.js",
		Permissions: []string{PermStorage}, Status: StatusInactive,
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if created.ID == 0 || created.Status != StatusInactive {
		t.Fatalf("created plugin = %+v", created)
	}
	if _, err := repo.Create(ctx, Plugin{Name: "Duplicate", Version: "1.0.0", EntryPath: "lyrics", Main: "main.js"}); !errors.Is(err, ErrPluginConflict) {
		t.Fatalf("duplicate error = %v, want ErrPluginConflict", err)
	}
	if err := repo.SetStatus(ctx, created.ID, StatusActive); err != nil {
		t.Fatalf("SetStatus: %v", err)
	}
	loaded, err := repo.GetByEntryPath(ctx, "lyrics")
	if err != nil || loaded.Status != StatusActive {
		t.Fatalf("GetByEntryPath: plugin=%+v err=%v", loaded, err)
	}
	loaded.Description = "updated"
	updated, err := repo.Update(ctx, loaded)
	if err != nil || updated.Description != "updated" {
		t.Fatalf("Update: plugin=%+v err=%v", updated, err)
	}
	listed, err := repo.List(ctx)
	if err != nil || len(listed) != 1 {
		t.Fatalf("List: plugins=%+v err=%v", listed, err)
	}
}

func TestEntRepositoryStorageIsolationQuotaAndDeletePolicy(t *testing.T) {
	ctx := context.Background()
	client := enttest.Open(t, "sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared&_pragma=foreign_keys(1)", t.Name()))
	defer client.Close()
	repo := NewEntRepository(client)
	created, err := repo.Create(ctx, Plugin{Name: "Storage", Version: "1.0.0", EntryPath: "storage-plugin", Main: "main.js"})
	if err != nil {
		t.Fatal(err)
	}

	volatile := json.RawMessage(`{"scope":"volatile"}`)
	persistent := json.RawMessage(`{"scope":"persistent"}`)
	if err := repo.StorageSet(ctx, created.EntryPath, StorageVolatile, "state", volatile); err != nil {
		t.Fatal(err)
	}
	if err := repo.StorageSet(ctx, created.EntryPath, StoragePersistent, "state", persistent); err != nil {
		t.Fatal(err)
	}
	got, found, err := repo.StorageGet(ctx, created.EntryPath, StorageVolatile, "state")
	if err != nil || !found || !bytes.Equal(got, volatile) {
		t.Fatalf("StorageGet: value=%s found=%v err=%v", got, found, err)
	}
	keys, err := repo.StorageKeys(ctx, created.EntryPath, StorageVolatile)
	if err != nil || len(keys) != 1 || keys[0] != "state" {
		t.Fatalf("StorageKeys: keys=%v err=%v", keys, err)
	}

	oversized := append(bytes.Repeat([]byte(" "), MaxStorageValueBytes), []byte("null")...)
	if err := repo.StorageSet(ctx, created.EntryPath, StorageVolatile, "large", oversized); !errors.Is(err, ErrStorageValueTooLarge) {
		t.Fatalf("oversized error = %v", err)
	}
	quotaFill := bytes.Repeat([]byte(" "), MaxStorageNamespaceBytes-len(volatile)-4)
	if _, err := client.PluginStorage.Create().SetPluginEntryPath(created.EntryPath).SetNamespace(string(StorageVolatile)).SetKey("quota").SetValue(string(quotaFill) + "null").Save(ctx); err != nil {
		t.Fatal(err)
	}
	if err := repo.StorageSet(ctx, created.EntryPath, StorageVolatile, "extra", json.RawMessage(`1`)); !errors.Is(err, ErrStorageQuotaExceeded) {
		t.Fatalf("quota error = %v", err)
	}

	if err := repo.Delete(ctx, created.ID); err != nil {
		t.Fatal(err)
	}
	if _, found, err := repo.StorageGet(ctx, created.EntryPath, StorageVolatile, "state"); err != nil || found {
		t.Fatalf("volatile storage survived delete: found=%v err=%v", found, err)
	}
	got, found, err = repo.StorageGet(ctx, created.EntryPath, StoragePersistent, "state")
	if err != nil || !found || !bytes.Equal(got, persistent) {
		t.Fatalf("persistent storage was not retained: value=%s found=%v err=%v", got, found, err)
	}
}
