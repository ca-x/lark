package dlna

import (
	"context"
	"strings"
	"testing"

	"lark/backend/internal/models"
)

func TestBrowseRootReturnsMusicContainers(t *testing.T) {
	service := NewService(fakeLibrary{}, Options{LibraryEnabled: true, ServerName: "Lark"}, WithTokenSecret([]byte("secret")))
	result, err := service.Browse(context.Background(), "0", "BrowseDirectChildren", 0, 0, "127.0.0.1:8080")
	if err != nil {
		t.Fatalf("Browse root: %v", err)
	}
	for _, want := range []string{"All Songs", "Albums", "Artists", "Playlists", "Folders"} {
		if !strings.Contains(result.Result, want) {
			t.Fatalf("root browse missing %q:\n%s", want, result.Result)
		}
	}
}

func TestBrowseAllSongsReturnsTokenizedSongItems(t *testing.T) {
	lib := fakeLibrary{songsPage: models.SongPage{
		Items: []models.Song{{ID: 1, Title: "Song A", Artist: "Artist", Album: "Album", Mime: "audio/mpeg", DurationSeconds: 30}},
		Total: 1,
	}}
	service := NewService(lib, Options{LibraryEnabled: true, ServerName: "Lark"}, WithTokenSecret([]byte("secret")))
	result, err := service.Browse(context.Background(), "songs", "BrowseDirectChildren", 0, 100, "127.0.0.1:8080")
	if err != nil {
		t.Fatalf("Browse songs: %v", err)
	}
	for _, want := range []string{"Song A", "object.item.audioItem.musicTrack", "/dlna/audio/", "/dlna/cover/"} {
		if !strings.Contains(result.Result, want) {
			t.Fatalf("songs browse missing %q:\n%s", want, result.Result)
		}
	}
}
