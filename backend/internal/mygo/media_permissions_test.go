package mygo

import (
	"net/http"
	"net/url"
	"sync/atomic"
	"testing"
)

func TestStreamCDNIsSeparateFromPluginFetchPermission(t *testing.T) {
	var requests atomic.Int32
	service := installedService(t, `
export function stream() { return {url:"https://m801.music.126.net/fixture.mp3",headers:{"User-Agent":"Fixture player",Referer:"https://music.163.com/"}}; }
export async function search() { await fetch("https://m801.music.126.net/private-api"); return {}; }
`, WithHTTPClientFactory(func() *http.Client {
		return &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
			requests.Add(1)
			return &http.Response{StatusCode: 200, Header: make(http.Header), Body: http.NoBody, Request: request}, nil
		})}
	}))
	media, err := service.Stream(t.Context(), 1, "demo", "123", "high")
	if err != nil {
		t.Fatal("plugin-returned public CDN must not require fetch permission:", err)
	}
	defer media.Release()
	if media.URL != "https://m801.music.126.net/fixture.mp3" || media.Headers.Get("Referer") != "https://music.163.com/" || media.Headers.Get("User-Agent") != "Fixture player" {
		t.Fatal("stream URL or explicit playback headers lost")
	}
	if _, err := service.Call(t.Context(), 1, "demo", "search", nil); err == nil || requests.Load() != 0 {
		t.Fatalf("fetch permission widened by playback: %v", err)
	}
	for _, address := range []string{"http://127.0.0.1/audio", "http://169.254.169.254/metadata", "http://10.0.0.1/audio", "file:///etc/passwd", "https://user:secret@example.com/audio"} {
		if _, err := service.NewMedia(t.Context(), 1, "demo", address, "audio"); err == nil {
			t.Fatalf("unsafe playback target accepted: %s", address)
		}
	}
	target, _ := url.Parse("https://another-cdn.example/audio")
	headers, err := media.HeadersFor(target)
	if err != nil || len(headers) != 0 {
		t.Fatalf("cross-origin playback must not forward source headers: %v %v", headers, err)
	}
	if _, err := service.NewMedia(t.Context(), 1, "demo", "https://m801.music.126.net/private-api", "image"); err == nil {
		t.Fatal("arbitrary image proxy permission widened by audio playback")
	}
}
