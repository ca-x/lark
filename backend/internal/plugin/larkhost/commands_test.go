package larkhost

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	pluginhost "lark/backend/internal/plugin/host"
)

func TestCommandHostExecAndManagesBackgroundProcess(t *testing.T) {
	host := New(nil, nil, Config{})
	commands := host.Commands()
	info := pluginhost.PluginInfo{EntryPath: "command-test", DataDir: t.TempDir()}

	result, err := commands.Exec(t.Context(), info, "/bin/sh", []string{"-c", "printf stdout; printf stderr >&2; exit 7"}, pluginhost.CommandOptions{Timeout: 1_000})
	if err != nil {
		t.Fatal(err)
	}
	if result.ExitCode != 7 || result.Stdout != "stdout" || result.Stderr != "stderr" {
		t.Fatalf("command result = %+v", result)
	}

	started, err := commands.Start(t.Context(), info, "worker", "/bin/sh", []string{"-c", "while :; do sleep 1; done"}, pluginhost.CommandOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if started.PID <= 0 {
		t.Fatalf("started process PID = %d", started.PID)
	}
	running, err := commands.IsRunning(t.Context(), info, "worker")
	if err != nil || !running {
		t.Fatalf("IsRunning before stop = %v, %v", running, err)
	}
	if err := commands.Stop(t.Context(), info, "worker"); err != nil {
		t.Fatal(err)
	}
	running, err = commands.IsRunning(t.Context(), info, "worker")
	if err != nil || running {
		t.Fatalf("IsRunning after stop = %v, %v", running, err)
	}
}

func TestCommandHostDownloadsAndSafelyExtractsTGZ(t *testing.T) {
	host := New(nil, nil, Config{})
	commands := host.Commands()
	info := pluginhost.PluginInfo{EntryPath: "download-test", DataDir: t.TempDir()}
	archive := buildTGZ(t, map[string]string{"release/tool": "binary-data"})
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		_, _ = response.Write(archive)
	}))
	t.Cleanup(server.Close)

	options := pluginhost.CommandDownloadOptions{Extract: "tgz", ExtractTarget: "tool"}
	if err := commands.Download(t.Context(), info, server.URL, "bundle.tgz", options); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(info.DataDir, "bin", "tool"))
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "binary-data" {
		t.Fatalf("extracted data = %q", data)
	}
	if _, err := os.Stat(filepath.Join(info.DataDir, "bin", "bundle.tgz")); !os.IsNotExist(err) {
		t.Fatalf("download archive was not removed after extraction: %v", err)
	}
}

func TestCommandHostRejectsTGZTraversal(t *testing.T) {
	host := New(nil, nil, Config{})
	commands := host.Commands()
	info := pluginhost.PluginInfo{EntryPath: "traversal-test", DataDir: t.TempDir()}
	archive := buildTGZ(t, map[string]string{"../escape": "bad"})
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		_, _ = response.Write(archive)
	}))
	t.Cleanup(server.Close)

	err := commands.Download(t.Context(), info, server.URL, "bundle.tgz", pluginhost.CommandDownloadOptions{Extract: "tgz"})
	if err == nil {
		t.Fatal("expected traversal archive to be rejected")
	}
	if _, err := os.Stat(filepath.Join(info.DataDir, "escape")); !os.IsNotExist(err) {
		t.Fatalf("archive escaped the plugin bin directory: %v", err)
	}
}

func buildTGZ(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var output bytes.Buffer
	gzipWriter := gzip.NewWriter(&output)
	tarWriter := tar.NewWriter(gzipWriter)
	for name, content := range files {
		if err := tarWriter.WriteHeader(&tar.Header{Name: name, Mode: 0o755, Size: int64(len(content)), Typeflag: tar.TypeReg}); err != nil {
			t.Fatal(err)
		}
		if _, err := tarWriter.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := tarWriter.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gzipWriter.Close(); err != nil {
		t.Fatal(err)
	}
	return output.Bytes()
}
