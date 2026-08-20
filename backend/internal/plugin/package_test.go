package plugin

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

type zipEntry struct {
	name string
	data []byte
	mode os.FileMode
}

func TestManifestCompatibility(t *testing.T) {
	valid := validManifest("demo-plugin")
	data, err := json.Marshal(valid)
	if err != nil {
		t.Fatal(err)
	}

	parsed, err := ParseManifest(data)
	if err != nil {
		t.Fatalf("ParseManifest: %v", err)
	}
	if parsed.EntryPath != valid.EntryPath || parsed.DownloadURL != valid.DownloadURL {
		t.Fatalf("manifest fields were not preserved: %+v", parsed)
	}
	if err := ValidateManifest(parsed); err != nil {
		t.Fatalf("ValidateManifest: %v", err)
	}

	tests := []struct {
		name   string
		mutate func(*Manifest)
	}{
		{name: "nil manifest", mutate: nil},
		{name: "invalid semver", mutate: func(m *Manifest) { m.Version = "1.0" }},
		{name: "semver trailing junk", mutate: func(m *Manifest) { m.Version = "1.0.0oops" }},
		{name: "uppercase entry path", mutate: func(m *Manifest) { m.EntryPath = "Demo" }},
		{name: "unsafe main", mutate: func(m *Manifest) { m.Main = "../main.js" }},
		{name: "unknown permission", mutate: func(m *Manifest) { m.Permissions = []string{"root"} }},
		{name: "missing entry hash", mutate: func(m *Manifest) { m.EntryHash = "" }},
		{name: "uppercase zip hash", mutate: func(m *Manifest) { m.ZipHash = strings.Repeat("A", 64) }},
		{name: "unknown render engine", mutate: func(m *Manifest) { m.RenderEngine = "native" }},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var manifest *Manifest
			if tt.mutate != nil {
				manifest = validManifest("demo-plugin")
				tt.mutate(manifest)
			}
			if err := ValidateManifest(manifest); err == nil {
				t.Fatal("expected validation error")
			}
		})
	}
}

func TestPermissionCompatibility(t *testing.T) {
	if err := ValidatePermissions([]string{PermStorage, "songs.*", "playlists.*", "fs.*"}); err != nil {
		t.Fatalf("ValidatePermissions: %v", err)
	}
	if err := ValidatePermissions([]string{"songs.delete-everything"}); err == nil {
		t.Fatal("expected unknown permission to be rejected")
	}

	checks := []struct {
		permissions []string
		required    string
		want        bool
	}{
		{[]string{"songs.*"}, PermSongsRead, true},
		{[]string{"songs.*"}, PermSongsWrite, true},
		{[]string{"songs.*"}, "songs", true},
		{[]string{"songs.*"}, PermPlaylistsRead, false},
		{[]string{"fs.*"}, "fs.read", true},
		{[]string{"fs.*"}, PermFSMusic, false},
		{[]string{PermFSMusic}, PermFSMusic, true},
	}
	for _, tc := range checks {
		if got := CheckPermission(tc.permissions, tc.required); got != tc.want {
			t.Errorf("CheckPermission(%v, %q) = %v, want %v", tc.permissions, tc.required, got, tc.want)
		}
	}
}

func TestPackageInstall(t *testing.T) {
	root := t.TempDir()
	installer := NewPackageInstaller(root)
	zipData := buildPluginZip(t, validManifest("demo-plugin"), []zipEntry{
		{name: "main.js", data: []byte("export function onInit() {}")},
		{name: "static/index.html", data: []byte("<h1>demo</h1>")},
		{name: "bin/tool", data: []byte("#!/bin/sh\nexit 0\n"), mode: 0o755},
	})

	installed, err := installer.InstallPackage(t.Context(), zipData)
	if err != nil {
		t.Fatalf("InstallPackage: %v", err)
	}
	if installed.Manifest.EntryPath != "demo-plugin" {
		t.Fatalf("entryPath = %q", installed.Manifest.EntryPath)
	}
	if installed.Dir != filepath.Join(root, "demo-plugin") {
		t.Fatalf("Dir = %q", installed.Dir)
	}
	if got, err := os.ReadFile(filepath.Join(installed.Dir, "static", "index.html")); err != nil || string(got) != "<h1>demo</h1>" {
		t.Fatalf("read installed static file: data=%q err=%v", got, err)
	}
	if info, err := os.Stat(filepath.Join(installed.Dir, "bin", "tool")); err != nil || info.Mode().Perm()&0o111 == 0 {
		t.Fatalf("bin tool is not executable: mode=%v err=%v", infoMode(info), err)
	}
	assertNoInstallTemps(t, root)

	if _, err := installer.InstallPackage(t.Context(), zipData); !errors.Is(err, ErrPackageExists) {
		t.Fatalf("second install error = %v, want ErrPackageExists", err)
	}
}

