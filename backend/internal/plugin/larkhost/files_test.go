package larkhost

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	pluginhost "lark/backend/internal/plugin/host"
)

func TestFileHostSupportsSongLoftPathNamespaces(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	dataDir := filepath.Join(root, "plugin")
	musicDir := filepath.Join(root, "music")
	externalDir := filepath.Join(root, "external")
	for _, dir := range []string{dataDir, musicDir, externalDir} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	host := &fileHost{}
	info := pluginhost.PluginInfo{DataDir: dataDir, MusicDir: musicDir, External: []string{externalDir}}
	ctx := context.Background()

	if err := host.Write(ctx, info, "state/config.json", `{"enabled":true}`, "utf8"); err != nil {
		t.Fatal(err)
	}
	if got, err := host.Read(ctx, info, "state/config.json", "utf8"); err != nil || got != `{"enabled":true}` {
		t.Fatalf("read plugin data = %q, %v", got, err)
	}
	if err := os.WriteFile(filepath.Join(musicDir, "song.txt"), []byte("music"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got, err := host.Read(ctx, info, "music://song.txt", "base64"); err != nil || got != "bXVzaWM=" {
		t.Fatalf("read music = %q, %v", got, err)
	}
	externalFile := filepath.Join(externalDir, "device.json")
	if err := host.Write(ctx, info, externalFile, "external", "utf8"); err != nil {
		t.Fatal(err)
	}
	entries, err := host.ReadDir(ctx, info, externalDir)
	if err != nil || len(entries) != 1 || entries[0].Name != "device.json" || entries[0].IsDir {
		t.Fatalf("external entries = %+v, %v", entries, err)
	}
}

func TestFileHostRejectsTraversalAndSymlinkEscape(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	dataDir := filepath.Join(root, "plugin")
	outside := filepath.Join(root, "outside")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(outside, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(dataDir, "escape")); err != nil {
		t.Fatal(err)
	}
	host := &fileHost{}
	info := pluginhost.PluginInfo{DataDir: dataDir}
	if err := host.Write(context.Background(), info, "../outside/file", "bad", "utf8"); err == nil {
		t.Fatal("parent traversal was accepted")
	}
	if err := host.Write(context.Background(), info, "escape/file", "bad", "utf8"); err == nil {
		t.Fatal("symlink escape was accepted")
	}
}
