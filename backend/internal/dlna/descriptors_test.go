package dlna

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRootDescriptionIncludesMediaServerServices(t *testing.T) {
	service := NewService(fakeLibrary{}, Options{LibraryEnabled: true, ServerName: "Lark"}, WithTokenSecret([]byte("secret")))
	req := httptest.NewRequest(http.MethodGet, "/dlna/rootDesc.xml", nil)
	req.Host = "127.0.0.1:8080"
	req.RemoteAddr = "127.0.0.1:12345"
	rec := httptest.NewRecorder()

	service.handleRootDescription(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	for _, want := range []string{"urn:schemas-upnp-org:device:MediaServer:1", contentDirectoryServiceType, connectionManagerServiceType, "/dlna/control"} {
		if !strings.Contains(rec.Body.String(), want) {
			t.Fatalf("root description missing %q:\n%s", want, rec.Body.String())
		}
	}
}

func TestConnectionManagerProtocolInfoIncludesAudioFormats(t *testing.T) {
	for _, want := range []string{"audio/mpeg", "audio/flac", "audio/wav", "image/jpeg"} {
		if !strings.Contains(protocolInfoSource, want) {
			t.Fatalf("protocol info missing %s: %s", want, protocolInfoSource)
		}
	}
}
