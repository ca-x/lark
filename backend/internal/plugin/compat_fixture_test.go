package plugin

import (
	"archive/zip"
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestCompatFixturePackage(t *testing.T) {
	manifestData, err := os.ReadFile("testdata/compat/plugin.json")
	if err != nil {
		t.Fatal(err)
	}
	mainData, err := os.ReadFile("testdata/compat/main.js")
	if err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	writer := zip.NewWriter(&buf)
	for name, data := range map[string][]byte{"plugin.json": manifestData, "main.js": mainData} {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write(data); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	installed, err := NewPackageInstaller(t.TempDir()).InstallPackage(t.Context(), buf.Bytes())
	if err != nil {
		t.Fatalf("InstallPackage: %v", err)
	}
	if installed.Manifest.EntryPath != "compat-fixture" {
		t.Fatalf("entryPath = %q", installed.Manifest.EntryPath)
	}
	if _, err := os.Stat(filepath.Join(installed.Dir, "main.js")); err != nil {
		t.Fatalf("installed entry: %v", err)
	}
}

func TestCompatibilityMatrixCoversManifestPermissions(t *testing.T) {
	manifestData, err := os.ReadFile("testdata/compat/plugin.json")
	if err != nil {
		t.Fatal(err)
	}
	manifest, err := ParseManifest(manifestData)
	if err != nil {
		t.Fatal(err)
	}
	matrix := CompatibilityMatrix()
	covered := make(map[string]bool, len(matrix))
	for _, capability := range matrix {
		if capability.Permission != "" {
			covered[capability.Permission] = true
		}
	}
	for _, permission := range manifest.Permissions {
		if permission == "songs.*" {
			if covered[PermSongsRead] && covered[PermSongsWrite] {
				continue
			}
		}
		if permission == "playlists.*" {
			if covered[PermPlaylistsRead] && covered[PermPlaylistsWrite] {
				continue
			}
		}
		if !covered[permission] {
			t.Errorf("permission %q is missing from CompatibilityMatrix", permission)
		}
	}
}
