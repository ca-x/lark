package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	echo "github.com/labstack/echo/v5"
)

func TestPprofDiagnosticsGateUsesAtomicSwitch(t *testing.T) {
	e := echo.New()
	server := &Server{}

	req := httptest.NewRequest(http.MethodGet, "/api/debug/pprof", nil)
	rec := httptest.NewRecorder()
	ctx := e.NewContext(req, rec)
	if err := server.handlePprof(ctx); err == nil {
		t.Fatal("expected disabled diagnostics to reject pprof request")
	}

	server.diagnosticsEnabled.Store(true)
	req = httptest.NewRequest(http.MethodGet, "/api/debug/pprof", nil)
	rec = httptest.NewRecorder()
	ctx = e.NewContext(req, rec)
	if err := server.handlePprof(ctx); err != nil {
		t.Fatalf("expected enabled diagnostics to serve pprof index: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
}
