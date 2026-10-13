package library

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"

	"lark/backend/ent"
)

func TestCachedEmbeddedCoverFallsBackToSidecarCoverForCUEWAV(t *testing.T) {
	root := t.TempDir()
	audioPath := filepath.Join(root, "CDImage.wav")
	if err := os.WriteFile(audioPath, []byte("RIFF\x24\x00\x00\x00WAVEfmt "), 0o644); err != nil {
		t.Fatal(err)
	}
	want, err := os.ReadFile(filepath.Join(taglibTestdataDir(t), "cover.jpg"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "cover.jpg"), want, 0o644); err != nil {
		t.Fatal(err)
	}
	service := &Service{dataDir: t.TempDir()}
	cuePath := filepath.Join(root, "CDImage.cue")
	got, mimeType, err := service.cachedEmbeddedCover(&ent.Song{
		Path: cueVirtualSongPath(audioPath, cuePath, 1, 0, 180),
	})
	if err != nil {
		t.Fatal(err)
	}
	wantMime := coverMimeFromBytes(want, ".jpg")
	if mimeType != wantMime {
		t.Fatalf("mimeType = %q, want %q", mimeType, wantMime)
	}
	if !bytes.Equal(got, want) {
		t.Fatalf("sidecar cover bytes were not returned")
	}
}
