package upstream

import "testing"

func TestUpstreamCommitIsPinned(t *testing.T) {
	if len(UpstreamCommit) != 40 {
		t.Fatalf("UpstreamCommit length = %d, want 40", len(UpstreamCommit))
	}
}
