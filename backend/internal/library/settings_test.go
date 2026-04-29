package library

import (
	"context"
	"fmt"
	"testing"

	"lark/backend/ent/enttest"
	"lark/backend/internal/models"

	_ "github.com/lib-x/entsqlite"
)

func TestSettingsPersistDiagnosticsEnabled(t *testing.T) {
	ctx := context.Background()
	client := enttest.Open(t, "sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared&_pragma=foreign_keys(1)", t.Name()))
	defer client.Close()
	service := &Service{client: client}

	saved, err := service.SaveSettings(ctx, models.Settings{
		Language:           "zh-CN",
		Theme:              "deep-space",
		NeteaseFallback:    true,
		DiagnosticsEnabled: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !saved.DiagnosticsEnabled {
		t.Fatal("expected saved diagnostics setting to be enabled")
	}
	loaded, err := service.GetSettings(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !loaded.DiagnosticsEnabled {
		t.Fatal("expected diagnostics setting to persist")
	}
}
