package main

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestConnectionFilesUseUserDataDirectory(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "Lark Music")
	d, err := newDesktopClient(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := d.saveJSON("config.json", desktopConfig{ServerURL: "https://music.example.com", Theme: "vinyl"}); err != nil {
		t.Fatal(err)
	}
	if err := d.saveJSON("auth.json", desktopAuth{Token: "session-token", Username: "listener", ServerURL: "https://music.example.com"}); err != nil {
		t.Fatal(err)
	}
	loaded, err := newDesktopClient(dir)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.config.ServerURL != "https://music.example.com" || loaded.auth.Token != "session-token" {
		t.Fatalf("loaded config/auth = %+v %+v", loaded.config, loaded.auth)
	}
	if err := loaded.SetCloseBehavior("quit"); err != nil {
		t.Fatal(err)
	}
	reloaded, err := newDesktopClient(dir)
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.closeBehavior() != "quit" {
		t.Fatalf("close behavior = %q", reloaded.closeBehavior())
	}
	if runtime.GOOS != "windows" {
		for _, name := range []string{"config.json", "auth.json"} {
			info, err := os.Stat(filepath.Join(dir, name))
			if err != nil || info.Mode().Perm() != 0o600 {
				t.Fatalf("%s permission = %v, %v", name, info, err)
			}
		}
	}
	if err := reloaded.saveJSON("auth.json", desktopAuth{Token: "other-server-token", ServerURL: "https://other.example.com"}); err != nil {
		t.Fatal(err)
	}
	mismatched, err := newDesktopClient(dir)
	if err != nil || mismatched.auth.Token != "" {
		t.Fatalf("mismatched server kept token: %v, %v", mismatched, err)
	}
	if _, err := os.Stat(filepath.Join(dir, "auth.json")); !os.IsNotExist(err) {
		t.Fatalf("mismatched auth file remains: %v", err)
	}
}

func TestNormalizeServerURLRequiresExplicitLocalHTTP(t *testing.T) {
	if _, _, _, err := normalizeServerURL("http://192.168.1.8:8080", false); err == nil {
		t.Fatal("accepted HTTP without explicit allowance")
	}
	got, target, _, err := normalizeServerURL("http://192.168.1.8:8080/", true)
	if err != nil || got != "http://192.168.1.8:8080" || target != "192.168.1.8:8080" {
		t.Fatalf("local HTTP = %q %q %v", got, target, err)
	}
	for _, input := range []string{"http://example.com", "https://user:pass@example.com", "https://example.com/subpath", "file:///tmp/server"} {
		if _, _, _, err := normalizeServerURL(input, true); err == nil {
			t.Errorf("accepted invalid server %q", input)
		}
	}
}
