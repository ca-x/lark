package library

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"lark/backend/ent/enttest"
	"lark/backend/ent/song"

	_ "github.com/lib-x/entsqlite"
)

func TestParseCueTextAcceptsUnicodeWhitespace(t *testing.T) {
	text := "FILE\u00a0\"album.ape\"\u00a0WAVE\n\u3000TRACK\u00a001\u00a0AUDIO\n\u3000\u3000TITLE\u00a0\"Opening\"\n\u3000\u3000INDEX\u00a001\u00a000:00:00\n"
	sheet := parseCueText("/tmp/album.cue", text)
	if len(sheet.Files) != 1 || sheet.Files[0].Name != "album.ape" {
		t.Fatalf("expected one cue file, got %+v", sheet.Files)
	}
	if len(sheet.Tracks) != 1 {
		t.Fatalf("expected one audio track, got %+v", sheet.Tracks)
	}
	if sheet.Tracks[0].Title != "Opening" || sheet.Tracks[0].StartSeconds != 0 {
		t.Fatalf("unexpected cue track metadata: %+v", sheet.Tracks[0])
	}
}

func TestCueWithoutAudioTracksDoesNotBlockImageAudioScan(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	audioPath := filepath.Join(root, "CDImage.ape")
	if err := os.WriteFile(audioPath, []byte("fake ape image"), 0o644); err != nil {
		t.Fatal(err)
	}
	cuePath := filepath.Join(root, "CDImage.cue")
	cue := `FILE "CDImage.ape" WAVE
  TRACK 01 MODE1/2352
    INDEX 01 00:00:00
`
	if err := os.WriteFile(cuePath, []byte(cue), 0o644); err != nil {
		t.Fatal(err)
	}
	if paths, err := cueSheetAudioPaths(cuePath); !errors.Is(err, errCueNoAudioTracks) || len(paths) != 0 {
		t.Fatalf("expected no referenced audio paths for non-audio cue, got paths=%v err=%v", paths, err)
	}
	client := enttest.Open(t, "sqlite3", "file:cue-no-audio?mode=memory&cache=shared&_pragma=foreign_keys(1)")
	defer client.Close()
	service := &Service{client: client, libraryDir: root}
	result, err := service.Scan(ctx, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Errors) != 0 {
		t.Fatalf("expected non-audio cue to be skipped without scan errors, got %+v", result.Errors)
	}
	items, err := client.Song.Query().Order(song.ByPath()).All(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 {
		t.Fatalf("expected real audio image to be scanned, got %d songs", len(items))
	}
	if items[0].Path != audioPath || items[0].Path == cuePath || strings.Contains(items[0].Path, cueVirtualMarker) {
		t.Fatalf("expected real audio path %q, got %q", audioPath, items[0].Path)
	}
}
