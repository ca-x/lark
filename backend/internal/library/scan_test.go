package library

import (
	"context"
	"os"
	"path/filepath"
	"testing"
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
