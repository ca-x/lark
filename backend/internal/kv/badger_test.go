package kv

import (
	"context"
	"testing"
	"time"
)

func TestBadgerProfileForItemsScalesMemoryWithEstimatedItems(t *testing.T) {
	small := badgerProfileForItems(100)
	medium := badgerProfileForItems(5000)
	large := badgerProfileForItems(50000)

	if !(small.blockCache < medium.blockCache && medium.blockCache <= large.blockCache) {
		t.Fatalf("expected block cache to stay bounded with item count: small=%d medium=%d large=%d", small.blockCache, medium.blockCache, large.blockCache)
	}
	if !(small.indexCache < medium.indexCache && medium.indexCache <= large.indexCache) {
		t.Fatalf("expected index cache to stay bounded with item count: small=%d medium=%d large=%d", small.indexCache, medium.indexCache, large.indexCache)
	}
	if small.numMemtables >= large.numMemtables {
		t.Fatalf("expected large profile to allow more memtables: small=%d large=%d", small.numMemtables, large.numMemtables)
	}
	for name, profile := range map[string]badgerMemoryProfile{"small": small, "medium": medium, "large": large} {
		if profile.numCompactors < 2 {
			t.Fatalf("%s profile has invalid compactor count %d", name, profile.numCompactors)
		}
		if profile.valueThreshold >= profile.memTableSize/4 {
			t.Fatalf("%s profile value threshold %d is too high for memtable %d", name, profile.valueThreshold, profile.memTableSize)
		}
	}
}

func TestOpenBadgerWithSmallProfile(t *testing.T) {
	store, err := OpenBadger(t.TempDir(), BadgerOpenOptions{EstimatedItems: 0})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestBadgerStoreSetNXRespectsTTL(t *testing.T) {
	ctx := context.Background()
	store, err := OpenBadger(t.TempDir(), BadgerOpenOptions{EstimatedItems: 0})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })

	ok, err := store.SetNX(ctx, "lease", []byte("first"), time.Second)
	if err != nil || !ok {
		t.Fatalf("expected first SetNX to acquire lease, ok=%v err=%v", ok, err)
	}
	ok, err = store.SetNX(ctx, "lease", []byte("second"), time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if ok {
		t.Fatal("expected live lease to reject second SetNX")
	}

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		ok, err = store.SetNX(ctx, "lease", []byte("second"), time.Minute)
		if err != nil {
			t.Fatal(err)
		}
		if ok {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("expected expired lease to be acquirable")
}
