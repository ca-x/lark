package library

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"lark/backend/ent"

	taglib "go.senan.xyz/taglib"
)

func TestMetadataWritebackResultMarshalsEmptyItemsAsArray(t *testing.T) {
	data, err := json.Marshal(newMetadataWritebackResult())
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), `"items":[]`) {
		t.Fatalf("expected empty items array, got %s", data)
	}
	if strings.Contains(string(data), `"items":null`) {
		t.Fatalf("metadata writeback items must not marshal as null: %s", data)
	}
}

func TestWriteAudioMetadataUpdatesTagsAndCover(t *testing.T) {
	audioPath := copyTaglibTestdata(t, "eg.flac")
	coverData, err := os.ReadFile(filepath.Join(taglibTestdataDir(t), "cover.jpg"))
	if err != nil {
		t.Fatal(err)
	}
	written, err := writeAudioMetadata(audioPath, map[string][]string{
		taglib.Title:  {"New Title"},
		taglib.Artist: {"New Artist"},
		taglib.Album:  {"New Album"},
		taglib.Date:   {"2026"},
	}, fileMetadata{}, coverData, "image/jpeg")
	if err != nil {
		t.Fatal(err)
	}
	if !written {
		t.Fatal("expected metadata write to report a change")
	}
	tags, err := taglib.ReadTags(audioPath)
	if err != nil {
		t.Fatal(err)
	}
	if got := firstTaglibValue(tags, taglib.Title); got != "New Title" {
		t.Fatalf("title = %q, want New Title", got)
	}
	if got := firstTaglibValue(tags, taglib.Artist); got != "New Artist" {
		t.Fatalf("artist = %q, want New Artist", got)
	}
	image, err := taglib.ReadImage(audioPath)
	if err != nil {
		t.Fatal(err)
	}
	if len(image) == 0 {
		t.Fatal("expected embedded cover image")
	}
}

func TestWriteAudioMetadataMergesWAVInfoFields(t *testing.T) {
	audioPath := filepath.Join(t.TempDir(), "merge.wav")
	writeMinimalWAVFile(t, audioPath)
	if _, err := writeWAVInfoMetadata(audioPath, fileMetadata{
		Title:  "Old Title",
		Artist: "Old Artist",
		Album:  "Old Album",
		Year:   1999,
	}); err != nil {
		t.Fatal(err)
	}
	written, err := writeAudioMetadata(audioPath, map[string][]string{
		taglib.Album: {"New Album"},
		taglib.Date:  {"2026"},
	}, fileMetadata{Album: "New Album", Year: 2026}, nil, "")
	if err != nil {
		t.Fatal(err)
	}
	if !written {
		t.Fatal("expected WAV metadata write to report a change")
	}
	meta := probeWAVMetadata(audioPath)
	if meta.Title != "Old Title" {
		t.Fatalf("title = %q, want Old Title", meta.Title)
	}
	if meta.Artist != "Old Artist" {
		t.Fatalf("artist = %q, want Old Artist", meta.Artist)
	}
	if meta.Album != "New Album" || meta.Year != 2026 {
		t.Fatalf("album/year = %q/%d, want New Album/2026", meta.Album, meta.Year)
	}
}

func TestMetadataWritebackFileGroupsDeduplicateCUETracks(t *testing.T) {
	audioPath := filepath.Join(t.TempDir(), "disc.wav")
	cuePath := filepath.Join(t.TempDir(), "disc.cue")
	items := []*ent.Song{
		{ID: 1, Path: cueVirtualSongPath(audioPath, cuePath, 1, 0, 120)},
		{ID: 2, Path: cueVirtualSongPath(audioPath, cuePath, 2, 120, 240)},
		{ID: 3, Path: filepath.Join(t.TempDir(), "single.flac")},
	}
	groups := metadataWritebackFileGroups(items)
	if len(groups) != 2 {
		t.Fatalf("expected 2 real file groups, got %d", len(groups))
	}
	if groups[0].Path != audioPath || len(groups[0].Songs) != 2 || groups[0].CUETrackCount != 2 {
		t.Fatalf("unexpected CUE group: %#v", groups[0])
	}
}

func TestMetadataPathCandidateFromSongUsesFilenameAndFolder(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "周杰伦", "叶惠美", "01 - 周杰伦 - 晴天.flac")
	item := &ent.Song{ID: 42, Path: path}
	candidate, ok := metadataPathCandidateFromSong(item, root)
	if !ok {
		t.Fatal("expected path metadata candidate")
	}
	if candidate.Source != metadataPathCandidateSource {
		t.Fatalf("source = %q, want %q", candidate.Source, metadataPathCandidateSource)
	}
	if candidate.Title != "晴天" || candidate.Artist != "周杰伦" || candidate.Album != "叶惠美" {
		t.Fatalf("candidate = %#v, want title/artist/album from path", candidate)
	}
}

func TestMetadataPathCandidateFromAlbumInfersMultidiscFolder(t *testing.T) {
	root := t.TempDir()
	item := &ent.Album{ID: 7}
	item.Edges.Songs = []*ent.Song{
		{ID: 1, Path: filepath.Join(root, "周杰伦", "范特西", "CD1", "01 - 爱在西元前.flac")},
		{ID: 2, Path: filepath.Join(root, "周杰伦", "范特西", "CD2", "02 - 简单爱.flac")},
	}
	candidate, ok := metadataPathCandidateFromAlbum(item, root)
	if !ok {
		t.Fatal("expected album path metadata candidate")
	}
	if candidate.Title != "范特西" || candidate.Artist != "周杰伦" {
		t.Fatalf("candidate = %#v, want album and artist from folder path", candidate)
	}
}

func TestParseFilenameMetadataTreatsTrackNumberTitleAsTitleOnly(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "周杰伦", "范特西", "01 - 爱在西元前.flac")
	parsed := parseFilenameMetadata(path, root)
	if parsed.Title != "爱在西元前" {
		t.Fatalf("title = %q, want 爱在西元前", parsed.Title)
	}
	if parsed.Artist != "" {
		t.Fatalf("artist = %q, want empty artist for track-number title filename", parsed.Artist)
	}
	if parsed.Album != "范特西" {
		t.Fatalf("album = %q, want 范特西", parsed.Album)
	}
}

func copyTaglibTestdata(t *testing.T, name string) string {
	t.Helper()
	src := filepath.Join(taglibTestdataDir(t), name)
	data, err := os.ReadFile(src)
	if err != nil {
		t.Fatal(err)
	}
	dst := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(dst, data, 0o644); err != nil {
		t.Fatal(err)
	}
	return dst
}

func taglibTestdataDir(t *testing.T) string {
	t.Helper()
	dir := filepath.Join(os.Getenv("HOME"), "go", "pkg", "mod", "go.senan.xyz", "taglib@v0.12.0", "testdata")
	if _, err := os.Stat(dir); err == nil {
		return dir
	}
	t.Skip("go.senan.xyz/taglib testdata not available")
	return ""
}

func firstTaglibValue(tags map[string][]string, key string) string {
	if values := tags[key]; len(values) > 0 {
		return values[0]
	}
	return ""
}
