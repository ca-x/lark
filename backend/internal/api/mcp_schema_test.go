package api

import (
	"testing"
	"time"
)

func TestBuildMCPServerRegistersTools(t *testing.T) {
	server := (&Server{}).buildMCPServer(1)
	if server == nil {
		t.Fatal("expected MCP server")
	}
}

func TestTranscodeQualityClampsForWeakNetworkProfiles(t *testing.T) {
	quality, err := transcodeQuality("64")
	if err != nil {
		t.Fatal(err)
	}
	if quality != 96 {
		t.Fatalf("expected low quality to clamp to 96, got %d", quality)
	}
	quality, err = transcodeQuality("999")
	if err != nil {
		t.Fatal(err)
	}
	if quality != 320 {
		t.Fatalf("expected high quality to clamp to 320, got %d", quality)
	}
	quality, err = transcodeQuality("128")
	if err != nil {
		t.Fatal(err)
	}
	if quality != 128 {
		t.Fatalf("expected 128 to pass through, got %d", quality)
	}
}

func TestTranscodeQualityRejectsInvalidInput(t *testing.T) {
	if _, err := transcodeQuality("bad"); err == nil {
		t.Fatal("expected invalid quality to fail")
	}
}

func TestTranscodeCacheLockIsRemovedAfterUse(t *testing.T) {
	server := &Server{}
	lock := server.acquireTranscodeCacheLock("/tmp/song.mp3")
	server.releaseTranscodeCacheLock("/tmp/song.mp3", lock)
	if len(server.transcodeCacheLocks) != 0 {
		t.Fatalf("expected transcode lock table to be empty, got %d entries", len(server.transcodeCacheLocks))
	}
}

func TestTranscodeCacheLockTracksWaiters(t *testing.T) {
	server := &Server{}
	first := server.acquireTranscodeCacheLock("/tmp/song.mp3")
	acquired := make(chan *transcodeCacheLock, 1)
	go func() {
		acquired <- server.acquireTranscodeCacheLock("/tmp/song.mp3")
	}()

	waitForTranscodeLockRefs(t, server, "/tmp/song.mp3", 2)
	server.releaseTranscodeCacheLock("/tmp/song.mp3", first)

	second := <-acquired
	server.releaseTranscodeCacheLock("/tmp/song.mp3", second)
	if len(server.transcodeCacheLocks) != 0 {
		t.Fatalf("expected transcode lock table to be empty after waiter release, got %d entries", len(server.transcodeCacheLocks))
	}
}

func TestTranscodeWarmerReservationHonorsLimitAndDeduplicates(t *testing.T) {
	server := &Server{transcodeWarmLimit: 2}
	if !server.reserveTranscodeWarmer("/tmp/one.mp3") {
		t.Fatal("expected first warmer to be reserved")
	}
	if server.reserveTranscodeWarmer("/tmp/one.mp3") {
		t.Fatal("expected duplicate warmer to be rejected")
	}
	if !server.reserveTranscodeWarmer("/tmp/two.mp3") {
		t.Fatal("expected second warmer to be reserved")
	}
	if server.reserveTranscodeWarmer("/tmp/three.mp3") {
		t.Fatal("expected warmer over limit to be rejected")
	}

	server.releaseTranscodeWarmer("/tmp/one.mp3")
	if !server.reserveTranscodeWarmer("/tmp/three.mp3") {
		t.Fatal("expected warmer slot to be reusable after release")
	}
}

func waitForTranscodeLockRefs(t *testing.T, server *Server, path string, refs int) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		server.transcodeCacheLocksMu.Lock()
		lock := server.transcodeCacheLocks[path]
		got := 0
		if lock != nil {
			got = lock.refs
		}
		server.transcodeCacheLocksMu.Unlock()
		if got == refs {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s refs=%d", path, refs)
}
