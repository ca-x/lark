package api

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	echo "github.com/labstack/echo/v5"
)

func TestServePluginStaticFileReadsValidatedAbsolutePath(t *testing.T) {
	t.Parallel()

	asset := filepath.Join(t.TempDir(), "static", "js", "app.bundle.js")
	if err := os.MkdirAll(filepath.Dir(asset), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(asset, []byte("window.pluginLoaded = true;"), 0o644); err != nil {
		t.Fatal(err)
	}
	e := echo.New()
	e.GET("/plugin.js", func(c *echo.Context) error { return servePluginStaticFile(c, asset) })
	request := httptest.NewRequest(http.MethodGet, "/plugin.js", nil)
	response := httptest.NewRecorder()
	e.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", response.Code, response.Body.String())
	}
	if got := response.Body.String(); got != "window.pluginLoaded = true;" {
		t.Fatalf("body = %q", got)
	}
}

func TestInjectPluginHTMLSetsSongLoftResourceBaseFirst(t *testing.T) {
	t.Parallel()

	document := []byte(`<html><head><link href="static/css/app.css"><script src="static/js/app.js"></script></head><body><img src=""></body></html>`)
	got := injectPluginHTML(document, "stats")

	base := []byte(`<base href="/api/v1/jsplugin/stats/">`)
	if !bytes.Contains(got, base) {
		t.Fatalf("injected HTML does not contain %s: %s", base, got)
	}
	if bytes.Index(got, base) > bytes.Index(got, []byte(`<link href="static/css/app.css">`)) {
		t.Fatalf("base must precede relative resources: %s", got)
	}
	ordered := [][]byte{
		base,
		[]byte(`/api/v1/jsplugin-assets/theme.css?v=`),
		[]byte(`/api/v1/jsplugin-assets/components.css?v=`),
		[]byte(`/api/v1/jsplugin-assets/webf-shims.css?v=`),
		[]byte(`/api/v1/jsplugin-assets/common.js?v=`),
		[]byte(`/api/v1/jsplugin-assets/webf-shims.js?v=`),
	}
	previous := -1
	for _, item := range ordered {
		index := bytes.Index(got, item)
		if index < 0 || index <= previous {
			t.Fatalf("injected resources are missing or out of order at %s: %s", item, got)
		}
		previous = index
	}
	if bytes.Contains(got, []byte(`src=""`)) {
		t.Fatalf("empty src attributes must be removed: %s", got)
	}
}

func TestInjectPluginHTMLWithoutHeadPrependsBase(t *testing.T) {
	t.Parallel()

	got := injectPluginHTML([]byte(`<main>plugin</main>`), "radio")
	wantPrefix := []byte(`<base href="/api/v1/jsplugin/radio/">`)
	if !bytes.HasPrefix(got, wantPrefix) {
		t.Fatalf("got %s, want prefix %s", got, wantPrefix)
	}
}

func TestPluginAssetsServeEmbeddedSongloftRuntime(t *testing.T) {
	t.Parallel()

	e := echo.New()
	e.GET("/api/v1/jsplugin-assets/*", handlePluginAsset)
	request := httptest.NewRequest(http.MethodGet, "/api/v1/jsplugin-assets/common.js", nil)
	response := httptest.NewRecorder()
	e.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d: %s", response.Code, http.StatusOK, response.Body.String())
	}
	if contentType := response.Header().Get("Content-Type"); contentType != "text/javascript; charset=utf-8" {
		t.Fatalf("content type = %q, want JavaScript", contentType)
	}
	if cacheControl := response.Header().Get("Cache-Control"); cacheControl != "public, max-age=31536000, immutable" {
		t.Fatalf("cache control = %q", cacheControl)
	}
	if !bytes.Contains(response.Body.Bytes(), []byte("window.SongloftPlugin")) {
		t.Fatal("common.js does not expose the Songloft plugin browser bridge")
	}
}

func TestPluginRequestHeadersStripHostCredentials(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/api/v1/jsplugin/demo/config", nil)
	request.Header.Set("Authorization", "Bearer host-session")
	request.Header.Set("Cookie", "lark_session=secret")
	request.Header.Set("Proxy-Authorization", "Basic secret")
	request.Header.Set("X-Api-Key", "secret")
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Plugin-Input", "visible")

	headers := pluginRequestHeaders(request)
	for _, name := range []string{"Authorization", "Cookie", "Proxy-Authorization", "X-Api-Key"} {
		if value := headers[name]; value != "" {
			t.Fatalf("%s leaked to plugin: %q", name, value)
		}
	}
	if headers["Content-Type"] != "application/json" || headers["X-Plugin-Input"] != "visible" {
		t.Fatalf("business headers were not preserved: %#v", headers)
	}
}
