package api

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	echo "github.com/labstack/echo/v5"
)

func TestPageOffsetUsesNormalizedLimit(t *testing.T) {
	maxInt := int(^uint(0) >> 1)
	tests := []struct {
		name       string
		target     string
		wantLimit  int
		wantOffset int
	}{
		{name: "valid limit", target: "/api/albums/page?page=3&limit=20", wantLimit: 20, wantOffset: 40},
		{name: "oversized limit", target: "/api/albums/page?page=2&limit=999", wantLimit: 100, wantOffset: 100},
		{name: "zero limit", target: "/api/albums/page?page=2&limit=0", wantLimit: 100, wantOffset: 100},
		{name: "invalid page", target: "/api/albums/page?page=-2&limit=20", wantLimit: 20, wantOffset: 0},
		{name: "explicit offset", target: "/api/albums/page?page=3&limit=20&offset=7", wantLimit: 20, wantOffset: 7},
		{
			name:       "page multiplication overflow",
			target:     fmt.Sprintf("/api/albums/page?page=%d&limit=500", maxInt),
			wantLimit:  500,
			wantOffset: maxInt - maxInt%500,
		},
	}

	e := echo.New()
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, tt.target, nil)
			ctx := e.NewContext(req, httptest.NewRecorder())
			if got := pageLimit(ctx); got != tt.wantLimit {
				t.Fatalf("pageLimit() = %d, want %d", got, tt.wantLimit)
			}
			if got := pageOffset(ctx); got != tt.wantOffset {
				t.Fatalf("pageOffset() = %d, want %d", got, tt.wantOffset)
			}
		})
	}
}

func TestValidateExpectedUserID(t *testing.T) {
	tests := []struct {
		name         string
		header       string
		wantError    bool
		wantMismatch bool
	}{
		{name: "legacy client without header"},
		{name: "matching user", header: "7"},
		{name: "changed user", header: "8", wantError: true, wantMismatch: true},
		{name: "invalid user", header: "not-a-number", wantError: true},
	}

	e := echo.New()
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/api/albums/1/favorite", nil)
			if tt.header != "" {
				req.Header.Set(expectedUserIDHeader, tt.header)
			}
			recorder := httptest.NewRecorder()
			ctx := e.NewContext(req, recorder)
			err := validateExpectedUserID(ctx, 7)
			if (err != nil) != tt.wantError {
				t.Fatalf("validateExpectedUserID() error = %v, wantError %v", err, tt.wantError)
			}
			if got := recorder.Header().Get(sessionMismatchHeader) == "true"; got != tt.wantMismatch {
				t.Fatalf("session mismatch header = %v, want %v", got, tt.wantMismatch)
			}
		})
	}
}

func TestFavoriteTargetSupportsSetAndLegacyToggle(t *testing.T) {
	e := echo.New()
	for _, tt := range []struct {
		name string
		body string
		want *bool
	}{
		{name: "legacy empty body"},
		{name: "set favorite", body: `{"favorite":true}`, want: boolPointer(true)},
		{name: "clear favorite", body: `{"favorite":false}`, want: boolPointer(false)},
	} {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/api/albums/1/favorite", strings.NewReader(tt.body))
			if tt.body != "" {
				req.Header.Set("Content-Type", "application/json")
			}
			ctx := e.NewContext(req, httptest.NewRecorder())
			got, err := favoriteTarget(ctx)
			if err != nil {
				t.Fatal(err)
			}
			if (got == nil) != (tt.want == nil) || got != nil && *got != *tt.want {
				t.Fatalf("favoriteTarget() = %v, want %v", got, tt.want)
			}
		})
	}
}

func boolPointer(value bool) *bool { return &value }