func TestPackageRejectsUnsafeArchives(t *testing.T) {
	tests := []struct {
		name    string
		entries []zipEntry
	}{
		{name: "parent traversal", entries: []zipEntry{{name: "../escape", data: []byte("bad")}}},
		{name: "absolute path", entries: []zipEntry{{name: "/escape", data: []byte("bad")}}},
		{name: "windows absolute path", entries: []zipEntry{{name: `C:\escape`, data: []byte("bad")}}},
		{name: "backslash traversal", entries: []zipEntry{{name: `..\escape`, data: []byte("bad")}}},
		{name: "symlink", entries: []zipEntry{{name: "static/link", data: []byte("../../escape"), mode: os.ModeSymlink | 0o777}}},
		{name: "duplicate path", entries: []zipEntry{{name: "static/a", data: []byte("one")}, {name: "static/a", data: []byte("two")}}},
		{name: "file directory conflict", entries: []zipEntry{{name: "static", data: []byte("file")}, {name: "static/a", data: []byte("child")}}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			root := t.TempDir()
			zipData := buildPluginZip(t, validManifest("unsafe-plugin"), append([]zipEntry{
				{name: "main.js", data: []byte("export function onInit() {}")},
			}, tt.entries...))
			_, err := NewPackageInstaller(root).InstallPackage(t.Context(), zipData)
			if !errors.Is(err, ErrUnsafePackage) {
				t.Fatalf("error = %v, want ErrUnsafePackage", err)
			}
			assertInstallFailedCleanly(t, root, "unsafe-plugin")
		})
	}
}

func TestPackageRejectsLimits(t *testing.T) {
	base := []zipEntry{{name: "main.js", data: []byte("main")}}

	t.Run("entry count", func(t *testing.T) {
		entries := append([]zipEntry(nil), base...)
		for i := range 4 {
			entries = append(entries, zipEntry{name: fmt.Sprintf("static/%d", i), data: []byte("x")})
		}
		assertLimitedInstallFails(t, entries, packageLimits{maxArchiveBytes: 1 << 20, maxEntries: 5, maxFileBytes: 1 << 10, maxTotalBytes: 1 << 12})
	})

	t.Run("single file", func(t *testing.T) {
		entries := append(base, zipEntry{name: "static/large", data: bytes.Repeat([]byte("x"), 33)})
		assertLimitedInstallFails(t, entries, packageLimits{maxArchiveBytes: 1 << 20, maxEntries: 10, maxFileBytes: 32, maxTotalBytes: 1 << 12})
	})

	t.Run("total size", func(t *testing.T) {
		entries := append(base,
			zipEntry{name: "static/a", data: bytes.Repeat([]byte("a"), 24)},
			zipEntry{name: "static/b", data: bytes.Repeat([]byte("b"), 24)},
		)
		assertLimitedInstallFails(t, entries, packageLimits{maxArchiveBytes: 1 << 20, maxEntries: 10, maxFileBytes: 64, maxTotalBytes: 50})
	})
}

func TestPackageRejectsHashMismatch(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*Manifest)
	}{
		{name: "entry hash", mutate: func(m *Manifest) { m.EntryHash = strings.Repeat("a", 64) }},
		{name: "zip hash", mutate: func(m *Manifest) { m.ZipHash = strings.Repeat("b", 64) }},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			root := t.TempDir()
			manifest := validManifest("hash-plugin")
			zipData := buildPluginZip(t, manifest, []zipEntry{{name: "main.js", data: []byte("main")}})
			zipData = rewriteManifest(t, zipData, tt.mutate)
			_, err := NewPackageInstaller(root).InstallPackage(t.Context(), zipData)
			if !errors.Is(err, ErrManifestHashMismatch) {
				t.Fatalf("error = %v, want ErrManifestHashMismatch", err)
			}
			assertInstallFailedCleanly(t, root, "hash-plugin")
		})
	}
}

func TestPackageCancellationCleansTemporaryDirectory(t *testing.T) {
	root := t.TempDir()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	zipData := buildPluginZip(t, validManifest("cancelled-plugin"), []zipEntry{{name: "main.js", data: []byte("main")}})
	_, err := NewPackageInstaller(root).InstallPackage(ctx, zipData)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("error = %v, want context.Canceled", err)
	}
	assertInstallFailedCleanly(t, root, "cancelled-plugin")
}

func assertLimitedInstallFails(t *testing.T, entries []zipEntry, limits packageLimits) {
	t.Helper()
	root := t.TempDir()
	zipData := buildPluginZip(t, validManifest("limited-plugin"), entries)
	_, err := installPackage(t.Context(), root, zipData, limits)
	if !errors.Is(err, ErrPackageTooLarge) {
		t.Fatalf("error = %v, want ErrPackageTooLarge", err)
	}
	assertInstallFailedCleanly(t, root, "limited-plugin")
}

