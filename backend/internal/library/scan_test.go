package library

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"lark/backend/ent"
	"lark/backend/internal/models"
)

func TestShouldSkipSharedCenterScanDirBelowRoot(t *testing.T) {
	root := filepath.Join(t.TempDir(), "music")
	hidden := filepath.Join(root, ".shared-center")
	if !shouldSkipScanDir(root, hidden, ".shared-center") {
		t.Fatal("expected .shared-center child directory to be skipped")
	}
}

func TestShouldNotSkipRootEvenWhenHidden(t *testing.T) {
	root := filepath.Join(t.TempDir(), ".shared-center")
	if shouldSkipScanDir(root, root, ".shared-center") {
		t.Fatal("expected root directory not to be skipped")
	}
}

func TestShouldNotSkipOtherHiddenScanDir(t *testing.T) {
	root := filepath.Join(t.TempDir(), "music")
	hidden := filepath.Join(root, ".artist-cache")
	if shouldSkipScanDir(root, hidden, ".artist-cache") {
		t.Fatal("expected non-shared-center hidden directory not to be skipped")
	}
}

func TestScanSkipsSharedCenterAndContinuesSiblings(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, ".shared-center", "nested"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "album"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".shared-center", "nested", "ignored.txt"), []byte("ignored"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "album", "cover.txt"), []byte("visible"), 0o644); err != nil {
		t.Fatal(err)
	}

	service := &Service{libraryDir: root}
	result, err := service.Scan(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if result.CurrentDir != filepath.Join(root, "album") {
		t.Fatalf("expected scan to continue into sibling album dir, got %q", result.CurrentDir)
	}
}

func TestPreferredEmbeddedLyricsKeepsTaggedLyricsAheadOfOnlineCache(t *testing.T) {
	item := &ent.Song{
		LyricsEmbedded: "[00:00.00]online cache",
		LyricsSource:   "netease",
	}
	got := preferredEmbeddedLyrics(item, "[00:00.00]from file tag")
	if got != "[00:00.00]from file tag" {
		t.Fatalf("expected file tag lyrics to win over online cache, got %q", got)
	}
}

func TestPreferredEmbeddedLyricsTrustsStoredEmbeddedLyrics(t *testing.T) {
	item := &ent.Song{
		LyricsEmbedded: "[00:00.00]stored embedded",
		LyricsSource:   "embedded",
	}
	got := preferredEmbeddedLyrics(item, "[00:00.00]from file tag")
	if got != "[00:00.00]stored embedded" {
		t.Fatalf("expected stored embedded lyrics to win, got %q", got)
	}
}

func TestReadSidecarLyricsPrefersLRCNextToAudio(t *testing.T) {
	dir := t.TempDir()
	audioPath := filepath.Join(dir, "track.flac")
	if err := os.WriteFile(audioPath, []byte("audio"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "track.lrc"), []byte("[00:00.00]sidecar lyric\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	got := readSidecarLyrics(audioPath)
	if got != "[00:00.00]sidecar lyric" {
		t.Fatalf("expected sidecar lyric, got %q", got)
	}
}

func TestRelativeFolderPathRejectsEscapes(t *testing.T) {
	root := filepath.Join(t.TempDir(), "music")
	outside := filepath.Join(filepath.Dir(root), "outside")
	if rel, ok := relativeFolderPath(root, outside); ok {
		t.Fatalf("expected outside folder to be rejected, got %q", rel)
	}
}

func TestRelativeFolderPathNormalizesNestedFolder(t *testing.T) {
	root := filepath.Join(t.TempDir(), "music")
	folder := filepath.Join(root, "Artist", "Album")
	rel, ok := relativeFolderPath(root, folder)
	if !ok {
		t.Fatal("expected nested folder to be accepted")
	}
	if rel != "Artist/Album" {
		t.Fatalf("expected slash-normalized path, got %q", rel)
	}
}

func TestResolveLibraryFolderRejectsTraversal(t *testing.T) {
	root := t.TempDir()
	service := &Service{libraryDir: root}
	if _, err := service.resolveLibraryFolder("../escape"); err == nil {
		t.Fatal("expected traversal to be rejected")
	}
}

func TestResolveLibraryFolderAcceptsRootAliases(t *testing.T) {
	root := t.TempDir()
	service := &Service{libraryDir: root}
	got, err := service.resolveLibraryFolder(".")
	if err != nil {
		t.Fatal(err)
	}
	abs, err := filepath.Abs(root)
	if err != nil {
		t.Fatal(err)
	}
	if got != abs {
		t.Fatalf("expected root %q, got %q", abs, got)
	}
}

func TestRecentArtistInMixUsesGapOnly(t *testing.T) {
	items := []models.Song{{ArtistID: 7}, {ArtistID: 8}, {ArtistID: 9}}
	if recentArtistInMix(items, 7, 2) {
		t.Fatal("artist outside the recent gap should not block selection")
	}
	if !recentArtistInMix(items, 8, 2) {
		t.Fatal("artist inside the recent gap should block selection")
	}
}

func TestDailyScoreIsStableForSameDayAndUser(t *testing.T) {
	item := models.Song{ID: 42, ArtistID: 3, Title: "Track"}
	first := dailyScore("2026-04-27", 1, item)
	second := dailyScore("2026-04-27", 1, item)
	if first != second {
		t.Fatalf("expected stable score, got %d and %d", first, second)
	}
	if first == dailyScore("2026-04-28", 1, item) {
		t.Fatal("expected daily seed to change score")
	}
}

func TestCleanMetadataTextDecodesGBKBytesFromWavInfo(t *testing.T) {
	// Some WAV LIST/INFO writers store Chinese metadata as local ANSI/GBK bytes.
	// Tag readers may expose those bytes as Latin-1-looking mojibake.
	got := cleanMetadataText("²âÊÔ¸èÇú")
	if got != "测试歌曲" {
		t.Fatalf("expected GBK mojibake to decode, got %q", got)
	}
}

func TestCleanMetadataTextKeepsNormalUnicode(t *testing.T) {
	got := cleanMetadataText("Beyoncé – Déjà Vu")
	if got != "Beyoncé – Déjà Vu" {
		t.Fatalf("expected regular unicode to stay unchanged, got %q", got)
	}
}

func TestCleanMetadataTextDecodesRawGBKBytesFromWavInfo(t *testing.T) {
	got := cleanMetadataText(string([]byte{0xb2, 0xe2, 0xca, 0xd4, 0xb8, 0xe8, 0xc7, 0xfa}))
	if got != "测试歌曲" {
		t.Fatalf("expected raw GBK bytes to decode, got %q", got)
	}
}

func TestCleanMetadataTextDecodesUTF16LEBOM(t *testing.T) {
	got := cleanMetadataText(string([]byte{0xff, 0xfe, 0x4b, 0x6d, 0xd5, 0x8b, 0x00, 0x00}))
	if got != "测试" {
		t.Fatalf("expected UTF-16LE BOM to decode, got %q", got)
	}
}
