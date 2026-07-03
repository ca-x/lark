package dlna

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"lark/backend/internal/models"
)

func TestPlaySongSendsSetURIThenPlay(t *testing.T) {
	var actions []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		actions = append(actions, r.Header.Get("SOAPACTION"))
		body, _ := io.ReadAll(r.Body)
		if strings.Contains(r.Header.Get("SOAPACTION"), "SetAVTransportURI") && !strings.Contains(string(body), "CurrentURI") {
			t.Fatalf("SetAVTransportURI body missing CurrentURI: %s", body)
		}
		w.Header().Set("Content-Type", `text/xml; charset="utf-8"`)
		_, _ = w.Write([]byte(`<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body></s:Body></s:Envelope>`))
	}))
	defer server.Close()

	service := NewService(fakeLibrary{song: models.Song{ID: 1, Title: "Song", Mime: "audio/mpeg"}}, Options{CastEnabled: true}, WithTokenSecret([]byte("secret")))
	service.devices["device-1"] = rendererDevice{ID: "device-1", Name: "TV", AVTransportURL: server.URL}

	status, err := service.PlaySong(context.Background(), 7, "device-1", 1, "127.0.0.1:8080")
	if err != nil {
		t.Fatalf("PlaySong: %v", err)
	}
	if status.State != "playing" || status.DeviceName != "TV" {
		t.Fatalf("unexpected status: %+v", status)
	}
	if len(actions) != 2 || !strings.Contains(actions[0], "SetAVTransportURI") || !strings.Contains(actions[1], "Play") {
		t.Fatalf("unexpected SOAP actions: %v", actions)
	}
}