func assertInstallFailedCleanly(t *testing.T, root, entryPath string) {
	t.Helper()
	if _, err := os.Stat(filepath.Join(root, entryPath)); !os.IsNotExist(err) {
		t.Fatalf("target remains after failed install: %v", err)
	}
	assertNoInstallTemps(t, root)
}

func assertNoInstallTemps(t *testing.T, root string) {
	t.Helper()
	matches, err := filepath.Glob(filepath.Join(root, ".install-*"))
	if err != nil {
		t.Fatal(err)
	}
	if len(matches) != 0 {
		t.Fatalf("temporary install directories remain: %v", matches)
	}
}

func validManifest(entryPath string) *Manifest {
	return &Manifest{
		Schema:         "https://songloft.org/schemas/plugin.json",
		Name:           "Demo Plugin",
		Version:        "1.2.3-beta.1+build.7",
		Description:    "demo",
		Author:         "SongLoft",
		Homepage:       "https://example.com",
		License:        "Apache-2.0",
		EntryPath:      entryPath,
		Main:           "main.js",
		MinHostVersion: "1.0.0",
		Permissions:    []string{PermStorage, "songs.*"},
		PublicPaths:    []string{"/"},
		ExternalPaths:  []string{"/media"},
		Icon:           "static/icon.png",
		UpdateURL:      "https://example.com/plugin.json",
		DownloadURL:    "https://example.com/demo.jsplugin.zip",
		EntryHash:      strings.Repeat("a", 64),
		ZipHash:        strings.Repeat("b", 64),
		RenderEngine:   RenderEngineWebView,
	}
}

func buildPluginZip(t *testing.T, manifest *Manifest, entries []zipEntry) []byte {
	t.Helper()
	manifestCopy := *manifest
	manifestCopy.EntryHash = hashBytes(findEntry(t, entries, manifest.Main))
	manifestCopy.ZipHash = canonicalHash(entries)
	manifestData, err := json.Marshal(&manifestCopy)
	if err != nil {
		t.Fatal(err)
	}
	return writeZip(t, append([]zipEntry{{name: "plugin.json", data: manifestData}}, entries...))
}

func rewriteManifest(t *testing.T, zipData []byte, mutate func(*Manifest)) []byte {
	t.Helper()
	reader, err := zip.NewReader(bytes.NewReader(zipData), int64(len(zipData)))
	if err != nil {
		t.Fatal(err)
	}
	entries := make([]zipEntry, 0, len(reader.File))
	for _, file := range reader.File {
		rc, err := file.Open()
		if err != nil {
			t.Fatal(err)
		}
		var buf bytes.Buffer
		if _, err := buf.ReadFrom(rc); err != nil {
			rc.Close()
			t.Fatal(err)
		}
		rc.Close()
		data := buf.Bytes()
		if file.Name == "plugin.json" {
			var manifest Manifest
			if err := json.Unmarshal(data, &manifest); err != nil {
				t.Fatal(err)
			}
			mutate(&manifest)
			data, err = json.Marshal(&manifest)
			if err != nil {
				t.Fatal(err)
			}
		}
		entries = append(entries, zipEntry{name: file.Name, data: data, mode: file.Mode()})
	}
	return writeZip(t, entries)
}

func writeZip(t *testing.T, entries []zipEntry) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for _, entry := range entries {
		header := &zip.FileHeader{Name: entry.name, Method: zip.Deflate}
		if entry.mode != 0 {
			header.SetMode(entry.mode)
		}
		writer, err := zw.CreateHeader(header)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := writer.Write(entry.data); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func canonicalHash(entries []zipEntry) string {
	type hashedEntry struct {
		name string
		hash string
	}
	hashed := make([]hashedEntry, 0, len(entries))
	for _, entry := range entries {
		if strings.HasSuffix(entry.name, "/") {
			continue
		}
		hashed = append(hashed, hashedEntry{name: entry.name, hash: hashBytes(entry.data)})
	}
	sort.Slice(hashed, func(i, j int) bool { return hashed[i].name < hashed[j].name })
	h := sha256.New()
	for _, entry := range hashed {
		fmt.Fprintf(h, "%s\n%s\n", entry.name, entry.hash)
	}
	return hex.EncodeToString(h.Sum(nil))
}

func findEntry(t *testing.T, entries []zipEntry, name string) []byte {
	t.Helper()
	for _, entry := range entries {
		if entry.name == name {
			return entry.data
		}
	}
	t.Fatalf("entry %q not found", name)
	return nil
}

func hashBytes(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func infoMode(info os.FileInfo) os.FileMode {
	if info == nil {
		return 0
	}
	return info.Mode()
}
