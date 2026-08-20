package library

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"lark/backend/ent/enttest"
	"lark/backend/internal/plugin"

	_ "github.com/lib-x/entsqlite"
)

type lyricSearcherFixture struct {
	title    string
	artist   string
	album    string
	duration float64
	lyrics   string
	source   string
	calls    int
}

func (f *lyricSearcherFixture) SearchLyricsText(_ context.Context, title, artist, album string, duration float64) (string, string, error) {
	f.calls++
	f.title, f.artist, f.album, f.duration = title, artist, album, duration
	return f.lyrics, f.source, nil
}

func TestLyricsUsesSongLoftProviderBeforeBuiltInFallback(t *testing.T) {
	client := enttest.Open(t, "sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared&_pragma=foreign_keys(1)", t.Name()))
	defer client.Close()
	searcher := &lyricSearcherFixture{
		lyrics: "[00:00.00]plugin lyric", source: "plugin:lyrics",
	}
	service := New(client, t.TempDir(), t.TempDir(), "", "", nil, nil)
	service.SetLyricSearcher(searcher)
	item, err := client.Song.Create().
		SetTitle("Imagine").SetSourceType("remote").SetSourceArtist("John Lennon").SetSourceAlbum("Imagine").
		SetPath("plugin://subsonic/track-1").SetFileName("Imagine").SetDurationSeconds(183).
		SetPluginEntryPath("subsonic").SetSourceData(`{"songId":"track-1"}`).Save(t.Context())
	if err != nil {
		t.Fatal(err)
	}

	lyrics, err := service.Lyrics(t.Context(), item.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	if lyrics.Lyrics != "[00:00.00]plugin lyric" || lyrics.Source != "plugin:lyrics" || !lyrics.Fetched {
		t.Fatalf("plugin lyrics = %+v", lyrics)
	}
	if searcher.calls != 1 || searcher.title != "Imagine" || searcher.artist != "John Lennon" || searcher.album != "Imagine" || searcher.duration != 183 {
		t.Fatalf("plugin search request = %+v", searcher)
	}
	stored, err := client.Song.Get(t.Context(), item.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.LyricsEmbedded != lyrics.Lyrics || stored.LyricsSource != lyrics.Source || !stored.HasLyrics {
		t.Fatalf("stored plugin lyrics = %+v", stored)
	}
}

func TestEmbeddedLyricsRemainAheadOfSongLoftProvider(t *testing.T) {
	client := enttest.Open(t, "sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared&_pragma=foreign_keys(1)", t.Name()))
	defer client.Close()
	searcher := &lyricSearcherFixture{lyrics: "[00:00.00]plugin lyric", source: "plugin:lyrics"}
	service := New(client, t.TempDir(), t.TempDir(), "", "", nil, nil)
	service.SetLyricSearcher(searcher)
	item, err := client.Song.Create().
		SetTitle("Local").SetPath(t.TempDir() + "/local.mp3").SetFileName("local.mp3").
		SetLyricsEmbedded("[00:00.00]embedded lyric").SetLyricsSource("embedded").SetHasLyrics(true).
		Save(t.Context())
	if err != nil {
		t.Fatal(err)
	}

	lyrics, err := service.Lyrics(t.Context(), item.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	if lyrics.Lyrics != "[00:00.00]embedded lyric" || lyrics.Source != "embedded" {
		t.Fatalf("embedded lyrics = %+v", lyrics)
	}
	if searcher.calls != 0 {
		t.Fatalf("plugin provider called %d times for embedded lyrics", searcher.calls)
	}
}

func TestRealSongLoftLyricsPluginFeedsLarkLibrary(t *testing.T) {
	realPluginDir := os.Getenv("LARK_REAL_PLUGIN_DIR")
	if realPluginDir == "" {
		t.Skip("set LARK_REAL_PLUGIN_DIR to run the official lyrics-provider integration")
	}
	archive, err := os.ReadFile(filepath.Join(realPluginDir, "lyrics.jsplugin.zip"))
	if err != nil {
		t.Fatal(err)
	}
	providerAPI := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/api/get" || request.URL.Query().Get("track_name") != "Imagine" || request.URL.Query().Get("artist_name") != "John Lennon" {
			http.Error(response, "unexpected lyric query", http.StatusBadRequest)
			return
		}
		response.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(response).Encode(map[string]any{
			"id": 1, "trackName": "Imagine", "artistName": "John Lennon", "albumName": "Imagine",
			"duration": 183, "instrumental": false, "syncedLyrics": "[00:00.00]official plugin lyric",
		})
	}))
	t.Cleanup(providerAPI.Close)

	client := enttest.Open(t, "sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared&_pragma=foreign_keys(1)", t.Name()))
	defer client.Close()
	service := New(client, t.TempDir(), t.TempDir(), "", "", nil, nil)
	manager := plugin.NewManager(plugin.NewEntRepository(client), t.TempDir(), t.TempDir())
	t.Cleanup(func() { _ = manager.Close() })
	installed, err := manager.Install(t.Context(), archive)
	if err != nil {
		t.Fatal(err)
	}
	if err := manager.Enable(t.Context(), installed.ID); err != nil {
		t.Fatal(err)
	}
	configBody, err := json.Marshal(map[string]any{
		"enabled": true, "provider": "custom", "customUrl": providerAPI.URL,
	})
	if err != nil {
		t.Fatal(err)
	}
	response, err := manager.InvokeHTTP(t.Context(), "lyrics", plugin.HTTPRequest{
		Method: http.MethodPut, Path: "/config",
		Headers: map[string]string{"Content-Type": "application/json"}, Body: string(configBody),
	})
	if err != nil || response.StatusCode != http.StatusOK {
		t.Fatalf("configure official lyrics plugin response=%+v err=%v", response, err)
	}
	service.SetLyricSearcher(manager)
	item, err := client.Song.Create().
		SetTitle("Imagine").SetSourceType("remote").SetSourceArtist("John Lennon").SetSourceAlbum("Imagine").
		SetPath("plugin://subsonic/imagine").SetFileName("Imagine").SetDurationSeconds(183).
		SetPluginEntryPath("subsonic").SetSourceData(`{"songId":"imagine"}`).Save(t.Context())
	if err != nil {
		t.Fatal(err)
	}

	lyrics, err := service.Lyrics(t.Context(), item.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	if lyrics.Lyrics != "[00:00.00]official plugin lyric" || lyrics.Source != "plugin:lyrics" || !lyrics.Fetched {
		t.Fatalf("official plugin lyrics = %+v", lyrics)
	}
}
