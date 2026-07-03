package dlna

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestAudioHandlerRequiresMatchingTokenAndSupportsRange(t *testing.T) {
	dir := t.TempDir()
	audioPath := filepath.Join(dir, "song.mp3")
	if err := os.WriteFile(audioPath, []byte("0123456789"), 0o644); err != nil {
		t.Fatal(err)
	}
	service := NewService(fakeLibrary{audioPath: audioPath}, Options{CastEnabled: true}, WithTokenSecret([]byte("secret")))
	token, err := service.tokens.Issue(1, 7, PurposeAudio, time.Minute)
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodGet, "/dlna/audio/"+token+"/1", nil)
	req.Header.Set("Range", "bytes=2-5")
	req.RemoteAddr = "192.168.1.9:56789"
	rec := httptest.NewRecorder()
	service.handleAudio(rec, req)

	if rec.Code != http.StatusPartialContent {
		t.Fatalf("expected 206, got %d body=%q", rec.Code, rec.Body.String())
	}
	if got := rec.Body.String(); got != "2345" {
		t.Fatalf("expected range body 2345, got %q", got)
	}
	if rec.Header().Get("transferMode.dlna.org") != "Streaming" {
		t.Fatalf("missing DLNA streaming header: %v", rec.Header())
	}
}
