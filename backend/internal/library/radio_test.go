package library

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRadioPlaylistEntriesParsesRemoteM3U(t *testing.T) {
	stream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintln(w, "#EXTM3U")
		fmt.Fprintln(w, `#EXTINF:-1 tvg-logo="https://example.test/logo.png" group-title="综合广播",河南新闻广播`)
		fmt.Fprintln(w, "https://stream.example.test/live/xinwen/playlist.m3u8")
		fmt.Fprintln(w, `#EXTINF:-1,CRI环球资讯广播`)
		fmt.Fprintln(w, "http://stream.example.test/hqzx.m3u8")
	}))
	defer stream.Close()

	entries := radioPlaylistEntries(context.Background(), stream.URL+"/categories/综合广播.m3u")
	if len(entries) != 2 {
		t.Fatalf("len(entries) = %d, want 2: %#v", len(entries), entries)
	}
	if entries[0].Name != "河南新闻广播" || entries[0].URL != "https://stream.example.test/live/xinwen/playlist.m3u8" {
		t.Fatalf("first entry = %#v", entries[0])
	}
	if entries[1].Name != "CRI环球资讯广播" || entries[1].URL != "http://stream.example.test/hqzx.m3u8" {
		t.Fatalf("second entry = %#v", entries[1])
	}
}

func TestRadioPlaylistEntriesKeepsHLSManifestAsStream(t *testing.T) {
	stream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintln(w, "#EXTM3U")
		fmt.Fprintln(w, "#EXT-X-VERSION:3")
		fmt.Fprintln(w, "#EXTINF:6.0,")
		fmt.Fprintln(w, "segment001.ts")
	}))
	defer stream.Close()

	if entries := radioPlaylistEntries(context.Background(), stream.URL+"/live/playlist.m3u"); len(entries) != 0 {
		t.Fatalf("HLS manifest entries = %#v, want none", entries)
	}
	if got := resolvePlaylistURL(context.Background(), stream.URL+"/live/playlist.m3u8"); got != stream.URL+"/live/playlist.m3u8" {
		t.Fatalf("resolvePlaylistURL(hls) = %q", got)
	}
}
