package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"lark/backend/ent/enttest"
	dlnapkg "lark/backend/internal/dlna"
	"lark/backend/internal/library"

	_ "github.com/lib-x/entsqlite"
)

func TestDLNAStatusRequiresAuth(t *testing.T) {
	client := enttest.Open(t, "sqlite3", "file:api-dlna-auth?mode=memory&cache=shared&_pragma=foreign_keys(1)")
	defer client.Close()
	lib := library.New(client, t.TempDir(), t.TempDir(), "ffprobe", "ffmpeg", nil, nil)
	dlnaService := dlnapkg.NewService(lib, dlnapkg.Options{CastEnabled: true}, dlnapkg.WithTokenSecret([]byte("secret")))
	server := New(client, lib, "*", WithDLNA(dlnaService))

	req := httptest.NewRequest(http.MethodGet, "/api/dlna/status", nil)
	rec := httptest.NewRecorder()
	server.echo.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected unauthorized, got %d", rec.Code)
	}
}
